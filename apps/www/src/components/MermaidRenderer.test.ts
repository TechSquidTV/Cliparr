import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const component = readFileSync(
  new URL("MermaidRenderer.astro", import.meta.url),
  "utf8",
);
const scriptMatch = component.match(/<script>([\s\S]*?)<\/script>/u);
assert.ok(scriptMatch);
// Exercise the component script, controlling only the import and browser APIs.
const script = transpileModule(scriptMatch[1], {
  compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
})
  .outputText.replace('import("mermaid")', "importMermaid()")
  .replace("void renderMermaid();", "pendingRenders.push(renderMermaid());");

function createRenderer(
  options: {
    storage?: Map<string, string>;
    storageFailure?: "read" | "write";
    renderError?: Error;
  } = {},
) {
  const storage = options.storage ?? new Map<string, string>();
  const listeners = new Map<string, () => void | Promise<void>>();
  const pendingRenders: Promise<void>[] = [];
  const originalCode = { textContent: "flowchart LR\nBrowser --> Cliparr" };
  const classes = new Set<string>();
  let childNodes: (typeof originalCode | string)[] = [originalCode];
  let connected = true;
  let renders = 0;
  let reloads = 0;
  const diagram = {
    textContent: originalCode.textContent,
    get childNodes() {
      return childNodes;
    },
    classList: {
      add(name: string) {
        classes.add(name);
      },
      remove(name: string) {
        classes.delete(name);
      },
    },
    replaceChildren(...children: (typeof originalCode | string)[]) {
      childNodes = children;
    },
  };
  const mermaid = {
    initialize() {},
    async run() {
      if (options.renderError) {
        throw options.renderError;
      }
      renders++;
    },
  };
  const imported = Promise.withResolvers<{ default: typeof mermaid }>();
  runInNewContext(script, {
    TypeError,
    pendingRenders,
    importMermaid: () => imported.promise,
    document: {
      querySelectorAll: () =>
        connected && childNodes.includes(originalCode) ? [diagram] : [],
      addEventListener(name: string, listener: () => void | Promise<void>) {
        listeners.set(name, listener);
      },
    },
    sessionStorage: {
      getItem(key: string) {
        if (options.storageFailure === "read") {
          throw new Error("Storage unavailable");
        }
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        if (options.storageFailure === "write") {
          throw new Error("Storage unavailable");
        }
        storage.set(key, value);
      },
    },
    window: {
      location: {
        reload() {
          reloads++;
        },
      },
    },
  });

  return {
    storage,
    resolveImport: () => imported.resolve({ default: mermaid }),
    rejectImport: (error: Error) => imported.reject(error),
    emit(name: string) {
      const pending = listeners.get(name)?.();
      if (pending) {
        pendingRenders.push(pending);
      }
      if (name === "astro:before-swap") {
        connected = false;
      }
    },
    finished: () => Promise.all(pendingRenders),
    get renders() {
      return renders;
    },
    get reloads() {
      return reloads;
    },
    assertRestored() {
      assert.deepEqual(childNodes, [originalCode]);
      assert.equal(childNodes[0], originalCode);
      assert.equal(classes.has("mermaid"), false);
    },
  };
}

void test("initial page-load preserves the pending Mermaid render", async () => {
  const renderer = createRenderer();
  renderer.emit("astro:page-load");
  renderer.resolveImport();
  await renderer.finished();
  assert.equal(renderer.renders, 1);
  assert.equal(renderer.reloads, 0);
});

void test("navigation invalidates an import that later succeeds", async () => {
  const renderer = createRenderer();
  renderer.emit("astro:before-swap");
  renderer.resolveImport();
  await renderer.finished();
  assert.equal(renderer.renders, 0);
  assert.equal(renderer.reloads, 0);
});

void test("navigation invalidates an import that later fails without reloading", async () => {
  const renderer = createRenderer();
  renderer.emit("astro:before-swap");
  renderer.rejectImport(
    new TypeError("Failed to fetch dynamically imported module"),
  );
  await renderer.finished();
  assert.equal(renderer.reloads, 0);
  assert.equal(renderer.storage.size, 0);
});

void test("import fetch failure restores source and reloads at most once across refreshes", async () => {
  const storage = new Map<string, string>();
  const error = new TypeError("Failed to fetch dynamically imported module");
  const first = createRenderer({ storage });
  first.emit("astro:page-load");
  first.rejectImport(error);
  await first.finished();
  first.assertRestored();
  assert.equal(first.reloads, 1);

  const retry = createRenderer({ storage });
  retry.rejectImport(error);
  await assert.rejects(retry.finished(), error);
  retry.assertRestored();
  assert.equal(retry.reloads, 0);
});

void test("a successful import after refresh can render with the retry marker present", async () => {
  const first = createRenderer();
  first.rejectImport(
    new TypeError("Failed to fetch dynamically imported module"),
  );
  await first.finished();
  const retry = createRenderer({ storage: first.storage });
  retry.resolveImport();
  await retry.finished();
  assert.equal(retry.renders, 1);
  assert.equal(retry.reloads, 0);
});

void test("non-fetch import errors restore source and remain reported", async () => {
  const error = new SyntaxError("Invalid module");
  const renderer = createRenderer();
  renderer.rejectImport(error);
  await assert.rejects(renderer.finished(), error);
  renderer.assertRestored();
  assert.equal(renderer.reloads, 0);
});

void test("rendering TypeErrors remain reported without triggering import recovery", async () => {
  const error = new TypeError("Cannot read properties of null");
  const renderer = createRenderer({ renderError: error });
  renderer.resolveImport();
  await assert.rejects(renderer.finished(), error);
  assert.equal(renderer.reloads, 0);
  assert.equal(renderer.storage.size, 0);
});

for (const storageFailure of ["read", "write"] as const) {
  void test(`failed storage ${storageFailure} preserves the import error without reloading`, async () => {
    const error = new TypeError("Failed to fetch dynamically imported module");
    const renderer = createRenderer({ storageFailure });
    renderer.rejectImport(error);
    await assert.rejects(renderer.finished(), error);
    renderer.assertRestored();
    assert.equal(renderer.reloads, 0);
  });
}
