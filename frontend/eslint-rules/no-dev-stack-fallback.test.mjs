/**
 * RuleTester suite for `no-dev-stack-fallback` (plan
 * 2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists,
 * phase A5 / defect 5).
 *
 * The invalid cases include defect 5's six residual sites VERBATIM as they
 * stood at web `1400265cb` before PR #1550 removed them — the rule exists to
 * make exactly those lines red again. The port list itself is checked
 * against the pinned vocabulary in `no-dev-stack-fallback.vocabulary.test.mjs`.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";

import rule, {
  FLAGGED_PORTS,
  RESOLVER_FILES,
  isOutOfScope,
} from "./no-dev-stack-fallback.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parser: tsParser,
  },
});

const F = "src/lib/some-module.ts";
const err = { messageId: "devStackFallback" };

ruleTester.run("no-dev-stack-fallback", rule, {
  valid: [
    // --- the resolver path: the shape the rule steers toward ----------------
    { filename: F, code: `const base = resolveEndpoint("api", process.env.NEXT_PUBLIC_API_URL);` },
    // --- product constants: the runner's own port is not a dev-stack port ---
    { filename: F, code: `const r = process.env.X || "http://127.0.0.1:9876";` },
    { filename: F, code: `const r = process.env.X ?? "http://localhost:9876/health";` },
    { filename: F, code: `const r = process.env.X || "https://api.qontinui.io";` },
    // NOT caught, on purpose, and stated: defect 5's two `app/api/vga/*`
    // server-route sites (`QONTINUI_RUNNER_URL ?? "http://localhost:9876"`)
    // used the runner's port, which the vocabulary rules a PRODUCT CONSTANT.
    // PR #1550 routed them through resolveEndpoint("runner", …); this rule
    // does not keep them from regrowing.
    { filename: "src/app/api/vga/capture/route.ts", code: `const RUNNER_URL = process.env.QONTINUI_RUNNER_URL ?? "http://localhost:9876";` },
    // --- a dev-stack literal that is NOT a fallback -------------------------
    { filename: F, code: `const hint = "http://localhost:8000";` },
    { filename: F, code: `const ok = x === "http://localhost:8000";` },
    { filename: "src/components/Form.tsx", code: `const a = <input placeholder="http://localhost:3001" />;`, languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } },
    { filename: F, code: `const r = "http://localhost:8000" || other;` }, // LEFT operand
    { filename: F, code: `const r = a && "http://localhost:8000";` },
    // --- look-alikes: port does not END there, or host is glued -------------
    { filename: F, code: `const r = x || "http://localhost:80001";` },
    { filename: F, code: `const r = x || "localhost:30010";` },
    { filename: F, code: `const r = x || "http://notlocalhost:8000";` },
    { filename: F, code: "const r = x || `${host}:8000`;" },
    // --- non-string right operands ------------------------------------------
    { filename: F, code: `const r = x || DEFAULT_URL;` },
    { filename: F, code: `const r = x ?? 8000;` },
    // --- out of scope: tests and the resolver files -------------------------
    { filename: "src/lib/foo.test.ts", code: `const r = x || "http://localhost:8000";` },
    { filename: "tests/e2e/helpers.ts", code: `const r = x || "http://localhost:3001";` },
    { filename: "playwright.config.ts", code: `const r = x || "http://localhost:3001";` },
    ...Object.keys(RESOLVER_FILES).map((filename) => ({
      filename,
      code: `function f(base = "http://localhost:8000") { return x || "http://localhost:9870"; }`,
    })),
    // Scope is by EXACT path — an absolute ESLint filename resolves the same.
    {
      filename: "/abs/qontinui-web/frontend/src/lib/errors/endpoint-unresolved.ts",
      code: `const r = x || "http://localhost:8000";`,
    },
  ],

  invalid: [
    // --- defect 5's residual sites, verbatim (web 1400265cb) ----------------
    {
      filename: "src/app/(app)/automation-builder/extraction/_hooks/useWebExtraction.ts",
      code: `const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";`,
      errors: [err],
    },
    {
      filename: "src/app/(app)/web-extraction/_hooks/useWebExtractionState.ts",
      code: `const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";`,
      errors: [err],
    },
    {
      filename: "src/lib/vga/grounding-client.ts",
      code: `const LLAMA_SWAP_URL = process.env.QONTINUI_LLAMA_SWAP_URL ?? "http://localhost:8100";`,
      errors: [err],
    },
    {
      filename: "src/services/mcp-client.ts",
      code: `const url = process.env.NEXT_PUBLIC_MCP_URL || "http://localhost:3000/mcp";`,
      errors: [err],
    },
    // --- every flagged port, both loopback spellings ------------------------
    ...FLAGGED_PORTS.flatMap((p) => [
      { filename: F, code: `const r = x || "http://localhost:${p}";`, errors: [err] },
      { filename: F, code: `const r = x ?? "http://127.0.0.1:${p}/v1";`, errors: [err] },
    ]),
    // --- other hosts and shapes the vocabulary names ------------------------
    { filename: F, code: `const r = x || "postgres://u@localhost:5433/qontinui_db";`, errors: [err] },
    { filename: F, code: `const r = x || "http://0.0.0.0:8000";`, errors: [err] },
    { filename: F, code: `const r = x || "http://[::1]:8001";`, errors: [err] },
    { filename: F, code: `const r = x || "http://host.docker.internal:8000";`, errors: [err] },
    { filename: F, code: `const r = x || "localhost:9875";`, errors: [err] },
    // --- chained, wrapped, templated ----------------------------------------
    { filename: F, code: `const r = a || b || "http://localhost:8000";`, errors: [err] },
    { filename: F, code: `const r = x || ("http://localhost:8000" as string);`, errors: [err] },
    { filename: F, code: "const r = x ?? `http://localhost:8000${path}`;", errors: [err] },
    // --- logical assignment -------------------------------------------------
    { filename: F, code: `url ??= "http://localhost:8000";`, errors: [err] },
    { filename: F, code: `url ||= "http://localhost:3001";`, errors: [err] },
    // --- default values: parameter, destructuring, prop ---------------------
    { filename: F, code: `function f(base = "http://localhost:8000") {}`, errors: [err] },
    { filename: F, code: `const f = (base = "http://127.0.0.1:9875") => base;`, errors: [err] },
    { filename: F, code: `const { base = "http://localhost:8000" } = opts;`, errors: [err] },
    {
      filename: "src/components/shared/AppBrowser/AppBrowser.tsx",
      code: `export function AppBrowser({ connectPlaceholder = "http://localhost:3001" }) { return null; }`,
      errors: [err],
    },
    // --- a near-miss of an allowlisted path is NOT exempt -------------------
    { filename: "src/lib/errors/endpoint-unresolved.helpers.ts", code: `const r = x || "http://localhost:8000";`, errors: [err] },
  ],
});

describe("no-dev-stack-fallback scope", () => {
  it("every RESOLVER_FILES entry exists (a stale allowlist entry is a red)", () => {
    for (const rel of Object.keys(RESOLVER_FILES)) {
      expect([rel, existsSync(resolve(HERE, "..", rel))]).toEqual([rel, true]);
    }
  });

  it("every RESOLVER_FILES entry states a reason", () => {
    for (const [rel, why] of Object.entries(RESOLVER_FILES)) {
      expect([rel, why.length > 20]).toEqual([rel, true]);
    }
  });

  it("product source files are in scope", () => {
    expect(isOutOfScope("src/services/mcp-client.ts")).toBe(false);
    expect(isOutOfScope("config/other.mjs")).toBe(false);
    expect(isOutOfScope("C:\\x\\frontend\\src\\lib\\a.ts")).toBe(false);
  });
});
