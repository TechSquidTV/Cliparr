import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const unicornNameAllowList = Object.fromEntries(
  [
    "api",
    "Api",
    "configuration",
    "Configuration",
    "application",
    "Application",
    "auth",
    "Auth",
    "db",
    "Db",
    "dir",
    "Dir",
    "docs",
    "Docs",
    "env",
    "Env",
    "gif",
    "Gif",
    "hls",
    "Hls",
    "id",
    "Id",
    "ids",
    "Ids",
    "ms",
    "Ms",
    "params",
    "Params",
    "pms",
    "Pms",
    "props",
    "Props",
    "pwa",
    "Pwa",
    "repository",
    "Repository",
    "ref",
    "Ref",
    "res",
    "Res",
    "sdk",
    "Sdk",
    "ui",
    "Ui",
    "url",
    "Url",
    "urls",
    "Urls",
    "www",
    "Www",
  ].map((name) => [name, true]),
);
const unicornUpgradeCompatibilityRules = {
  // Preserve the repo's effective lint policy while keeping eslint-plugin-unicorn current.
  "unicorn/prefer-json-import": "off",
  "unicorn/prefer-promise-with-resolvers": "off",
  "unicorn/prefer-iterator-helpers": "off",
  "unicorn/prefer-then-catch": "off",
  "unicorn/prefer-uint8array-hex": "off",
  "unicorn/prefer-logical-operator-over-ternary": "off",
  "unicorn/no-array-front-mutation": "off",
  "unicorn/no-unnecessary-string-trim": "off",
  "unicorn/prefer-toggle-attribute": "off",
  "unicorn/no-unnecessary-fetch-options": "off",
  "unicorn/prefer-promise-try": "off",
  "unicorn/no-duplicate-if-branches": "off",
  "unicorn/single-line-block-comment-style": "off",
  "unicorn/consistent-conditional-object-spread": "off",
  "unicorn/consistent-arrow-return-style": "off",
  "unicorn/iteration-fallback-style": "off",
  "unicorn/prefer-simple-condition-first": "off",
  "unicorn/prefer-continue": "off",
  "unicorn/prefer-error-is-error": "off",
  "unicorn/prefer-combined-guards": "off",
  "unicorn/no-array-sort-for-min-max": "off",
  "unicorn/consistent-boolean-name": "off",
  "unicorn/consistent-optional-chaining": "off",
  "unicorn/max-nested-calls": "off",
  "unicorn/no-break-in-nested-loop": "off",
  "unicorn/no-computed-property-existence-check": "off",
  "unicorn/no-declarations-before-early-exit": "off",
  "unicorn/no-error-property-assignment": "off",
  "unicorn/no-global-object-property-assignment": "off",
  "unicorn/no-invalid-file-input-accept": "off",
  "unicorn/no-negated-array-predicate": "off",
  "unicorn/no-non-function-verb-prefix": "off",
  "unicorn/no-return-array-push": "off",
  "unicorn/no-top-level-assignment-in-function": "off",
  "unicorn/no-top-level-side-effects": "off",
  "unicorn/no-unnecessary-global-this": "off",
  "unicorn/no-unreadable-for-of-expression": "off",
  "unicorn/no-unreadable-new-expression": "off",
  "unicorn/no-unsafe-string-replacement": "off",
  "unicorn/no-useless-boolean-cast": "off",
  "unicorn/no-useless-coercion": "off",
  "unicorn/no-useless-fallback-in-spread": "off",
  "unicorn/prefer-array-from-map": "off",
  "unicorn/prefer-at": "off",
  "unicorn/prefer-await": "off",
  "unicorn/prefer-direct-iteration": "off",
  "unicorn/prefer-dispose": "off",
  "unicorn/prefer-early-return": "off",
  "unicorn/prefer-else-if": "off",
  "unicorn/prefer-global-number-constants": "off",
  "unicorn/prefer-global-this": "off",
  "unicorn/prefer-https": "off",
  "unicorn/prefer-includes-over-repeated-comparisons": "off",
  "unicorn/prefer-iterator-to-array": "off",
  "unicorn/prefer-minimal-ternary": "off",
  "unicorn/prefer-number-coercion": "off",
  "unicorn/prefer-number-is-safe-integer": "off",
  "unicorn/prefer-object-define-properties": "off",
  "unicorn/prefer-short-arrow-method": "off",
  "unicorn/prefer-split-limit": "off",
  "unicorn/prefer-string-repeat": "off",
  "unicorn/prefer-temporal": "off",
  "unicorn/prefer-ternary": "off",
  "unicorn/prefer-uint8array-base64": "off",
  "unicorn/prefer-unicode-code-point-escapes": "off",
  "unicorn/prefer-url-href": "off",
  "unicorn/require-array-sort-compare": "off",
  "unicorn/try-complexity": "off",
};
const relativeImportRestriction = {
  group: ["./*", "../*"],
  message: "Use the package alias instead of a relative import path.",
};
const crossWorkspaceImportRestrictions = [
  {
    regex: "^@cliparr/frontend(?:$|/(?!convert$).+)",
    message: "Do not import app internals across workspace boundaries.",
  },
  {
    group: [
      "@cliparr/server",
      "@cliparr/server/*",
      "apps/frontend/*",
      "apps/server/*",
    ],
    message: "Do not import app internals across workspace boundaries.",
  },
];
const relativeDynamicImportSelector = String.raw`ImportExpression[source.value=/^\.{1,2}\//]`;
const restrictedSyntaxRules = [
  {
    selector: "ClassDeclaration, ClassExpression",
    message:
      "Use functions and plain objects instead of classes in Cliparr code.",
  },
  {
    selector: "ThisExpression",
    message: "Avoid `this`; close over explicit values or pass state as data.",
  },
  {
    selector: "Super",
    message: "Use functional composition instead of class inheritance.",
  },
  {
    selector: "MemberExpression[property.name='prototype']",
    message:
      "Do not mutate prototypes; use functions and plain objects instead.",
  },
  {
    selector: relativeDynamicImportSelector,
    message: "Use the package alias instead of a relative import path.",
  },
];
const restrictedSyntaxRulesWithoutRelativeDynamicImports =
  restrictedSyntaxRules.filter(
    ({ selector }) => selector !== relativeDynamicImportSelector,
  );

