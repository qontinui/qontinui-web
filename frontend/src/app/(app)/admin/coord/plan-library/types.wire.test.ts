/**
 * The scan-root wire contract in `types.ts`, pinned against the backend.
 *
 * qontinui-web#1318 closed this defect class on the backend — four
 * hand-written copies of the scan-root state vocabulary with nothing tying any
 * two of them together (`backend/tests/test_plan_scan_root_state_vocabulary.py`,
 * which counts the runner's `ScanDivergenceState` as a fifth) — and in the same
 * diff added a sixth, here, tied to none of them. It also
 * mirrored both response shapes by hand as `ScanRootRow` and
 * `ScanRootListResponse`. Nothing crossed that seam: vitest strips types
 * without checking them, and `npm run type-check` excludes test files
 * altogether.
 *
 * So the pin is a chain of links, each of which CI already enforces or this
 * file adds:
 *
 * 1. backend schema → `openapi-schema*.json`: `backend-ci.yml` regenerates both
 *    snapshots from `app.openapi()` and fails on any difference.
 * 2. snapshot → the runtime witnesses in `types.ts`: this file.
 * 3. witnesses → the interfaces: `npm run type-check`, because
 *    `WireNullability<T>` admits only a value that names every field exactly
 *    and flags its nullability correctly.
 *
 * A failure here means the backend changed the wire and this console was not
 * told. Fix `types.ts` — and the panel, if a state was added. Never fix the
 * expected values below: they are read from the snapshot, not written here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SCAN_ROOT_LIST_NULLABLE,
  SCAN_ROOT_LIST_STATES,
  SCAN_ROOT_ROLLUP_NULLABLE,
  SCAN_ROOT_ROLLUP_STATES,
  SCAN_ROOT_ROW_NULLABLE,
  SCAN_ROOT_STATES,
} from "./types";

const API_CLIENT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../lib/api-client"
);

/** Both snapshots backend CI regenerates: the composed one and the OSS base. */
const SNAPSHOTS = ["openapi-schema.json", "openapi-schema.base.json"] as const;

interface SchemaProperty {
  type?: string;
  enum?: string[];
  anyOf?: { type?: string }[];
  items?: { $ref?: string };
}

interface ObjectSchema {
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

/** Each snapshot is ~3.4 MB; parse it once, not once per component. */
const documents = new Map<
  string,
  { components?: { schemas?: Record<string, unknown> } }
>();

/**
 * One component schema, or a thrown error naming it.
 *
 * Never an empty object: comparing a missing component as `{}` would turn a
 * backend rename into "no fields, no states" and then fail — or, for a check
 * written the other way round, pass — for a reason nobody can read.
 */
function component(file: string, name: string): ObjectSchema {
  let doc = documents.get(file);
  if (doc === undefined) {
    doc = JSON.parse(readFileSync(path.join(API_CLIENT, file), "utf8"));
    documents.set(file, doc);
  }
  const found = doc?.components?.schemas?.[name];
  if (!found?.properties) {
    throw new Error(`${name} is not in ${file} — renamed on the backend?`);
  }
  return found as ObjectSchema;
}

/** Pydantic renders `X | None` as `anyOf: [{type: X}, {type: "null"}]`. */
function admitsNull(prop: SchemaProperty): boolean {
  return (
    prop.type === "null" ||
    (prop.anyOf ?? []).some((arm) => arm.type === "null")
  );
}

function enumOf(schema: ObjectSchema, field: string): string[] {
  const values = schema.properties[field]?.enum;
  if (!values?.length) {
    throw new Error(
      `${field} carries no enum — no longer a closed vocabulary?`
    );
  }
  return [...values].sort();
}

const sorted = (values: Iterable<string>) => [...values].sort();

describe.each(SNAPSHOTS)("the scan-root wire contract, against %s", (file) => {
  const row = component(file, "ScanRootRow");
  const list = component(file, "ScanRootListResponse");
  const rollup = component(file, "ScanRootSourceRollup");
  const corpus = component(file, "CorpusHealth");

  it("the row's verdict admits exactly SCAN_ROOT_STATES", () => {
    expect(enumOf(row, "state")).toEqual(sorted(SCAN_ROOT_STATES));
  });

  it("so does what the device reported — the same vocabulary, not a verdict", () => {
    expect(enumOf(row, "reported_state")).toEqual(sorted(SCAN_ROOT_STATES));
  });

  it("the list's verdict admits exactly SCAN_ROOT_LIST_STATES", () => {
    expect(enumOf(list, "state")).toEqual(sorted(SCAN_ROOT_LIST_STATES));
  });

  it("the list's rows are the row schema pinned above", () => {
    expect(list.properties.rows?.items?.$ref).toBe(
      "#/components/schemas/ScanRootRow"
    );
  });

  it("a roll-up's verdict admits exactly SCAN_ROOT_ROLLUP_STATES", () => {
    expect(enumOf(rollup, "state")).toEqual(sorted(SCAN_ROOT_ROLLUP_STATES));
  });

  it("the list's roll-ups are the roll-up schema pinned here", () => {
    expect(list.properties.by_source_repo?.items?.$ref).toBe(
      "#/components/schemas/ScanRootSourceRollup"
    );
  });

  it("corpus health carries the list schema, not a second copy of it", () => {
    expect(
      (corpus.properties.scan_roots as { $ref?: string } | undefined)?.$ref
    ).toBe("#/components/schemas/ScanRootListResponse");
  });

  describe.each([
    ["ScanRootRow", row, SCAN_ROOT_ROW_NULLABLE],
    ["ScanRootListResponse", list, SCAN_ROOT_LIST_NULLABLE],
    ["ScanRootSourceRollup", rollup, SCAN_ROOT_ROLLUP_NULLABLE],
  ] as const)("%s", (_name, schema, witness) => {
    it("names exactly the fields the backend serves", () => {
      expect(sorted(Object.keys(witness))).toEqual(
        sorted(Object.keys(schema.properties))
      );
    });

    it("is nullable exactly where the wire is", () => {
      // The one that matters most: a field the backend makes nullable while
      // `types.ts` still says `number` is a `null` the panel renders as a
      // measurement. `behind: null` is NOT MEASURED, and a type that hides the
      // possibility is how it becomes a `0`.
      const served = Object.fromEntries(
        Object.entries(schema.properties).map(([field, prop]) => [
          field,
          admitsNull(prop),
        ])
      );
      expect(witness).toEqual(served);
    });

    it("requires every field, as the interface does", () => {
      expect(sorted(schema.required ?? [])).toEqual(
        sorted(Object.keys(schema.properties))
      );
    });
  });
});
