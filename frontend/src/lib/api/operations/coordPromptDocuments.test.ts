import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordPromptDocuments` function's exact request: the RELATIVE URL
 * written out as a LITERAL (path segments encoded), the method, the body and
 * the retry policy the route walker cannot see.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  createPromptDocument,
  fetchPromptDocument,
  fetchPromptDocumentList,
  fetchPromptDocumentVersion,
  fetchPromptDocumentVersions,
  restorePromptDocumentDefault,
  restorePromptDocumentVersion,
  revertPromptDocument,
  updatePromptDocument,
  withdrawPromptDocument,
} = await import("./coordPromptDocuments");

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const GET = { method: "GET", idempotent: true };

describe("coordPromptDocuments", () => {
  afterEach(() => fetchMock.mockReset());

  it("fetchPromptDocumentList GETs /coord/prompt-documents", async () => {
    fetchMock.mockResolvedValueOnce(answer({ documents: [], total: 0 }));
    await expect(fetchPromptDocumentList()).resolves.toEqual({
      documents: [],
      total: 0,
    });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/prompt-documents",
      GET,
    ]);
  });

  it("the per-document reads encode kind and name", async () => {
    fetchMock.mockImplementation(async () => answer({ ok: true }));
    await fetchPromptDocument("policy", "a b");
    await fetchPromptDocumentVersions("policy", "a b");
    await fetchPromptDocumentVersion("policy", "a b", 3);
    expect(fetchMock.mock.calls).toEqual([
      ["/api/v1/operations/coord/prompt-documents/policy/a%20b", GET],
      ["/api/v1/operations/coord/prompt-documents/policy/a%20b/versions", GET],
      [
        "/api/v1/operations/coord/prompt-documents/policy/a%20b/versions/3",
        GET,
      ],
    ]);
  });

  it("createPromptDocument POSTs the body and is never re-sent on a 5xx", async () => {
    fetchMock.mockResolvedValueOnce(answer({ name: "x" }));
    await createPromptDocument("decision_record", { name: "x", body: "b" });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/v1/operations/coord/prompt-documents/decision_record",
      { method: "POST", body: '{"name":"x","body":"b"}', idempotent: false },
    ]);
  });

  it("updatePromptDocument and revertPromptDocument PATCH the document", async () => {
    fetchMock.mockImplementation(async () => answer({ current_version: 2 }));
    await updatePromptDocument("policy", "p", { body: "b" });
    await revertPromptDocument("policy", "p", {
      body: "old",
      change_description: "undo",
    });
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/v1/operations/coord/prompt-documents/policy/p",
        { method: "PATCH", body: '{"body":"b"}', idempotent: false },
      ],
      [
        "/api/v1/operations/coord/prompt-documents/policy/p",
        {
          method: "PATCH",
          body: '{"body":"old","change_description":"undo"}',
          idempotent: false,
        },
      ],
    ]);
  });

  it("the restore and withdraw POSTs send their exact bodies", async () => {
    fetchMock.mockImplementation(async () => answer({}));
    await restorePromptDocumentDefault("policy", "p");
    await restorePromptDocumentVersion("policy", "p", 2, "why");
    await restorePromptDocumentVersion("policy", "p", 2);
    await withdrawPromptDocument("decision_record", "d", "stale");
    const base = "/api/v1/operations/coord/prompt-documents";
    const post = (body: string) => ({
      method: "POST",
      body,
      idempotent: false,
    });
    expect(fetchMock.mock.calls).toEqual([
      [`${base}/policy/p/restore-default`, post("{}")],
      [`${base}/policy/p/versions/2/restore`, post('{"change_note":"why"}')],
      [`${base}/policy/p/versions/2/restore`, post("{}")],
      [`${base}/decision_record/d/withdraw`, post('{"reason":"stale"}')],
    ]);
  });

  it("rejects a non-2xx in httpClient's error shape with the status readable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 409 }));
    const err = await createPromptDocument("policy", {
      name: "x",
      body: "b",
    }).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "POST /api/v1/operations/coord/prompt-documents/policy failed: 409 - nope"
    );
    expect(httpStatusOf(err)).toBe(409);
  });
});
