/**
 * Canonical JSON serialization for VGA state machines.
 *
 * MUST match `VgaStateMachine.to_canonical_json` in
 * `qontinui/src/qontinui/vga/state_machine.py`:
 *
 *   1. Fields `created_at` / `updated_at` are stripped from the top level.
 *   2. Per-element fields `last_confirmed_at` / `correction_count` are
 *      stripped from every element inside every state.
 *   3. JSON object keys are sorted alphabetically, recursively.
 *   4. Output uses compact separators (`,` and `:`) — no whitespace.
 *
 * This file has a parity twin at
 * `qontinui/src/qontinui/vga/state_machine.py`. Shared fixtures live at
 * `test-fixtures/vga/canonical-state-machine{,.canonical}.json`. Tests
 * (`canonical.parity.test.ts` here + `test_vga_canonical_parity.py` on
 * the Python side) must update both OR canonical JSON will diverge
 * silently and CI will fail.
 *
 * The SHA-256 of this output is the `content_hash` used for git-
 * versioning and content-addressable storage. Any drift here silently
 * breaks downstream deduplication. If you change this, mirror the
 * change in the Python side in the same commit.
 */

import type { VgaCanonicalExport, VgaStateMachineGraph } from "@/lib/types/vga";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortJsonValue(obj[key]);
    }
    return sorted;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  // Fallback: coerce unknown primitive-like values to string.
  return String(value);
}

/**
 * Build a canonical export object from a DB row's raw fields.
 *
 * The Python model exports `id` as a stringified UUID. We include it
 * too — downstream consumers that want a bare-payload hash can strip
 * it themselves before hashing if needed (the Python side currently
 * also includes it via `model_dump`).
 */
export function buildCanonicalExport(args: {
  id: string;
  name: string;
  targetProcess: string;
  targetOs: string;
  groundingModel: string;
  private: boolean;
  stateGraph: VgaStateMachineGraph;
}): VgaCanonicalExport {
  // Strip timestamps + correction_count from nested elements.
  const cleanStates = args.stateGraph.states.map((state) => ({
    id: state.id,
    name: state.name,
    blocking: state.blocking,
    elements: state.elements.map((element) => ({
      id: element.id,
      label: element.label,
      prompt: element.prompt,
      bbox: element.bbox,
    })),
  }));

  return {
    id: args.id,
    name: args.name,
    target_process: args.targetProcess,
    target_os: args.targetOs,
    grounding_model: args.groundingModel,
    private: args.private,
    states: cleanStates as VgaCanonicalExport["states"],
    transitions: args.stateGraph.transitions,
  };
}

/**
 * Serialize a canonical export with sorted keys and no whitespace.
 *
 * Returns a string exactly matching what
 * `json.dumps(data, sort_keys=True, separators=(",", ":"))` produces
 * on the Python side.
 */
export function canonicalJsonString(export_: VgaCanonicalExport): string {
  const sorted = sortJsonValue(export_);
  return JSON.stringify(sorted);
}
