import { afterEach, describe, expect, it, vi } from "vitest";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordPromptDocuments` function's exact request: the RELATIVE URL
 * written out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the `encodeURIComponent` of every path and query
 * parameter, the method, the stated retry policy, and the exact JSON body.
 * `toEqual` on the whole options object keeps them that way unless a change
 * says so. Below the table: parsing, the `<METHOD> <url> failed: <status> -
 * <body>` rejection the callers' refusal classifiers read, and the
 * unparseable-2xx rule for writes whose body nobody reads.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const api = await import("./coordPromptDocuments");

/** A path segment that only survives the trip as ONE segment if encoded. */
const AWKWARD = "a/b c?d";
const AWKWARD_ENC = "a%2Fb%20c%3Fd";
const BASE = "/api/v1/operations/coord";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const GET = { method: "GET", idempotent: true };

interface Case {
  name: string;
  call: () => Promise<unknown>;
  url: string;
  init: Record<string, unknown>;
}

const CASES: Case[] = [
  // documents
  {
    name: "listPromptDocuments",
    call: () => api.listPromptDocuments(),
    url: `${BASE}/prompt-documents`,
    init: GET,
  },
  {
    name: "fetchPromptDocument",
    call: () => api.fetchPromptDocument("policy", AWKWARD),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}`,
    init: GET,
  },
  {
    name: "listPromptDocumentVersions",
    call: () => api.listPromptDocumentVersions("policy", AWKWARD),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/versions`,
    init: GET,
  },
  {
    name: "fetchPromptDocumentVersion",
    call: () => api.fetchPromptDocumentVersion("policy", AWKWARD, 3),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/versions/3`,
    init: GET,
  },
  {
    name: "createPromptDocument",
    call: () =>
      api.createPromptDocument("decision_record", { name: "x", body: "b" }),
    url: `${BASE}/prompt-documents/decision_record`,
    init: {
      method: "POST",
      body: '{"name":"x","body":"b"}',
      idempotent: false,
    },
  },
  {
    name: "updatePromptDocument",
    call: () => api.updatePromptDocument("policy", AWKWARD, { body: "new" }),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}`,
    init: { method: "PATCH", body: '{"body":"new"}', idempotent: false },
  },
  {
    name: "updatePromptDocumentAttrs",
    call: () =>
      api.updatePromptDocumentAttrs("policy", AWKWARD, {
        default_tier: "ask-first",
      }),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}`,
    init: {
      method: "PATCH",
      body: '{"attrs":{"default_tier":"ask-first"}}',
      idempotent: true,
    },
  },
  {
    name: "restorePromptDocumentDefault",
    call: () => api.restorePromptDocumentDefault("policy", AWKWARD),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/restore-default`,
    init: { method: "POST", body: "{}", idempotent: false },
  },
  {
    name: "restorePromptDocumentVersion (with a note)",
    call: () => api.restorePromptDocumentVersion("policy", AWKWARD, 2, "why"),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/versions/2/restore`,
    init: { method: "POST", body: '{"change_note":"why"}', idempotent: false },
  },
  {
    name: "restorePromptDocumentVersion (without a note)",
    call: () => api.restorePromptDocumentVersion("policy", AWKWARD, 2),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/versions/2/restore`,
    init: { method: "POST", body: "{}", idempotent: false },
  },
  {
    name: "withdrawPromptDocument",
    call: () => api.withdrawPromptDocument("decision_record", AWKWARD, "dup"),
    url: `${BASE}/prompt-documents/decision_record/${AWKWARD_ENC}/withdraw`,
    init: { method: "POST", body: '{"reason":"dup"}', idempotent: false },
  },
  // clauses
  {
    name: "listPromptDocumentClauses",
    call: () => api.listPromptDocumentClauses("policy", AWKWARD),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/clauses`,
    init: GET,
  },
  {
    name: "createPromptDocumentClause",
    call: () =>
      api.createPromptDocumentClause("policy", AWKWARD, {
        clause_id: "c1",
      } as never),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/clauses`,
    init: { method: "POST", body: '{"clause_id":"c1"}', idempotent: false },
  },
  {
    name: "updatePromptDocumentClause",
    call: () =>
      api.updatePromptDocumentClause("policy", AWKWARD, AWKWARD, {
        trigger: "t",
      }),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/clauses/${AWKWARD_ENC}`,
    init: { method: "PATCH", body: '{"trigger":"t"}', idempotent: false },
  },
  {
    name: "deletePromptDocumentClause",
    call: () => api.deletePromptDocumentClause("policy", AWKWARD, AWKWARD),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/clauses/${AWKWARD_ENC}`,
    init: { method: "DELETE", idempotent: true },
  },
  {
    name: "reorderPromptDocumentClauses",
    call: () => api.reorderPromptDocumentClauses("policy", AWKWARD, ["b", "a"]),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/clauses/reorder`,
    init: {
      method: "POST",
      body: '{"clause_ids":["b","a"]}',
      idempotent: false,
    },
  },
  // publication
  {
    name: "publishPromptDocument",
    call: () =>
      api.publishPromptDocument("policy", AWKWARD, {
        release_note: null,
        expected_version: 7,
      }),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/publish`,
    init: {
      method: "POST",
      body: '{"release_note":null,"expected_version":7}',
      idempotent: false,
    },
  },
  {
    name: "listPromptDocumentPublications",
    call: () => api.listPromptDocumentPublications("policy", AWKWARD),
    url: `${BASE}/prompt-document-publications?kind=policy&name=${AWKWARD_ENC}`,
    init: GET,
  },
  {
    name: "fetchPromptDocumentPublication",
    call: () => api.fetchPromptDocumentPublication("policy", AWKWARD, 4),
    url: `${BASE}/prompt-document-publications/policy/${AWKWARD_ENC}/4`,
    init: GET,
  },
  {
    name: "adoptUpstreamPublication",
    call: () =>
      api.adoptUpstreamPublication("policy", AWKWARD, {
        publication_version: 4,
        expected_version: 9,
      }),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/upstream-adopt`,
    init: {
      method: "POST",
      body: '{"publication_version":4,"expected_version":9}',
      idempotent: false,
    },
  },
  {
    name: "keepLocalOverPublication",
    call: () =>
      api.keepLocalOverPublication("policy", AWKWARD, {
        publication_version: 4,
        expected_version: 9,
      }),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/upstream-keep`,
    init: {
      method: "POST",
      body: '{"publication_version":4,"expected_version":9}',
      idempotent: false,
    },
  },
  {
    name: "previewUpstreamMerge",
    call: () => api.previewUpstreamMerge("policy", AWKWARD, 4),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/upstream-merge?publication_version=4`,
    init: GET,
  },
  {
    name: "applyUpstreamMerge",
    call: () =>
      api.applyUpstreamMerge("policy", AWKWARD, {
        publication_version: 4,
        expected_version: 9,
        resolutions: { c1: "local" },
      }),
    url: `${BASE}/prompt-documents/policy/${AWKWARD_ENC}/upstream-merge`,
    init: {
      method: "POST",
      body: '{"publication_version":4,"expected_version":9,"resolutions":{"c1":"local"}}',
      idempotent: false,
    },
  },
  {
    name: "previewPublishAll",
    call: () => api.previewPublishAll(),
    url: `${BASE}/prompt-documents/publish-all`,
    init: { method: "POST", body: '{"dry_run":true}', idempotent: false },
  },
  {
    name: "publishAllPromptDocuments",
    call: () =>
      api.publishAllPromptDocuments("note", [
        { kind: "policy", name: "p", expected_version: 2 },
      ]),
    url: `${BASE}/prompt-documents/publish-all`,
    init: {
      method: "POST",
      body: '{"dry_run":false,"release_note":"note","items":[{"kind":"policy","name":"p","expected_version":2}]}',
      idempotent: false,
    },
  },
  {
    name: "fetchAutoPublishStatus",
    call: () => api.fetchAutoPublishStatus(),
    url: `${BASE}/prompt-documents/auto-publish/status`,
    init: GET,
  },
  // kind tiers
  {
    name: "fetchKindTiers",
    call: () => api.fetchKindTiers(),
    url: `${BASE}/prompt-document-kind-tiers`,
    init: GET,
  },
  {
    name: "setKindTier",
    call: () => api.setKindTier(AWKWARD, "allow"),
    url: `${BASE}/prompt-document-kind-tiers/${AWKWARD_ENC}`,
    init: { method: "PUT", body: '{"tier":"allow"}', idempotent: true },
  },
  {
    name: "clearKindTier",
    call: () => api.clearKindTier(AWKWARD),
    url: `${BASE}/prompt-document-kind-tiers/${AWKWARD_ENC}`,
    init: { method: "DELETE", idempotent: true },
  },
  // session compliance
  {
    name: "fetchSessionComplianceConfig",
    call: () => api.fetchSessionComplianceConfig(),
    url: `${BASE}/session-compliance/config`,
    init: GET,
  },
  {
    name: "listSessionComplianceConfigVersions",
    call: () => api.listSessionComplianceConfigVersions(),
    url: `${BASE}/session-compliance/config/versions`,
    init: GET,
  },
  {
    name: "saveSessionComplianceConfig",
    call: () => api.saveSessionComplianceConfig({ mode: "nudge" }),
    url: `${BASE}/session-compliance/config`,
    init: { method: "PUT", body: '{"mode":"nudge"}', idempotent: true },
  },
  {
    name: "listSessionComplianceSessions (first page, every verdict)",
    call: () => api.listSessionComplianceSessions({ limit: 25, cursor: null }),
    url: `${BASE}/session-compliance/sessions?limit=25`,
    init: GET,
  },
  {
    name: "listSessionComplianceSessions (filtered, paged)",
    call: () =>
      api.listSessionComplianceSessions({
        limit: 25,
        verdict: "unverified",
        cursor: "c&1",
      }),
    url: `${BASE}/session-compliance/sessions?limit=25&verdict=unverified&cursor=c%261`,
    init: GET,
  },
  {
    name: "listSessionComplianceOutstanding",
    call: () => api.listSessionComplianceOutstanding(),
    url: `${BASE}/session-compliance/outstanding`,
    init: GET,
  },
  // proposals and writes
  {
    name: "listPendingPromptDocumentProposals",
    call: () => api.listPendingPromptDocumentProposals(),
    url: `${BASE}/prompt-document-proposals?status=pending`,
    init: GET,
  },
  {
    name: "listPromptDocumentProposals",
    call: () => api.listPromptDocumentProposals("a b", 20),
    url: `${BASE}/prompt-document-proposals?status=a%20b&limit=20`,
    init: GET,
  },
  {
    name: "decidePromptDocumentProposal (with a note)",
    call: () => api.decidePromptDocumentProposal(AWKWARD, "approve", "ok"),
    url: `${BASE}/prompt-document-proposals/${AWKWARD_ENC}/approve`,
    init: { method: "POST", body: '{"decision_note":"ok"}', idempotent: false },
  },
  {
    name: "decidePromptDocumentProposal (without a note)",
    call: () => api.decidePromptDocumentProposal(AWKWARD, "reject", ""),
    url: `${BASE}/prompt-document-proposals/${AWKWARD_ENC}/reject`,
    init: { method: "POST", body: "{}", idempotent: false },
  },
  {
    name: "listPromptDocumentWrites",
    call: () => api.listPromptDocumentWrites(40),
    url: `${BASE}/prompt-document-writes?limit=40`,
    init: GET,
  },
];

