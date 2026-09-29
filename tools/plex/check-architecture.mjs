import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { applySupplement } from "#plex/contracts.mjs";

const clientOwners = new Set([
  "apps/server/src/providers/plex/pmsClient.ts",
  "apps/server/src/providers/plex/cloudClient.ts",
  "apps/server/src/providers/plex/mediaClient.ts",
  "packages/plex/src/bootstrap.ts",
]);
const plexDirectory = "apps/server/src/providers/plex/";
const inputRoot = new URL("../../packages/plex/openapi/", import.meta.url);
const upstream = JSON.parse(
  await readFile(new URL("pms.json", inputRoot), "utf8"),
);
const supplement = JSON.parse(
  await readFile(new URL("pms-supplement.json", inputRoot), "utf8"),
);
const cloud = JSON.parse(
  await readFile(new URL("cloud.json", inputRoot), "utf8"),
);
const endpointPatterns = [
  ...Object.keys(upstream.paths),
  ...Object.keys(applySupplement(upstream, supplement).paths),
  ...Object.keys(cloud.paths),
]
  .filter((route) => route.replaceAll(/\{[^}]+\}/g, "").length >= 8)
  .map(
    (route) =>
      new RegExp(
        `${route
          .split(/(\{[^}]+\})/)
          .map((part) =>
            part.startsWith("{")
              ? "[^/?]*"
              : part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`),
          )
          .join("")}(?:[?#]|$)`,
      ),
  );
function isEndpoint(value) {
  return endpointPatterns.some((pattern) => pattern.test(value));
}

const networking =
  /^(?:node:)?(?:https?|http2|net|tls)$|^(?:undici|axios|node-fetch|got)(?:\/|$)/;