const mediaTestFiles = ["**/*.test.ts", "**/*.test-support.ts"];
const gifRuntimeFiles = [
  "apps/frontend/src/lib/export/gif/gifEncodingSettings.ts",
  "apps/frontend/src/lib/export/gif/gifFrameChunk.ts",
  "apps/frontend/src/lib/export/gif/gifFrameEncoder.ts",
  "apps/frontend/src/lib/export/gif/gifFrameEncoder.worker.ts",
];

function mediaLoadingRestrictions({
  codecLoader = false,
  gifRuntime = false,
  gifLoader = false,
  ui = false,
  relativeImports = false,
} = {}) {
  const paths = [];
  if (!gifRuntime) {
    paths.push({
      name: "@techsquidtv/gifenc",
      allowTypeImports: true,
      message:
        "Keep GIF runtime dependencies inside the lazy GIF implementation.",
    });
  }
  if (ui) {
    for (const alias of ["@", "#"]) {
      for (const module of ["export/exportClip", "export/exportAudio"]) {
        paths.push({
          name: `${alias}/lib/${module}`,
          allowTypeImports: true,
          message:
            "Load export runtime code when export setup or execution begins.",
        });
      }
    }
  }
  const syntax = [
    ...(relativeImports
      ? restrictedSyntaxRulesWithoutRelativeDynamicImports
      : restrictedSyntaxRules),
  ];
  if (!codecLoader) {
    syntax.push({
      selector: String.raw`ImportExpression[source.value=/^@mediabunny\//]`,
      message: "Load codec extensions through mediabunnyCodecs.",
    });
  }

  if (!gifRuntime && !gifLoader) {
    syntax.push({
      selector: "ImportExpression[source.value='@techsquidtv/gifenc']",
      message:
        "Keep GIF runtime dependencies inside the lazy GIF implementation.",
    });
  }
  return {
    "no-restricted-imports": [
      "error",
      {
        paths,
        patterns: [
          {
            group: ["@mediabunny/*", "@mediabunny/**"],
            allowTypeImports: true,
            message:
              "Load codec extensions dynamically through mediabunnyCodecs.",
          },
          ...(relativeImports ? [] : [relativeImportRestriction]),
          ...crossWorkspaceImportRestrictions,
        ],
      },
    ],
    "no-restricted-syntax": ["error", ...syntax],
  };
}

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "packages/plex/src/generated/**",
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  js.configs.recommended,
  eslintPluginUnicorn.configs.all,
  {
    rules: {
      complexity: ["error", { max: 70 }],
      curly: ["error", "all"],
      "default-case-last": "error",
      eqeqeq: ["error", "always"],
      "max-depth": ["error", 5],
      "max-params": ["error", 7],
      "no-else-return": ["error", { allowElseIf: false }],
      "no-eval": "error",
      "no-implicit-coercion": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-param-reassign": [
        "error",
        {
          ignorePropertyModificationsFor: [
            "bytes",
            "context",
            "event",
            "gainNode",
            "target",
          ],
          ignorePropertyModificationsForRegex: ["Ref$"],
          props: true,
        },
      ],
      "no-promise-executor-return": "error",
      "no-return-assign": ["error", "always"],
      "no-sequences": "error",
      "no-template-curly-in-string": "error",
      "no-unmodified-loop-condition": "error",
      "no-unreachable-loop": "error",
      "no-unneeded-ternary": "error",
      "no-useless-concat": "error",
      "no-var": "error",
      "no-console": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            relativeImportRestriction,
            ...crossWorkspaceImportRestrictions,
          ],
        },
      ],
      "no-restricted-syntax": ["error", ...restrictedSyntaxRules],
      "object-shorthand": "error",
      "prefer-const": ["error", { destructuring: "all" }],
      "prefer-template": "error",
      "unicorn/filename-case": [
        "error",
        {
          cases: {
            camelCase: true,
            kebabCase: true,
            pascalCase: true,
          },
        },
      ],
      // Cliparr exchanges JSON/provider/database values where null is contractually meaningful.
      "unicorn/no-null": "off",
      ...unicornUpgradeCompatibilityRules,
      // React's DOM contract uses className, so keep the rule active for new-prefixed names only.
      "unicorn/name-replacements": [
        "error",
        { allowList: unicornNameAllowList },
      ],
      "unicorn/no-keyword-prefix": [
        "error",
        {
          disallowedPrefixes: ["new"],
        },
      ],
    },
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: rootDirectory,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "separate-type-imports",
        },
      ],
      "@typescript-eslint/no-array-delete": "error",
      "@typescript-eslint/no-base-to-string": "error",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-explicit-any": [
        "error",
        {
          fixToUnknown: false,
          ignoreRestArgs: false,
        },
      ],
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          ignoreIIFE: true,
          ignoreVoid: true,
        },
      ],
      "@typescript-eslint/no-for-in-array": "error",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-type-arguments": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "@typescript-eslint/no-unnecessary-type-conversion": "off",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/only-throw-error": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",
      "@typescript-eslint/require-array-sort-compare": [
        "error",
        { ignoreStringArrays: true },
      ],
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowBoolean: true,
          allowNumber: true,
        },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  ...astro.configs["flat/recommended"],
  {
    files: ["**/*.astro", "**/*.astro/*.js"],
    rules: tseslint.configs.disableTypeChecked.rules,
  },
  {
    files: ["apps/www/**/*.astro"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
  },
  {
    files: ["apps/frontend/**/*.{ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2024,
      },
    },
    plugins: reactHooks.configs.flat.recommended.plugins,
    rules: {
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["apps/frontend/src/**/*.{ts,tsx}"],
    ignores: mediaTestFiles,
    rules: mediaLoadingRestrictions(),
  },
  {
    files: ["apps/frontend/src/lib/export/mediabunny/mediabunnyCodecs.ts"],
    rules: mediaLoadingRestrictions({ codecLoader: true }),
  },
  {
    files: gifRuntimeFiles,
    rules: mediaLoadingRestrictions({ gifRuntime: true }),
  },
  {
    files: ["apps/frontend/src/lib/export/exportClip.ts"],
    rules: mediaLoadingRestrictions({ gifLoader: true }),
  },
  {
    files: ["apps/frontend/src/components/**/*.{ts,tsx}"],
    ignores: mediaTestFiles,
    rules: mediaLoadingRestrictions({ ui: true }),
  },
  {
    files: ["apps/frontend/src/convert.ts"],
    // This source entrypoint is also bundled by @cliparr/www.
    rules: mediaLoadingRestrictions({ relativeImports: true }),
  },
  {
    files: ["apps/frontend/src/routes/**/*.{ts,tsx}"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
  {
    files: ["apps/*/public/**/service-worker.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },
  {
    files: [
      "apps/frontend/src/**/*.worker.ts",
      "apps/frontend/src/lib/subtitles/parseSubtitleTextAsync.ts",
    ],
    rules: {
      "unicorn/require-post-message-target-origin": "off",
    },
  },
  {
    files: ["apps/server/src/server.ts"],
    rules: {
      "unicorn/no-process-exit": "off",
    },
  },
  {
    files: [
      "tools/**/*.{js,mjs,cjs,ts}",
      "apps/*/scripts/**/*.{js,mjs,cjs,ts}",
    ],
    rules: {
      "unicorn/no-exports-in-scripts": "off",
      "unicorn/no-process-exit": "off",
    },
  },
  {
    files: ["apps/server/**/*.{ts,tsx}", ".github/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: tseslint.configs.disableTypeChecked.rules,
  },
);