describe("coordPromptDocuments — the request each function sends", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it.each(CASES)("$name", async ({ call, url, init }) => {
    fetchMock.mockResolvedValueOnce(answer({ ok: true }));
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toEqual([url, init]);
  });

  it("covers every exported function", () => {
    const exported = Object.entries(api)
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k)
      .sort();
    const covered = [
      ...new Set(CASES.map((c) => c.name.split(" ")[0])),
    ].sort();
    expect(covered).toEqual(exported);
  });
});

describe("coordPromptDocuments — responses", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("listPromptDocuments resolves the parsed body", async () => {
    const body = { documents: [], total: 0, degraded: "store missing" };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(api.listPromptDocuments()).resolves.toEqual(body);
  });

  it("a read rejects a non-2xx in httpClient.get's error shape", async () => {
    fetchMock.mockResolvedValueOnce(answer({ detail: "gone" }, 404));
    const err = await api
      .fetchSessionComplianceConfig()
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'GET /api/v1/operations/coord/session-compliance/config failed: 404 - {"detail":"gone"}'
    );
    expect(httpStatusOf(err)).toBe(404);
  });

  it("publishPromptDocument rejects in httpClient.post's shape, coord's code intact for classifyPublishError", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ error: "not_system_tenant" }, 403)
    );
    const err = await api
      .publishPromptDocument("policy", "p", {
        release_note: null,
        expected_version: 1,
      })
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      'POST /api/v1/operations/coord/prompt-documents/policy/p/publish failed: 403 - {"error":"not_system_tenant"}'
    );
  });

  it("updatePromptDocument rejects in httpClient.patch's shape", async () => {
    fetchMock.mockResolvedValueOnce(new Response("42703", { status: 500 }));
    const err = await api
      .updatePromptDocument("policy", "p", { publish_mode: "never" })
      .catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      "PATCH /api/v1/operations/coord/prompt-documents/policy/p failed: 500 - 42703"
    );
  });

  it("setKindTier and clearKindTier reject in httpClient.put / delete's shapes", async () => {
    fetchMock.mockResolvedValueOnce(answer("floor", 409));
    const put = await api.setKindTier("policy", "deny").catch((e) => e);
    expect((put as Error).message).toBe(
      'PUT /api/v1/operations/coord/prompt-document-kind-tiers/policy failed: 409 - "floor"'
    );
    fetchMock.mockResolvedValueOnce(answer("no", 403));
    const del = await api.clearKindTier("policy").catch((e) => e);
    expect((del as Error).message).toBe(
      'DELETE /api/v1/operations/coord/prompt-document-kind-tiers/policy failed: 403 - "no"'
    );
  });

  it("a write whose body no caller reads resolves null on an empty 2xx", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.clearKindTier("policy")).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(
      api.withdrawPromptDocument("decision_record", "d", "why")
    ).resolves.toBeNull();
  });

  it("a write whose body a caller reads keeps the strict parse", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(
      api.updatePromptDocument("policy", "p", { body: "x" })
    ).rejects.toThrow();
  });
});
