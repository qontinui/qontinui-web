/**
 * The prompt-document client functions that take a `TenantPin` put it on the
 * request exactly as `pinActiveTenant` says:
 *
 * - a project id → the `X-Qontinui-Active-Tenant` header, which the client
 *   keeps on every attempt instead of re-reading the stored project;
 * - `null` → `maxRetries: 0`, because there is no header to pin and a retry
 *   would read whatever another tab stored meanwhile;
 * - no pin → neither, the client's ordinary per-attempt read.
 *
 * Asserted as literals — the header name and the option name are the ones
 * `services/http-client.ts` reads, spelled out here so a rename reddens this.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import {
  adoptUpstreamPublication,
  applyUpstreamMerge,
  createPromptDocument,
  createPromptDocumentClause,
  deletePromptDocumentClause,
  fetchAutoPublishStatus,
  fetchPromptDocument,
  fetchPromptDocumentPublication,
  fetchPromptDocumentVersion,
  keepLocalOverPublication,
  listPromptDocumentClauses,
  listPromptDocumentPublications,
  listPromptDocuments,
  listPromptDocumentVersions,
  previewPublishAll,
  previewUpstreamMerge,
  publishAllPromptDocuments,
  publishPromptDocument,
  reorderPromptDocumentClauses,
  restorePromptDocumentDefault,
  restorePromptDocumentVersion,
  updatePromptDocument,
  updatePromptDocumentAttrs,
  updatePromptDocumentClause,
} from "./coordPromptDocuments";

const ok = () =>
  new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok());
});

const CALLS: Array<
  [string, (pin?: { tenant: string | null }) => Promise<unknown>]
> = [
  ["fetchAutoPublishStatus", (pin) => fetchAutoPublishStatus(pin)],
  ["listPromptDocuments", (pin) => listPromptDocuments(pin)],
  ["previewPublishAll", (pin) => previewPublishAll(pin)],
  [
    "publishAllPromptDocuments",
    (pin) => publishAllPromptDocuments(null, [], pin),
  ],
  [
    "updatePromptDocument",
    (pin) =>
      updatePromptDocument(
        "policy",
        "testing",
        { publish_mode: "manual" },
        pin
      ),
  ],
  [
    "adoptUpstreamPublication",
    (pin) =>
      adoptUpstreamPublication(
        "policy",
        "testing",
        { publication_version: 1, expected_version: 2 },
        pin
      ),
  ],
  // The prompt-documents list's own reads and writes, each pinned to the
  // page's project so another tab's switch cannot retarget a retry or a
  // token-refresh replay of one.
  ["fetchPromptDocument", (pin) => fetchPromptDocument("policy", "t", pin)],
  [
    "listPromptDocumentVersions",
    (pin) => listPromptDocumentVersions("policy", "t", pin),
  ],
  [
    "fetchPromptDocumentVersion",
    (pin) => fetchPromptDocumentVersion("policy", "t", 5, pin),
  ],
  [
    "createPromptDocument",
    (pin) => createPromptDocument("policy", { name: "t", body: "b" }, pin),
  ],
  [
    "updatePromptDocumentAttrs",
    (pin) => updatePromptDocumentAttrs("policy", "t", {}, pin),
  ],
  [
    "restorePromptDocumentDefault",
    (pin) => restorePromptDocumentDefault("policy", "t", pin),
  ],
  [
    "restorePromptDocumentVersion",
    (pin) => restorePromptDocumentVersion("policy", "t", 5, "note", pin),
  ],
  [
    "listPromptDocumentClauses",
    (pin) => listPromptDocumentClauses("policy", "t", pin),
  ],
  [
    "createPromptDocumentClause",
    (pin) =>
      createPromptDocumentClause(
        "policy",
        "t",
        { clause_id: "c" } as never,
        pin
      ),
  ],
  [
    "updatePromptDocumentClause",
    (pin) => updatePromptDocumentClause("policy", "t", "c", {}, pin),
  ],
  [
    "deletePromptDocumentClause",
    (pin) => deletePromptDocumentClause("policy", "t", "c", pin),
  ],
  [
    "reorderPromptDocumentClauses",
    (pin) => reorderPromptDocumentClauses("policy", "t", ["c"], pin),
  ],
  [
    "publishPromptDocument",
    (pin) =>
      publishPromptDocument(
        "policy",
        "t",
        { release_note: null, expected_version: 2 },
        pin
      ),
  ],
  [
    "listPromptDocumentPublications",
    (pin) => listPromptDocumentPublications("policy", "t", pin),
  ],
  [
    "fetchPromptDocumentPublication",
    (pin) => fetchPromptDocumentPublication("policy", "t", 2, pin),
  ],
  [
    "keepLocalOverPublication",
    (pin) =>
      keepLocalOverPublication(
        "policy",
        "t",
        { publication_version: 1, expected_version: 2 },
        pin
      ),
  ],
  [
    "previewUpstreamMerge",
    (pin) => previewUpstreamMerge("policy", "t", 2, pin),
  ],
  [
    "applyUpstreamMerge",
    (pin) =>
      applyUpstreamMerge(
        "policy",
        "t",
        { publication_version: 2, expected_version: 7, resolutions: {} },
        pin
      ),
  ],
];

describe.each(CALLS)("%s", (_, call) => {
  it("pins a project id as the active-tenant header", async () => {
    await call({ tenant: "t-b" });
    const options = fetchMock.mock.calls[0]?.[1] as {
      headers?: Record<string, string>;
      maxRetries?: number;
    };
    expect(options.headers).toEqual({ "X-Qontinui-Active-Tenant": "t-b" });
    expect(options.maxRetries).toBeUndefined();
  });

  it("makes a null pin a single attempt, with no header", async () => {
    await call({ tenant: null });
    const options = fetchMock.mock.calls[0]?.[1] as {
      headers?: Record<string, string>;
      maxRetries?: number;
    };
    expect(options.maxRetries).toBe(0);
    expect(options.headers).toBeUndefined();
  });

  it("leaves an unpinned request to the client's ordinary read", async () => {
    await call();
    const options = fetchMock.mock.calls[0]?.[1] as {
      headers?: Record<string, string>;
      maxRetries?: number;
    };
    expect(options.headers).toBeUndefined();
    expect(options.maxRetries).toBeUndefined();
  });
});
