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
      // Phase 0 of §4.6 (sensitive-data redaction). Sensitive-named
      // form inputs (token / secret / API key / OTP / connection string
      // / card-number) must carry data-bridge-redact="true" — either
      // directly OR on a JSX ancestor (e.g. the enclosing <form>) — so
      // the @qontinui/ui-bridge SDK's snapshot pipeline redacts the
      // value. Native <input type="password"> is exempt (SDK redacts
      // those unconditionally). Genuine false positives (search field
      // with "token" in its placeholder etc.) are silenced with an
      // inline disable comment carrying a one-sentence rationale.
      "@qontinui-web/no-unredacted-sensitive-input": "error",
    },
  },
  {
    // Phase 4 step 3 of
    // plans/2026-08-16-coord-console-ui-unification-pipeline-style.md — the
    // one mechanical rule that stops Family B (a bordered, padded card per
    // record) from growing back into the coord console after Phase 3 migrated
    // 29 routes off it. The rule keys on the RENDERED SHAPE, not on `<Card>`:
    // the instance that motivated it was a raw <div> that never mentioned
    // Card.
    //
    // The SCOPE lives in the rule, which short-circuits on any filename
    // outside `admin/coord/**`. So this entry being repo-wide buys nothing —
    // move a console file out of that tree and the guard goes with it. It
    // carries no `files:` glob only so the scope has ONE definition rather
    // than two that can drift apart; widening coverage means editing `SCOPE`
    // in `no-fat-record-card.mjs`, not this block.
    rules: {
      "@qontinui-web/no-fat-record-card": "error",
    },
  },
  {
    // API clients under `src/lib/api/` must go through `httpClient` (see
    // `@/services/service-factory`), never a bare `fetch`. A bare fetch sends
    // no `Authorization: Bearer` header, so in prod (Cognito bearer auth) the
    // request 401s — that is how the Workflows list came to render the literal
    // string `UNAUTHORIZED`. `httpClient.fetch` attaches the bearer, the CSRF
    // token and the shared 401-refresh / session-expiry handling.
    files: ["src/lib/api/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            "Bare fetch() is banned in src/lib/api/ — it sends no Bearer token and 401s in prod. Use httpClient.fetch() from @/services/service-factory.",
        },
        {
          selector: "MemberExpression[object.name='window'][property.name='fetch']",
          message:
            "Bare window.fetch is banned in src/lib/api/ — use httpClient.fetch() from @/services/service-factory.",
        },
      ],
    },
  },
];

export default eslintConfig;
