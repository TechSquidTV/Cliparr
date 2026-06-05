import js from "@eslint/js";
import astro from "eslint-plugin-astro";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import eslintPluginUnicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

const rootDirectory = import.meta.dirname;
const unicornAbbreviationAllowList = Object.fromEntries(
  [
    "api",
    "Api",
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

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.d.ts",
      "**/*.tsbuildinfo",
      "**/routeTree.gen.ts",
      "**/providers/plex/generated/**",
      "apps/server/src/providers/plex/generated/**",
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
            {
              group: ["./*", "../*"],
              message:
                "Use the package alias instead of a relative import path.",
            },
            {
              group: [
                "@cliparr/frontend",
                "@cliparr/frontend/*",
                "@cliparr/server",
                "@cliparr/server/*",
                "apps/frontend/*",
                "apps/server/*",
              ],
              message:
                "Do not import app internals across workspace boundaries.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration, ClassExpression",
          message:
            "Use functions and plain objects instead of classes in Cliparr code.",
        },
        {
          selector: "ThisExpression",
          message:
            "Avoid `this`; close over explicit values or pass state as data.",
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
          selector: String.raw`ImportExpression[source.value=/^\.{1,2}\//]`,
          message: "Use the package alias instead of a relative import path.",
        },
      ],
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
      // React's DOM contract uses className, so keep the rule active for new-prefixed names only.
      "unicorn/no-keyword-prefix": [
        "error",
        {
          disallowedPrefixes: ["new"],
        },
      ],
      "unicorn/prevent-abbreviations": [
        "error",
        {
          allowList: unicornAbbreviationAllowList,
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
    files: ["apps/frontend/src/routes/**/*.{ts,tsx}"],
    rules: {
      "unicorn/filename-case": "off",
    },
  },
  {
    files: ["apps/*/public/service-worker.js"],
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
      "scripts/**/*.{js,mjs,cjs,ts}",
      "apps/*/scripts/**/*.{js,mjs,cjs,ts}",
    ],
    rules: {
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
