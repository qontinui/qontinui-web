import { describe, expect, it, vi } from "vitest";
import type { EstimateDetail } from "../../../_lib/estimate-api";
import { saveThenRecordSource } from "./save";

const saved = {
  estimate: { id: "e1", version: 4, source_page_id: null },
} as unknown as EstimateDetail;

describe("saveThenRecordSource", () => {
  it("records the document on the version the save produced", async () => {
    const patch = vi
      .fn()
      .mockResolvedValue({ id: "e1", version: 5, source_page_id: "doc-1" });
    const out = await saveThenRecordSource({
      save: async () => saved,
      patch,
      sourceId: "doc-1",
      errorText: String,
    });
    expect(patch).toHaveBeenCalledWith("e1", {
      source_page_id: "doc-1",
      expected_version: 4,
    });
    expect(out.fresh.estimate.version).toBe(5);
    expect(out.sourceError).toBeUndefined();
  });

  it("writes nothing more when there is no document, or it is already the source", async () => {
    const patch = vi.fn();
    await saveThenRecordSource({
      save: async () => saved,
      patch,
      sourceId: null,
      errorText: String,
    });
    const linked = {
      estimate: { ...saved.estimate, source_page_id: "doc-1" },
    } as EstimateDetail;
    await saveThenRecordSource({
      save: async () => linked,
      patch,
      sourceId: "doc-1",
      errorText: String,
    });
    expect(patch).not.toHaveBeenCalled();
  });

  it("keeps the saved content and reports why the link failed", async () => {
    const out = await saveThenRecordSource({
      save: async () => saved,
      patch: vi.fn().mockRejectedValue(new Error("HTTP 409")),
      sourceId: "doc-1",
      errorText: (e) => (e as Error).message,
    });
    expect(out.fresh).toBe(saved);
    expect(out.sourceError).toBe("HTTP 409");
  });

  it("does not try the link when the save itself fails", async () => {
    const patch = vi.fn();
    await expect(
      saveThenRecordSource({
        save: async () => {
          throw new Error("HTTP 409");
        },
        patch,
        sourceId: "doc-1",
        errorText: String,
      })
    ).rejects.toThrow("HTTP 409");
    expect(patch).not.toHaveBeenCalled();
  });
});
