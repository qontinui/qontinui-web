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
  fetchAutoPublishStatus,
  listPromptDocuments,
  previewPublishAll,
  publishAllPromptDocuments,
  updatePromptDocument,
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
