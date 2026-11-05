/**
 * Drift guard for the `@qontinui/ui-bridge` root-import restriction.
 *
 * #2069 listed every context-bound export of `/react` — for ui-bridge 0.35.0.
 * A later version that adds a context hook would leave it importable from the
 * package root, failing silently the way #2037 and #2068 did. This suite reads
 * the INSTALLED `/react` entry's runtime exports and requires each one to be
 * classified exactly once, and checks that the live eslint config enforces the
 * context-bound list (and only it).
 */

import { describe, expect, it } from "vitest";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import {
  UI_BRIDGE_CONTEXT_BOUND_EXPORTS,
  UI_BRIDGE_CONTEXT_FREE_EXPORTS,
  UI_BRIDGE_ROOT_ONLY_CONTEXT_FREE_REACT_EXPORTS,
} from "./ui-bridge-root-imports.mjs";

const reactEntry = await import("@qontinui/ui-bridge/react");
const installed = Object.keys(reactEntry).filter((k) => k !== "default");
const rootEntry = await import("@qontinui/ui-bridge");
const reactNames = new Set(installed);
// A hook (`use*`) or a function component (PascalCase, not a class) that the
// root exports and /react does not. Root-only classes are not React.
const isHookOrComponent = (name, value) =>
  typeof value === "function" &&
  (/^use[A-Z]/.test(name) ||
    (/^[A-Z]/.test(name) &&
      !/^class\b/.test(Function.prototype.toString.call(value))));
const rootOnlyReact = Object.entries(rootEntry)
  .filter(
    ([name, value]) => !reactNames.has(name) && isHookOrComponent(name, value)
  )
  .map(([name]) => name);

describe("ui-bridge root-only React exports", () => {
  // The /react partition cannot see a hook or component the root exports and
  // /react does not: there is no /react copy, so one that read UIBridgeContext
  // would read the root bundle's never-provided context.
  it("lists every root-only hook and function component of the installed root", () => {
    const listed = new Set(UI_BRIDGE_ROOT_ONLY_CONTEXT_FREE_REACT_EXPORTS);
    // A new name here: check its body in node_modules/@qontinui/ui-bridge/dist/index.mjs.
    // If it reads no context, add it to UI_BRIDGE_ROOT_ONLY_CONTEXT_FREE_REACT_EXPORTS;
    // if it reads UIBridgeContext, it is unusable from root in this app —
    // restrict it in eslint.config.mjs and ask ui-bridge to export it from /react.
    expect(rootOnlyReact.filter((name) => !listed.has(name))).toEqual([]);
  });

  it("lists no root-only name the installed root does not export", () => {
    const exported = new Set(rootOnlyReact);
    expect(
      UI_BRIDGE_ROOT_ONLY_CONTEXT_FREE_REACT_EXPORTS.filter(
        (name) => !exported.has(name)
      )
    ).toEqual([]);
  });
});

describe("ui-bridge root-import partition", () => {
  it("classifies every runtime export of the installed /react entry", () => {
    const classified = new Set([
      ...UI_BRIDGE_CONTEXT_BOUND_EXPORTS,
      ...UI_BRIDGE_CONTEXT_FREE_EXPORTS,
    ]);
    const unclassified = installed.filter((name) => !classified.has(name));
    // A new name here: add it to UI_BRIDGE_CONTEXT_BOUND_EXPORTS if it reads or
    // mounts UIBridgeContext, otherwise to UI_BRIDGE_CONTEXT_FREE_EXPORTS.
    expect(unclassified).toEqual([]);
  });

  it("lists no name the installed /react entry does not export", () => {
    const exported = new Set(installed);
    const stale = [
      ...UI_BRIDGE_CONTEXT_BOUND_EXPORTS,
      ...UI_BRIDGE_CONTEXT_FREE_EXPORTS,
    ].filter((name) => !exported.has(name));
    expect(stale).toEqual([]);
  });

  it("puts no name in both lists, and none twice", () => {
    const all = [
      ...UI_BRIDGE_CONTEXT_BOUND_EXPORTS,
      ...UI_BRIDGE_CONTEXT_FREE_EXPORTS,
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("eslint config enforces the context-bound list", () => {
  // Resolve the rule the way eslint does for a real app file, so a later config
  // entry that overrides or turns off no-restricted-imports fails this suite.
  const frontendDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const resolveRule = async (filePath) => {
    const config = await new ESLint({
      cwd: frontendDir,
    }).calculateConfigForFile(filePath);
    const rule = config.rules?.["no-restricted-imports"];
    expect(
      rule,
      `no-restricted-imports is not configured for ${filePath}`
    ).toBeDefined();
    return rule;
  };
  const lint = async (names, filePath = "src/components/x.tsx") =>
    new Linter({ configType: "flat" })
      .verify(`import { ${names.join(", ")} } from "@qontinui/ui-bridge";`, [
        {
          languageOptions: { ecmaVersion: "latest", sourceType: "module" },
          rules: { "no-restricted-imports": await resolveRule(filePath) },
        },
      ])
      .filter((m) => m.ruleId === "no-restricted-imports");

  it.each([
    "src/components/x.tsx",
    "src/lib/ui-bridge/x.ts",
    "src/app/x/page.tsx",
  ])(
    "flags every context-bound name imported from the root in %s",
    async (filePath) => {
      expect(
        await lint(UI_BRIDGE_CONTEXT_BOUND_EXPORTS, filePath)
      ).toHaveLength(UI_BRIDGE_CONTEXT_BOUND_EXPORTS.length);
    }
  );

  it("leaves every context-free name importable from the package root", async () => {
    expect(
      await lint([
        ...UI_BRIDGE_CONTEXT_FREE_EXPORTS,
        ...UI_BRIDGE_ROOT_ONLY_CONTEXT_FREE_REACT_EXPORTS,
      ])
    ).toEqual([]);
  });
});
