/**
 * The served-catalog fixture (`test-catalog.ts`) declares each row's door the
 * way coord does. Coord's catalog is recorded in one place in this repo, the
 * derived spec's catalog stub
 * (`specs/pages/digital-twin/state-machine.derived.json`), so the fixture is
 * held to that stub. Otherwise a row coord answers with a report could be
 * declared a verdict door by the fixture. That had already happened to
 * train_activity and merge_economics, and main's secrets_broker row would
 * have been the third.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MANIFEST_SNAPSHOT_IDS,
  REPORT_DOORS,
  catalogDeclaring,
} from "./test-catalog";
import type { TwinCatalogResponse } from "./types";

const SPEC = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../../../specs/pages/digital-twin/state-machine.derived.json"
    ),
    "utf-8"
  )
) as { metadata: { routeStubs: { urlPattern: string; body: unknown }[] } };

const STUB_CATALOG = SPEC.metadata.routeStubs.find(
  (s) => s.urlPattern === "**/api/v1/digital-twin/catalog"
)!.body as TwinCatalogResponse;

describe("the served-catalog fixture", () => {
  it("declares each manifest snapshot row's door as the spec's catalog stub records it", () => {
    const stubbed = STUB_CATALOG.entries.filter(
      (e) => MANIFEST_SNAPSHOT_IDS.includes(e.subspace) && e.door_shape
    );
    expect(stubbed.length).toBeGreaterThan(0);
    for (const entry of stubbed) {
      expect(
        catalogDeclaring([entry.subspace]).entries[0]!.door_shape,
        entry.subspace
      ).toBe(entry.door_shape);
    }
  });

  it("names a report door for exactly the rows the stub answers with a report", () => {
    const reports = STUB_CATALOG.entries
      .filter((e) => e.door_shape === "report")
      .map((e) => e.subspace)
      .sort();
    expect(reports.length).toBeGreaterThan(0);
    expect([...REPORT_DOORS].sort()).toEqual(reports);
  });
});
