import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordPromptDocuments` function's exact request: the RELATIVE URL
 * written out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the `encodeURIComponent` of every path parameter, and
 * the `httpClient.fetch` options the route walker cannot see — the method and
 * the stated retry policy. `toEqual` on the whole call keeps them that way
 * unless a change says so. Bodies are compared as strings, so the wire key
 * order is pinned too.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const api = await import("./coordPromptDocuments");

const P = "/api/v1/operations/coord/prompt-documents";
/** A kind/name that only survives the trip as one path segment if encoded. */
const KIND = "po/licy #1";
const KIND_E = "po%2Flicy%20%231";
const NAME = "a b/c";
const NAME_E = "a%20b%2Fc";
const DOC = `${P}/${KIND_E}/${NAME_E}`;

const GET = { method: "GET", idempotent: true };
const post = (body: string) => ({
  method: "POST",
  body,
  idempotent: false,
});
const patch = (body: string, idempotent: boolean) => ({
  method: "PATCH",
  body,
  idempotent,
});

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

interface Case {
  name: string;
  call: () => Promise<unknown>;
  url: string;
  init: Record<string, unknown>;
}

// `kind` is a union at the type level; the encoding test feeds it a hostile
// string on purpose.
const kind = KIND as never;

const CASES: Case[] = [
  {
    name: "listPromptDocuments",
    call: () => api.listPromptDocuments(),
    url: P,
    init: GET,
  },
  {
    name: "fetchPromptDocument",
    call: () => api.fetchPromptDocument(kind, NAME),
    url: DOC,
    init: GET,
  },
  {
    name: "createPromptDocument",
    call: () => api.createPromptDocument(kind, { name: "n", body: "b" }),
    url: `${P}/${KIND_E}`,
    init: post('{"name":"n","body":"b"}'),
  },
  {
    name: "updatePromptDocument",
    call: () => api.updatePromptDocument(KIND, NAME, { body: "b" }),
    url: DOC,
    init: patch('{"body":"b"}', false),
  },
  {
    name: "patchPromptDocumentAttrs",
    call: () => api.patchPromptDocumentAttrs(kind, NAME, {}),
    url: DOC,
    init: patch('{"attrs":{}}', true),
  },
  {
    name: "restorePromptDocumentDefault",
    call: () => api.restorePromptDocumentDefault(kind, NAME),
    url: `${DOC}/restore-default`,
    init: post("{}"),
  },
  {
    name: "fetchPromptDocumentVersions",
    call: () => api.fetchPromptDocumentVersions(KIND, NAME),
    url: `${DOC}/versions`,
    init: GET,
  },
  {
    name: "fetchPromptDocumentVersion",
    call: () => api.fetchPromptDocumentVersion(KIND, NAME, 3),
    url: `${DOC}/versions/3`,
    init: GET,
  },
  {
    name: "restorePromptDocumentVersion",
    call: () => api.restorePromptDocumentVersion(kind, NAME, 3, "why"),
    url: `${DOC}/versions/3/restore`,
    init: post('{"change_note":"why"}'),
  },
  {
    name: "restorePromptDocumentVersion without a note",
    call: () => api.restorePromptDocumentVersion(kind, NAME, 3),
    url: `${DOC}/versions/3/restore`,
    init: post("{}"),
  },
  {
    name: "withdrawPromptDocument",
    call: () => api.withdrawPromptDocument(KIND, NAME, "dup"),
    url: `${DOC}/withdraw`,
    init: post('{"reason":"dup"}'),
  },
  {
    name: "listClauses",
    call: () => api.listClauses(kind, NAME),
    url: `${DOC}/clauses`,
    init: GET,
  },
  {
    name: "createClause",
    call: () => api.createClause(kind, NAME, { clause_id: "c1" } as never),
    url: `${DOC}/clauses`,
    init: post('{"clause_id":"c1"}'),
  },
  {
    name: "updateClause",
    call: () => api.updateClause(kind, NAME, "c/1 x", { title: "t" } as never),
    url: `${DOC}/clauses/c%2F1%20x`,
    init: patch('{"title":"t"}', false),
  },
  {
    name: "deleteClause",
    call: () => api.deleteClause(kind, NAME, "c/1 x"),
    url: `${DOC}/clauses/c%2F1%20x`,
    init: { method: "DELETE", idempotent: true },
  },
  {
    name: "reorderClauses",
    call: () => api.reorderClauses(kind, NAME, ["b", "a"]),
    url: `${DOC}/clauses/reorder`,
    init: post('{"clause_ids":["b","a"]}'),
  },
  {
    name: "listPublications",
    call: () => api.listPublications(kind, NAME),
    url: `/api/v1/operations/coord/prompt-document-publications?kind=${KIND_E}&name=${NAME_E}`,
    init: GET,
  },
  {
    name: "fetchPublication",
    call: () => api.fetchPublication(kind, NAME, 2),
    url: `/api/v1/operations/coord/prompt-document-publications/${KIND_E}/${NAME_E}/2`,
    init: GET,
  },
  {
    name: "publishPromptDocument",
    call: () =>
      api.publishPromptDocument(kind, NAME, {
        release_note: null,
        expected_version: 4,
      }),
    url: `${DOC}/publish`,
    init: post('{"release_note":null,"expected_version":4}'),
  },
  {
    name: "adoptUpstreamPublication",
    call: () => api.adoptUpstreamPublication(kind, NAME, 2, 4),
    url: `${DOC}/upstream-adopt`,
    init: post('{"publication_version":2,"expected_version":4}'),
  },
  {
    name: "keepOwnAgainstUpstream",
    call: () => api.keepOwnAgainstUpstream(kind, NAME, 2, 4),
    url: `${DOC}/upstream-keep`,
    init: post('{"publication_version":2,"expected_version":4}'),
  },
  {
    name: "fetchUpstreamMergePreview",
    call: () => api.fetchUpstreamMergePreview(kind, NAME, 2),
    url: `${DOC}/upstream-merge?publication_version=2`,
    init: GET,
  },
  {
    name: "applyUpstreamMerge",
    call: () => api.applyUpstreamMerge(kind, NAME, 2, 4, { c1: "local" }),
    url: `${DOC}/upstream-merge`,
    init: post(
      '{"publication_version":2,"expected_version":4,"resolutions":{"c1":"local"}}'
    ),
  },
  {
    name: "previewPublishAll",
    call: () => api.previewPublishAll(),
    url: `${P}/publish-all`,
    init: post('{"dry_run":true}'),
  },
  {
    name: "publishAllDocuments",
    call: () =>
      api.publishAllDocuments({
        dry_run: false,
        release_note: "n",
        items: [],
      }),
    url: `${P}/publish-all`,
    init: post('{"dry_run":false,"release_note":"n","items":[]}'),
  },
  {
    name: "fetchAutoPublishStatus",
    call: () => api.fetchAutoPublishStatus(),
    url: `${P}/auto-publish/status`,
    init: GET,
  },
  {
    name: "fetchKindTiers",
    call: () => api.fetchKindTiers(),
    url: "/api/v1/operations/coord/prompt-document-kind-tiers",
    init: GET,
  },
  {
    name: "putKindTier",
    call: () => api.putKindTier(KIND, "allow"),
    url: `/api/v1/operations/coord/prompt-document-kind-tiers/${KIND_E}`,
    init: { method: "PUT", body: '{"tier":"allow"}', idempotent: true },
  },
  {
    name: "deleteKindTier",
    call: () => api.deleteKindTier(KIND),
    url: `/api/v1/operations/coord/prompt-document-kind-tiers/${KIND_E}`,
    init: { method: "DELETE", idempotent: true },
  },
  {
    name: "fetchComplianceConfig",
    call: () => api.fetchComplianceConfig(),
    url: "/api/v1/operations/coord/session-compliance/config",
    init: GET,
  },
  {
    name: "putComplianceConfig",
    call: () => api.putComplianceConfig({ mode: "nudge" } as never),
    url: "/api/v1/operations/coord/session-compliance/config",
    init: { method: "PUT", body: '{"mode":"nudge"}', idempotent: true },
  },
  {
    name: "fetchComplianceConfigVersions",
    call: () => api.fetchComplianceConfigVersions(),
    url: "/api/v1/operations/coord/session-compliance/config/versions",
    init: GET,
  },
  {
    name: "fetchComplianceSessions with every filter",
    call: () =>
      api.fetchComplianceSessions({
        limit: 25,
        verdict: "unverified",
        cursor: "a&b=c",
      }),
    url: "/api/v1/operations/coord/session-compliance/sessions?limit=25&verdict=unverified&cursor=a%26b%3Dc",
    init: GET,
  },
  {
    name: "fetchComplianceSessions with only a limit",
    call: () => api.fetchComplianceSessions({ limit: 25 }),
    url: "/api/v1/operations/coord/session-compliance/sessions?limit=25",
    init: GET,
  },
  {
    name: "fetchComplianceOutstanding",
    call: () => api.fetchComplianceOutstanding(),
    url: "/api/v1/operations/coord/session-compliance/outstanding",
    init: GET,
  },
  {
    name: "listPolicyProposals without a limit",
    call: () => api.listPolicyProposals("pending"),
    url: "/api/v1/operations/coord/prompt-document-proposals?status=pending",
    init: GET,
  },
  {
    name: "listPolicyProposals with a limit",
    call: () => api.listPolicyProposals("a b", 20),
    url: "/api/v1/operations/coord/prompt-document-proposals?status=a%20b&limit=20",
    init: GET,
  },
  {
    name: "decidePolicyProposal approve with a note",
    call: () => api.decidePolicyProposal("p/1 x", "approve", "ok"),
    url: "/api/v1/operations/coord/prompt-document-proposals/p%2F1%20x/approve",
    init: post('{"decision_note":"ok"}'),
  },
  {
    name: "decidePolicyProposal reject without a note",
    call: () => api.decidePolicyProposal("p/1 x", "reject", ""),
    url: "/api/v1/operations/coord/prompt-document-proposals/p%2F1%20x/reject",
    init: post("{}"),
  },
  {
    name: "listPromptDocumentWrites",
    call: () => api.listPromptDocumentWrites(40),
    url: "/api/v1/operations/coord/prompt-document-writes?limit=40",
    init: GET,
  },
];

describe("coordPromptDocuments", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it.each(CASES)(
    "$name sends the literal relative URL and options",
    async ({ call, url, init }) => {
      fetchMock.mockImplementation(async () => answer({ ok: true }));
      await expect(call()).resolves.toBeDefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]).toEqual([url, init]);
    }
  );

  it("resolves the parsed body", async () => {
    const body = { documents: [], total: 0 };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(api.listPromptDocuments()).resolves.toEqual(body);
  });

  it("a write whose 2xx body is empty resolves null rather than rejecting", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.deleteClause(kind, NAME, "c1")).resolves.toBeNull();
  });

  it("rejects a non-2xx in the helpers' error shape, naming the method", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "conflict" }, 409));
    const err = await api
      .publishPromptDocument(kind, NAME, {
        release_note: null,
        expected_version: 1,
      })
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `POST ${DOC}/publish failed: 409 - {"detail":"conflict"}`
    );
    expect(httpStatusOf(err)).toBe(409);
    expect(httpBodyOf(err)).toBe('{"detail":"conflict"}');
  });
});
