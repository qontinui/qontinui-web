/**
 * The Add view's batch limit is the backend's, not a second copy that can
 * drift: `CAPTURE_JOB_BATCH_MAX_URLS` must equal `CaptureJobBatchCreate.urls`
 * `maxItems` in both committed OpenAPI snapshots (which backend CI regenerates
 * from `app.openapi()` and fails on any difference).
 */

import { describe, expect, it } from "vitest";
import { CAPTURE_JOB_BATCH_MAX_URLS } from "./design-refs";
import { loadSnapshot, type SnapshotFile } from "./route-walker";

const SNAPSHOTS: readonly SnapshotFile[] = [
  "openapi-schema.json",
  "openapi-schema.base.json",
];

describe("CAPTURE_JOB_BATCH_MAX_URLS", () => {
  it.each(SNAPSHOTS)("equals the backend's batch maxItems in %s", (file) => {
    const schema = loadSnapshot(file).components?.schemas?.[
      "CaptureJobBatchCreate"
    ] as { properties?: { urls?: { maxItems?: number } } } | undefined;
    expect(schema?.properties?.urls?.maxItems).toBe(CAPTURE_JOB_BATCH_MAX_URLS);
  });
});
