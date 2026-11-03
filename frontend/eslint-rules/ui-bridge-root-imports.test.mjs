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
import { Linter } from "eslint";
import eslintConfig from "../eslint.config.mjs";
import {
  UI_BRIDGE_CONTEXT_BOUND_EXPORTS,
  UI_BRIDGE_CONTEXT_FREE_EXPORTS,
} from "./ui-bridge-root-imports.mjs";

const reactEntry = await import("@qontinui/ui-bridge/react");
const installed = Object.keys(reactEntry).filter((k) => k !== "default");

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
  const block = eslintConfig.find(
    (entry) => entry?.rules?.["no-restricted-imports"] !== undefined,
  );
  const lint = (names) =>
    new Linter({ configType: "flat" })
      .verify(
        `import { ${names.join(", ")} } from "@qontinui/ui-bridge";`,
        [
          {
            languageOptions: { ecmaVersion: "latest", sourceType: "module" },
            rules: block.rules,
          },
        ],
      )
      .filter((m) => m.ruleId === "no-restricted-imports");

  it("flags every context-bound name imported from the package root", () => {
    expect(lint(UI_BRIDGE_CONTEXT_BOUND_EXPORTS)).toHaveLength(
      UI_BRIDGE_CONTEXT_BOUND_EXPORTS.length,
    );
  });

  it("leaves every context-free name importable from the package root", () => {
    expect(lint(UI_BRIDGE_CONTEXT_FREE_EXPORTS)).toEqual([]);
  });
});
