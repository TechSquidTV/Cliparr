import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

void test("converter engine excludes React and CSS from its dependency graph", async () => {
  for (const entry of ["engine", "ui"]) {
    const modules = new Set();
    await build({
      root,
      configFile: path.join(root, "vite.config.js"),
      logLevel: "error",
      plugins: [
        {
          name: "convert-entry-dependencies",
          moduleParsed({ id }) {
            modules.add(id.replaceAll("\\", "/"));
          },
        },
      ],
      build: {
        write: false,
        lib: {
          entry: path.join(root, `src/convert/${entry}.ts`),
          formats: ["es"],
        },
      },
    });
    const react = [...modules].filter((id) =>
      /\/node_modules\/(?:react|react-dom)\//.test(id),
    );
    if (entry === "ui") {
      // Positive control: the graph inspection must see actual React imports.
      assert.ok(react.length > 0, "UI entry must include React dependencies");
      continue;
    }
    assert.deepEqual(react, [], "engine must exclude React dependencies");
    assert.deepEqual(
      [...modules].filter((id) =>
        /\.(?:css|less|sass|scss|styl|stylus)(?:$|\?)/.test(id),
      ),
      [],
      "engine must exclude stylesheet dependencies",
    );
  }
});
