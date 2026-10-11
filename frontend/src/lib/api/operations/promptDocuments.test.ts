import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/** Pins each prompt-document function's literal URL, method, body and retry claim. */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const m = await import("./promptDocuments");

const OK = () => new Response("{}", { status: 200 });
const P = "/api/v1/operations/coord/prompt-documents";

describe("promptDocuments", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("clause reads and writes hit /clauses with the right verbs", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(OK()));
    await m.fetchClauses("policy", "a b");
    await m.createClause("policy", "a b", { clause_id: "c" } as never);
    await m.updateClause("policy", "a b", "c/1", {} as never);
    await m.reorderClauses("policy", "a b", ["x", "y"]);
    const calls = fetchMock.mock.calls;
    expect(calls[0][0]).toBe(`${P}/policy/a%20b/clauses`);
    expect(calls[0][1]).toMatchObject({ method: "GET" });
    expect(calls[1][1]).toMatchObject({ method: "POST" });
    expect(calls[2][0]).toBe(`${P}/policy/a%20b/clauses/c%2F1`);
    expect(calls[2][1]).toMatchObject({ method: "PATCH" });
    expect(calls[3][0]).toBe(`${P}/policy/a%20b/clauses/reorder`);
    expect(calls[3][1].body).toBe(JSON.stringify({ clause_ids: ["x", "y"] }));
  });

  it("deleteClause accepts a 204", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(m.deleteClause("policy", "n", "c")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]).toEqual([
      `${P}/policy/n/clauses/c`,
      { method: "DELETE" },
    ]);
  });

  it("patchPromptDocument sends idempotent only when claimed", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(OK()));
    await m.patchPromptDocument(
      "policy",
      "n",
      { attrs: {} },
      { idempotent: true }
    );
    await m.patchPromptDocument("policy", "n", { publish_mode: "auto" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "PATCH",
      idempotent: true,
    });
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("idempotent");
  });

  it("publication and upstream routes", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(OK()));
    await m.fetchPublications("policy", "n");
    await m.fetchPublication("policy", "n", 3);
    await m.publishDocument("policy", "n", {
      release_note: null,
      expected_version: 2,
    });
    await m.adoptUpstream("policy", "n", {
      publication_version: 1,
      expected_version: 2,
    });
    await m.keepUpstream("policy", "n", {
      publication_version: 1,
      expected_version: 2,
    });
    await m.fetchUpstreamMergePreview("policy", "n", 4);
    await m.applyUpstreamMerge("policy", "n", {
      publication_version: 1,
      expected_version: 2,
      resolutions: {},
    });
    const urls = fetchMock.mock.calls.map((c) => [c[1].method, c[0]]);
    expect(urls).toEqual([
      [
        "GET",
        "/api/v1/operations/coord/prompt-document-publications?kind=policy&name=n",
      ],
      [
        "GET",
        "/api/v1/operations/coord/prompt-document-publications/policy/n/3",
      ],
      ["POST", `${P}/policy/n/publish`],
      ["POST", `${P}/policy/n/upstream-adopt`],
      ["POST", `${P}/policy/n/upstream-keep`],
      ["GET", `${P}/policy/n/upstream-merge?publication_version=4`],
      ["POST", `${P}/policy/n/upstream-merge`],
    ]);
  });

  it("publish-all preview is dry_run true; the armed run sends dry_run false explicitly", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(OK()));
    await m.previewPublishAll();
    await m.runPublishAll({ release_note: "n", items: [] });
    expect(fetchMock.mock.calls[0]).toEqual([
      `${P}/publish-all`,
      { method: "POST", body: JSON.stringify({ dry_run: true }) },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      dry_run: false,
      release_note: "n",
      items: [],
    });
  });

  it("fetchAutoPublishStatus GETs the status route", async () => {
    fetchMock.mockResolvedValueOnce(OK());
    await m.fetchAutoPublishStatus();
    expect(fetchMock.mock.calls[0][0]).toBe(`${P}/auto-publish/status`);
  });

  it("a non-2xx rejects in the helpers' shape, readable by the refusal sniffers", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"not_system_tenant"}', { status: 403 })
    );
    const err = await m.previewPublishAll().catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `POST ${P}/publish-all failed: 403 - {"error":"not_system_tenant"}`
    );
    expect(httpStatusOf(err)).toBe(403);
  });
});
