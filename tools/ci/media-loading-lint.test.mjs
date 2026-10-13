import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";

const root = fileURLToPath(new URL("../..", import.meta.url));
const eslint = new ESLint({
  cwd: root,
  overrideConfigFile: "config/eslint.config.js",
  // Import boundaries need syntax only; ordinary lint still checks types.
  overrideConfig: tseslint.configs.disableTypeChecked,
});
const ui = "apps/frontend/src/components/editor/editorPlaybackSources.ts";
const loader = "apps/frontend/src/lib/export/mediabunny/mediabunnyCodecs.ts";
const gif = "apps/frontend/src/lib/export/gif/gifFrameEncoder.ts";
const execution = "apps/frontend/src/lib/export/exportClip.ts";
const fixture = "apps/frontend/src/lib/mediaLoadingFixtures.test-support.ts";
const unit = "apps/frontend/src/lib/export/mediabunny/mediabunnyCodecs.test.ts";
const converter = "apps/frontend/src/convert.ts";
const cases = [];
for (const name of [
  "@mediabunny/ac3",
  "@mediabunny/future-codec",
  "@mediabunny/future-codec/decoder",
]) {
  for (const code of [
    `import "${name}";`,
    `export * from "${name}";`,
    `export { value } from "${name}";`,
    `import { type Value, value } from "${name}";`,
  ]) {
    cases.push(
      { file: ui, code, restricted: true },
      { file: loader, code, restricted: true },
    );
  }
  for (const code of [
    `import type { Value } from "${name}";`,
    `export type { Value } from "${name}";`,
    `import { type Value } from "${name}";`,
  ]) {
    cases.push({ file: ui, code, restricted: false });
  }
  cases.push(
    { file: ui, code: `void import("${name}");`, restricted: true },
    {
      file: loader,
      code: `void import("${name}");`,
      restricted: false,
    },
    { file: fixture, code: `import "${name}";`, restricted: false },
    { file: unit, code: `import "${name}";`, restricted: false },
  );
}
for (const alias of ["#", "@"]) {
  for (const module of ["export/exportClip", "export/exportAudio"]) {
    cases.push(
      {
        file: ui,
        code: `export * from "${alias}/lib/${module}";`,
        restricted: true,
      },
      {
        file: ui,
        code: `import type { Value } from "${alias}/lib/${module}";`,
        restricted: false,
      },
      {
        file: ui,
        code: `void import("${alias}/lib/${module}");`,
        restricted: false,
      },
    );
  }
}
cases.push(
  { file: ui, code: 'import "@techsquidtv/gifenc";', restricted: true },
  { file: ui, code: 'void import("@techsquidtv/gifenc");', restricted: true },
  {
    file: ui,
    code: 'import type { Value } from "@techsquidtv/gifenc";',
    restricted: false,
  },
  { file: gif, code: 'import "@techsquidtv/gifenc";', restricted: false },
  {
    file: execution,
    code: 'void import("@techsquidtv/gifenc");',
    restricted: false,
  },
  { file: execution, code: 'import "@techsquidtv/gifenc";', restricted: true },
  { file: loader, code: 'import "./local";', restricted: true },
  { file: loader, code: 'void import("../local");', restricted: true },
  { file: loader, code: 'import "@cliparr/server";', restricted: true },
  {
    file: converter,
    code: 'import "./lib/export/exportTypes";',
    restricted: false,
  },
);

void test("media import restrictions preserve ownership, type imports and workspace rules", async () => {
  for (const { file, code, restricted } of cases) {
    const [result] = await eslint.lintText(code, { filePath: file });
    assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
    const restrictions = result.messages.filter(({ ruleId }) =>
      ["no-restricted-imports", "no-restricted-syntax"].includes(ruleId),
    );
    assert.equal(
      restrictions.length > 0,
      restricted,
      `${file}: ${code}\n${JSON.stringify(restrictions)}`,
    );
  }
});