export function architectureViolations(file, text) {
  if (
    file.startsWith("packages/plex/src/generated/") ||
    /\.test\.[cm]?[jt]sx?$/.test(file)
  ) {
    return [];
  }
  if (file.endsWith(".sh")) {
    return /plex/i.test(text) && /\b(?:curl|wget|http)\b/.test(text)
      ? [
          `${file}: Plex shell networking must use the generated Node bootstrap.`,
        ]
      : [];
  }
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const errors = [];
  const plexConsumer =
    file.startsWith(plexDirectory) || file.startsWith("packages/plex/src/");
  const clientFactories = new Set(["createPlexPmsSdkClient"]);
  const clients = new Set();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      for (const binding of statement.importClause?.namedBindings?.elements ??
        []) {
        if (
          (binding.propertyName ?? binding.name).text ===
          "createPlexPmsSdkClient"
        ) {
          clientFactories.add(binding.name.text);
        }
      }
    }
  }
  function isClient(node) {
    let value = node;
    while (
      value &&
      (ts.isParenthesizedExpression(value) ||
        ts.isAsExpression(value) ||
        ts.isSatisfiesExpression(value))
    ) {
      value = value.expression;
    }
    if (!value) {
      return false;
    }
    if (ts.isIdentifier(value)) {
      return clients.has(value.text);
    }
    return (
      ts.isCallExpression(value) &&
      ((ts.isIdentifier(value.expression) &&
        clientFactories.has(value.expression.text)) ||
        (ts.isPropertyAccessExpression(value.expression) &&
          clientFactories.has(value.expression.name.text)))
    );
  }
  function accessesClient(node) {
    return (
      ((ts.isPropertyAccessExpression(node) ||
        ts.isElementAccessExpression(node)) &&
        isClient(node.expression)) ||
      (ts.isVariableDeclaration(node) &&
        ts.isObjectBindingPattern(node.name) &&
        isClient(node.initializer))
    );
  }
  function declaresWireModel(node) {
    return (
      (ts.isInterfaceDeclaration(node) ||
        (ts.isTypeAliasDeclaration(node) && containsWireLiteral(node.type))) &&
      /(?:Metadata|PlayingNotification|ResourceResponse|PinResponse|PlexStream|PlexPart|PlexMedia$)/.test(
        node.name.text,
      )
    );
  }
  // Follow local aliases before checking member access; generated operations may
  // receive the client, but consumers may not turn it into a raw HTTP caller.
  let changed;
  do {
    changed = false;
    function collect(node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        isClient(node.initializer) &&
        !clients.has(node.name.text)
      ) {
        clients.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, collect);
    }
    collect(source);
  } while (changed);
  function containsWireLiteral(node) {
    return (
      ts.isTypeLiteralNode(node) ||
      Boolean(ts.forEachChild(node, containsWireLiteral))
    );
  }
  function report(node, message) {
    const { line } = source.getLineAndCharacterOfPosition(
      node.getStart(source),
    );
    errors.push(`${file}:${line + 1}: ${message}`);
  }
  function enclosingFunction(node) {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isFunctionDeclaration(current)) {
        return current.name?.text;
      }
    }
  }
  function authoredText(node) {
    if (ts.isStringLiteralLike(node)) {
      return node.text;
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      return authoredText(node.left) + authoredText(node.right);
    }
    if (ts.isTemplateExpression(node)) {
      return (
        node.head.text +
        node.templateSpans.map((span) => span.literal.text).join("")
      );
    }
    return "";
  }
  function visit(node) {
    if (!clientOwners.has(file) && accessesClient(node)) {
      report(
        node,
        "Pass Plex clients to generated operations; do not access raw client members.",
      );
    }
    if (
      (ts.isBinaryExpression(node) || ts.isTemplateExpression(node)) &&
      isEndpoint(authoredText(node))
    ) {
      report(
        node,
        "Plex endpoint templates must come from generated contracts.",
      );
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === "require")
    ) {
      const specifier = node.arguments[0];
      if (
        specifier &&
        ts.isStringLiteral(specifier) &&
        plexConsumer &&
        /(?:client|generated|pinnedFetch|mediaProxy|axios|undici|node-fetch|node:https?)/.test(
          specifier.text,
        )
      ) {
        report(node, "Do not dynamically bypass Plex transport imports.");
      }
    }
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const specifier = node.moduleSpecifier.text;
      if (
        /plex\/(?:generated|openapi)|@cliparr\/plex\/.*(?:client|core|generated)/.test(
          specifier,
        ) &&
        !clientOwners.has(file)
      ) {
        report(
          node,
          "Generated Plex client internals belong only in transport boundaries.",
        );
      }
      if (
        specifier.startsWith("@cliparr/plex") &&
        file.startsWith("apps/frontend/")
      ) {
        report(node, "Plex operations are server/tooling contracts.");
      }
      if (
        plexConsumer &&
        networking.test(specifier) &&
        file !== `${plexDirectory}pmsClient.ts`
      ) {
        report(
          node,
          "Use generated Plex operations, not another networking library.",
        );
      }
      if (
        plexConsumer &&
        /shared\/(?:pinnedFetch|mediaProxy)/.test(specifier)
      ) {
        if (
          node.importClause?.namedBindings &&
          ts.isNamespaceImport(node.importClause.namedBindings)
        ) {
          report(node, "Use explicit media transport imports.");
        }
        for (const element of node.importClause?.namedBindings?.elements ??
          node.exportClause?.elements ??
          []) {
          const imported = (element.propertyName ?? element.name).text;
          if (
            imported === "fetchWithPinnedDns" &&
            file !== `${plexDirectory}pmsClient.ts`
          ) {
            report(node, "Pinned networking is owned by the PMS transport.");
          }
          if (
            imported === "fetchMediaHandleRequest" &&
            ![
              `${plexDirectory}mediaClient.ts`,
              `${plexDirectory}mediaProxy.ts`,
            ].includes(file)
          ) {
            report(node, "Media networking is owned by the media transport.");
          }
          if (
            imported === "fetchMediaHandleRequest" &&
            element.name.text !== imported
          ) {
            report(node, "Do not alias the media transport boundary.");
          }
        }
      }
    }
    // Type queries describe injected fetch; they do not invoke networking.
    if (
      plexConsumer &&
      ts.isIdentifier(node) &&
      ["fetch", "XMLHttpRequest", "WebSocket", "EventSource"].includes(
        node.text,
      ) &&
      !ts.isTypeQueryNode(node.parent) &&
      !(ts.isPropertyAssignment(node.parent) && node.parent.name === node) &&
      !(ts.isPropertySignature(node.parent) && node.parent.name === node) &&
      !clientOwners.has(file)
    ) {
      report(node, "Raw networking is forbidden in Plex consumers.");
    }
    if (
      plexConsumer &&
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === "fetch" &&
      !clientOwners.has(file)
    ) {
      report(node, "Raw networking is forbidden in Plex consumers.");
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(source) === "fetchMediaHandleRequest" &&
      file === `${plexDirectory}mediaProxy.ts` &&
      enclosingFunction(node) !== "proxyMedia"
    ) {
      report(
        node,
        "Media transport may only follow authorized handles inside proxyMedia.",
      );
    }
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node)
    ) {
      // This single prefix validates returned metadata references; it is never
      // used to construct a request (the builder owns the template).
      const metadataReference =
        file === `${plexDirectory}selection.ts` &&
        ts.isVariableDeclaration(node.parent) &&
        node.parent.name.getText(source) === "PLEX_METADATA_PATH_PREFIX" &&
        /^\/library\/metadata\/$/.test(node.text);
      if (isEndpoint(node.text) && !metadataReference) {
        report(
          node,
          "Plex endpoint templates must come from generated contracts.",
        );
      }
    }
    if (plexConsumer && declaresWireModel(node)) {
      report(node, "Derive Plex wire models from generated response types.");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter(
        (entry) =>
          !["node_modules", "dist", ".astro", ".wrangler"].includes(entry.name),
      )
      .map(async (entry) => {
        const file = path.join(directory, entry.name);
        if (file === "packages/plex/src/generated") {
          return [];
        }
        if (entry.isDirectory()) {
          return filesIn(file);
        }
        return /(?:\.[cm]?[jt]sx?|\.sh)$/.test(file) ? [file] : [];
      }),
  );
  return files.flat();
}

export async function checkArchitecture() {
  const groups = await Promise.all(
    ["apps", "packages", "tools", "docker"].map((directory) =>
      filesIn(directory),
    ),
  );
  const results = await Promise.all(
    groups
      .flat()
      .map(async (file) =>
        architectureViolations(file, await readFile(file, "utf8")),
      ),
  );
  return results.flat();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const errors = await checkArchitecture();
  if (errors.length > 0) {
    process.stderr.write(`${errors.join("\n")}\n`);
    process.exitCode = 1;
  }
}
