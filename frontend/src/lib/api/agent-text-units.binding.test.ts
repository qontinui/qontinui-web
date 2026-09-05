/**
 * The drift gate for the local `AgentTextUnitDefault` mirror.
 *
 * `lib/api/agent-text-units.ts` declares `AgentTextUnitDefault` by hand because
 * this app cannot resolve the generated binding (the published
 * `@qontinui/shared-types` predates the type; see the interface's own doc
 * comment). A hand copy is precisely the "third hand-written copy" plan
 * `2026-08-31-runner-publishes-embedded-command-defaults` Design decision 8
 * warns about, so it does not get to be prose-only: this test reads the
 * generated `.d.ts` from the sibling `qontinui-schemas` checkout and asserts
 * the field set matches the runtime key list the module exports.
 *
 * Skipped — loudly, with the reason — where the sibling checkout is absent
 * (CI checks out one repo). A skip is UNKNOWN, not a pass.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AGENT_TEXT_UNIT_DEFAULT_KEYS } from "./agent-text-units";

const GENERATED = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../qontinui-schemas/ts/src/generated/AgentTextUnitDefault.d.ts"
);

/** Top-level property names of the ONE exported interface in a generated
 *  `.d.ts` — a line-anchored `name: type;` at two-space indentation, which is
 *  the shape every file in that directory has. Nested object members
 *  (`files: { [k: string]: string }`) are indented deeper and excluded. */
function interfaceKeys(source: string): string[] {
  const body = source.slice(source.indexOf("export interface"));
  return [...body.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/gm)]
    .map((m) => m[1] ?? "")
    .filter(Boolean)
    .sort();
}

describe("AgentTextUnitDefault mirror", () => {
  const present = existsSync(GENERATED);

  it.skipIf(!present)(
    "carries exactly the generated binding's fields (sibling checkout present)",
    () => {
      const generated = interfaceKeys(readFileSync(GENERATED, "utf8"));
      expect(generated).toEqual([...AGENT_TEXT_UNIT_DEFAULT_KEYS]);
    }
  );

  it("declares a sorted, non-empty key set even when the sibling is absent", () => {
    if (!present) {
      // Say what was not checked, so a green run is not read as agreement.
      console.warn(
        `AgentTextUnitDefault drift gate SKIPPED: ${GENERATED} not present — ` +
          "the mirror's agreement with the generated binding is UNKNOWN here."
      );
    }
    expect(AGENT_TEXT_UNIT_DEFAULT_KEYS.length).toBeGreaterThan(0);
    expect([...AGENT_TEXT_UNIT_DEFAULT_KEYS]).toEqual(
      [...AGENT_TEXT_UNIT_DEFAULT_KEYS].sort()
    );
  });
});
