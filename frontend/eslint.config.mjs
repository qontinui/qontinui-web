import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

import qontinuiWeb from "./eslint-rules/index.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "eslint-rules/**/*.test.mjs",
    ],
  },
  {
    plugins: {
      "@qontinui-web": qontinuiWeb,
    },
    rules: {
      // Allow unused variables prefixed with underscore
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // Prefer structured logger over console.* — use createLogger() from @/lib/logger
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Phase 0 of the production-safe UI Bridge work
      // (plans/2026-05-28-production-safe-ui-bridge-design.md §4.4).
      // Promoted to `error` after the call-site migration sweep:
      // destructive-named onClick/onSubmit handlers must sit inside a
      // <DestructiveButton> (or an allowed gating wrapper) so that
      // synthetic clicks from UI Bridge / programmatic dispatch are
      // blocked. Genuine false positives (dialog openers / cancel buttons
      // / undoable UI ops) are silenced with an inline disable comment
      // that carries a rationale.
      "@qontinui-web/no-unwrapped-destructive-handler": "error",
    },
  },
];

export default eslintConfig;
