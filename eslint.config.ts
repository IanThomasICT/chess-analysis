import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Enforce zero `any` — no exceptions
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",

      // Strict type safety
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],

      // Allow void expressions in JSX event handlers and arrow IIFEs
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],

      // Unused vars: allow underscore-prefixed
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // ── React: @eslint-react recommended preset (scoped to client) ──
  {
    ...eslintReact.configs["recommended-type-checked"],
    files: ["client/src/**/*.{ts,tsx}"],
  },
  // ── React: hooks plugin + rule overrides ──
  {
    files: ["client/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // ── Hooks (would have caught the conditional-hook bug) ──
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",

      // ── Upgrade leak detection from warn → error ──
      "@eslint-react/web-api/no-leaked-event-listener": "error",
      "@eslint-react/web-api/no-leaked-interval": "error",
      "@eslint-react/web-api/no-leaked-timeout": "error",
      "@eslint-react/web-api/no-leaked-resize-observer": "error",

      // ── Upgrade DOM safety from warn → error ──
      "@eslint-react/dom/no-dangerously-set-innerhtml": "error",
      "@eslint-react/dom/no-script-url": "error",
      "@eslint-react/dom/no-unsafe-iframe-sandbox": "error",

      // ── Disable RSC rules (client-side SPA, not using server components) ──
      "@eslint-react/rsc/function-definition": "off",
    },
  },
  {
    // Ignore generated files and config files at the root
    ignores: [
      "build/**",
      "node_modules/**",
      "*.config.ts",
      "e2e/**",
    ],
  }
);
