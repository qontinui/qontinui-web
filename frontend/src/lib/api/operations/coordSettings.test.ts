import { afterEach, describe, expect, it, vi } from "vitest";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";

/**
 * Pins each `coordSettings` function's exact request: the RELATIVE URL written
 * out as a LITERAL (so a change to the shared base cannot move every
 * expectation with it), the `encodeURIComponent` of every path/query
 * parameter, and the `httpClient.fetch` options the route walker cannot see —
 * the method and the stated retry policy. Bodies are compared as strings, so
 * the wire key order is pinned too.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const api = await import("./coordSettings");

const O = "/api/v1/operations";
/** An id that only survives the trip as one path segment if encoded. */
const ID = "a/b #1";
const ID_E = "a%2Fb%20%231";
/** A repo that only survives the trip as one query value if encoded. */
const REPO = "acme/web&x=1";
const REPO_E = "acme%2Fweb%26x%3D1";

const GET = { method: "GET", idempotent: true };

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

interface Case {
  name: string;
  call: () => Promise<unknown>;
  url: string;
  init: Record<string, unknown>;
}

const CASES: Case[] = [
  {
    name: "fetchNextStepSettings",
    call: () => api.fetchNextStepSettings(),
    url: `${O}/coord/next-step-settings`,
    init: GET,
  },
  {
    name: "putNextStepSettings",
    call: () =>
      api.putNextStepSettings([
        { decision_domain: "pr_fix", autonomy_level: "auto_decide" },
      ]),
    url: `${O}/coord/next-step-settings`,
    init: {
      method: "PUT",
      body: '{"domains":[{"decision_domain":"pr_fix","autonomy_level":"auto_decide"}]}',
      idempotent: true,
    },
  },
  {
    name: "fetchNextStepSettingsFleet",
    call: () => api.fetchNextStepSettingsFleet(),
    url: `${O}/coord/next-step-settings/fleet`,
    init: GET,
  },
  {
    name: "fetchNextStepSettingsFleet carrying the poll's retry budget",
    call: () => api.fetchNextStepSettingsFleet({ maxRetries: 0 }),
    url: `${O}/coord/next-step-settings/fleet`,
    init: { maxRetries: 0, method: "GET", idempotent: true },
  },
  {
    name: "fetchPrioritySets",
    call: () => api.fetchPrioritySets(),
    url: `${O}/coord/priority-sets`,
    init: GET,
  },
  {
    name: "fetchCompositionRules",
    call: () => api.fetchCompositionRules(),
    url: `${O}/coord/composition-rules`,
    init: GET,
  },
  {
    name: "createPrioritySet",
    call: () =>
      api.createPrioritySet({
        set_name: "s",
        repo: null,
        ordering: ["a"],
        non_factors: [],
      }),
    url: `${O}/coord/priority-sets`,
    init: {
      method: "POST",
      body: '{"set_name":"s","repo":null,"ordering":["a"],"non_factors":[]}',
      idempotent: false,
    },
  },
  {
    name: "updatePrioritySet",
    call: () => api.updatePrioritySet(ID, { enabled: false }),
    url: `${O}/coord/priority-sets/${ID_E}`,
    init: { method: "PATCH", body: '{"enabled":false}', idempotent: false },
  },
  {
    name: "deletePrioritySet",
    call: () => api.deletePrioritySet(ID),
    url: `${O}/coord/priority-sets/${ID_E}`,
    init: { method: "DELETE", idempotent: true },
  },
  {
    name: "fetchTranscriptSync",
    call: () => api.fetchTranscriptSync(),
    url: `${O}/tenant-policy/transcript-sync`,
    init: GET,
  },
  {
    name: "patchTranscriptSync",
    call: () => api.patchTranscriptSync(false),
    url: `${O}/tenant-policy/transcript-sync`,
    init: {
      method: "PATCH",
      body: '{"transcript_sync_enabled":false}',
      idempotent: false,
    },
  },
  {
    name: "fetchResumeUnfinished",
    call: () => api.fetchResumeUnfinished(),
    url: `${O}/tenant-policy/resume-unfinished`,
    init: GET,
  },
  {
    name: "patchResumeUnfinished",
    call: () => api.patchResumeUnfinished(true),
    url: `${O}/tenant-policy/resume-unfinished`,
    init: {
      method: "PATCH",
      body: '{"resume_unfinished_enabled":true}',
      idempotent: false,
    },
  },
  {
    name: "fetchUnfinishedSessions",
    call: () => api.fetchUnfinishedSessions(),
    url: `${O}/unfinished-sessions`,
    init: GET,
  },
  {
    name: "dismissUnfinishedSession",
    call: () => api.dismissUnfinishedSession(ID),
    url: `${O}/unfinished-sessions/${ID_E}/dismiss`,
    init: { method: "POST", body: "{}", idempotent: false },
  },
  {
    name: "resumeUnfinishedSession",
    call: () =>
      api.resumeUnfinishedSession(ID, {
        target_device_id: "d1",
        account: ".claude-x",
      }),
    url: `${O}/unfinished-sessions/${ID_E}/resume`,
    init: {
      method: "POST",
      body: '{"target_device_id":"d1","account":".claude-x"}',
      idempotent: false,
    },
  },
  {
    name: "fetchOperatorAudit with every filter",
    call: () =>
      api.fetchOperatorAudit({
        limit: 100,
        action: "a b",
        via: "mcp",
        resource_key: "k&1",
      }),
    url: `${O}/coord/audit/recent?limit=100&action=a+b&via=mcp&resource_key=k%261`,
    init: GET,
  },
  {
    name: "fetchOperatorAudit with only a limit",
    call: () => api.fetchOperatorAudit({ limit: 100 }),
    url: `${O}/coord/audit/recent?limit=100`,
    init: GET,
  },
  {
    name: "fetchPostMergeFollowupScope",
    call: () => api.fetchPostMergeFollowupScope(REPO),
    url: `${O}/post-merge-followup-scope?repo=${REPO_E}`,
    init: GET,
  },
  {
    name: "putPostMergeFollowupScope",
    call: () =>
      api.putPostMergeFollowupScope({
        repo: "r",
        scope: "code_only",
        code_paths: ["src/**"],
      }),
    url: `${O}/post-merge-followup-scope`,
    init: {
      method: "PUT",
      body: '{"repo":"r","scope":"code_only","code_paths":["src/**"]}',
      idempotent: true,
    },
  },
  {
    name: "fetchContinuationDeliveryMode",
    call: () => api.fetchContinuationDeliveryMode(REPO),
    url: `${O}/continuation-delivery-mode?repo=${REPO_E}`,
    init: GET,
  },
  {
    name: "putContinuationDeliveryMode",
    call: () => api.putContinuationDeliveryMode("r", "notify_only"),
    url: `${O}/continuation-delivery-mode`,
    init: {
      method: "PUT",
      body: '{"repo":"r","mode":"notify_only"}',
      idempotent: true,
    },
  },
];

describe("coordSettings", () => {
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
    const body = { master_enabled: true, can_edit: false, domains: [] };
    fetchMock.mockResolvedValueOnce(answer(body));
    await expect(api.fetchNextStepSettings()).resolves.toEqual(body);
  });

  it("a write whose 2xx body is empty resolves null rather than rejecting", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api.deletePrioritySet(ID)).resolves.toBeNull();
  });

  it("rejects a non-2xx in the helpers' error shape, naming the method", async () => {
    fetchMock.mockResolvedValueOnce(
      answer({ detail: "timeout waiting for coord" }, 504)
    );
    const err = await api.patchTranscriptSync(true).catch((e: unknown) => e);
    expect((err as Error).message).toBe(
      `PATCH ${O}/tenant-policy/transcript-sync failed: 504 - {"detail":"timeout waiting for coord"}`
    );
    expect(httpStatusOf(err)).toBe(504);
    expect(httpBodyOf(err)).toBe('{"detail":"timeout waiting for coord"}');
  });
});
