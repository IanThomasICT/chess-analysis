import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

// Internal-tool config: extremely strict on type safety, promise hygiene,
// render correctness, and dead-code patterns. Catches real bugs at lint time
// so review effort goes to chess analysis, not debugging.
export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // ── Zero `any`, zero unsafe ──
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-unsafe-unary-minus": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",

      // ── Promise hygiene (SSE, analysis flows) ──
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/promise-function-async": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "error",
      "no-promise-executor-return": "error",
      "@typescript-eslint/prefer-promise-reject-errors": "error",
      "@typescript-eslint/only-throw-error": "error",

      // ── Immutability + readonly ──
      "@typescript-eslint/prefer-readonly": "error",

      // ── Dead-code / redundancy ──
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
      "@typescript-eslint/no-unnecessary-template-expression": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "@typescript-eslint/no-useless-empty-export": "error",
      "@typescript-eslint/no-meaningless-void-operator": "error",
      "@typescript-eslint/no-confusing-non-null-assertion": "error",
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-mixed-enums": "error",

      // ── Type style ──
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/array-type": ["error", { default: "array-simple" }],
      "@typescript-eslint/consistent-indexed-object-style": ["error", "record"],
      "@typescript-eslint/method-signature-style": ["error", "property"],
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/prefer-reduce-type-parameter": "error",
      "@typescript-eslint/prefer-find": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: false,
          allowNullish: false,
          allowRegExp: false,
          allowNever: false,
        },
      ],
      "@typescript-eslint/unbound-method": "error",

      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],

      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // ── Core ESLint hardening ──
      "no-console": ["error", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "all"],
      "no-implicit-coercion": "error",
      "no-param-reassign": ["error", { props: true }],
      "no-return-assign": "error",
      "no-throw-literal": "off", // superseded by @typescript-eslint/only-throw-error
      "prefer-const": "error",
      "prefer-template": "error",
      "object-shorthand": ["error", "always"],
      "no-var": "error",
      "no-duplicate-imports": "error",
      "no-useless-rename": "error",
      "no-useless-concat": "error",
      "no-nested-ternary": "error",
      "no-unneeded-ternary": "error",
    },
  },

  // ── React: @eslint-react strict-type-checked preset (client only) ──
  {
    ...eslintReact.configs["strict-type-checked"],
    files: ["client/src/**/*.{ts,tsx}"],
  },

  // ── React: hooks + render correctness ──
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // Leak detection (timers, listeners, observers)
      "@eslint-react/web-api/no-leaked-event-listener": "error",
      "@eslint-react/web-api/no-leaked-interval": "error",
      "@eslint-react/web-api/no-leaked-timeout": "error",
      "@eslint-react/web-api/no-leaked-resize-observer": "error",

      // DOM safety
      "@eslint-react/dom/no-dangerously-set-innerhtml": "error",
      "@eslint-react/dom/no-script-url": "error",
      "@eslint-react/dom/no-unsafe-iframe-sandbox": "error",
      "@eslint-react/dom/no-missing-button-type": "error",
      "@eslint-react/dom/no-missing-iframe-sandbox": "error",

      // Render correctness (re-render + key bugs)
      "@eslint-react/no-array-index-key": "error",
      "@eslint-react/no-children-prop": "error",
      "@eslint-react/no-clone-element": "error",
      "@eslint-react/no-direct-mutation-state": "error",
      "@eslint-react/no-duplicate-key": "error",
      "@eslint-react/no-implicit-key": "error",
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/no-unnecessary-key": "error",
      "@eslint-react/jsx-key-before-spread": "error",
      "@eslint-react/no-nested-component-definitions": "error",
      "@eslint-react/no-unstable-context-value": "error",
      "@eslint-react/no-unstable-default-props": "error",
      "@eslint-react/no-useless-fragment": "error",
      "@eslint-react/no-leaked-conditional-rendering": "error",
      "@eslint-react/jsx-shorthand-fragment": "error",
      "@eslint-react/jsx-shorthand-boolean": "error",

      // Modern React (block deprecated APIs)
      "@eslint-react/no-class-component": "error",
      "@eslint-react/no-create-ref": "error",
      "@eslint-react/no-default-props": "error",
      "@eslint-react/no-context-provider": "error",
      "@eslint-react/no-forward-ref": "error",

      // Hook hygiene. no-direct-set-state-in-use-effect is intentionally off:
      // it fires on legitimate seed-from-props and init-sequence patterns.
      "@eslint-react/hooks-extra/no-direct-set-state-in-use-effect": "off",
      "@eslint-react/no-unnecessary-use-callback": "error",
      "@eslint-react/no-unnecessary-use-memo": "error",
      "@eslint-react/no-unnecessary-use-prefix": "error",
      "@eslint-react/prefer-use-state-lazy-initialization": "error",

      // Naming
      "@eslint-react/naming-convention/component-name": "error",
      "@eslint-react/naming-convention/use-state": "error",

      // Client SPA — no server components
      "@eslint-react/rsc/function-definition": "off",
    },
  },

  // ── Server: console allowed ──
  {
    files: ["server/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },

  // ── Tests: pragmatic ──
  {
    files: ["tests/**/*.ts", "e2e/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "no-console": "off",
    },
  },

  {
    ignores: ["build/**", "node_modules/**", "*.config.ts"],
  }
);
