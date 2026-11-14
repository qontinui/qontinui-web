/**
 * Every request whose answer or effect is attributed to a project is SENT
 * pinned to that project — checked at each call site.
 *
 * `coordPromptDocuments.pin.test.ts` pins how a `TenantPin` becomes request
 * options, and `AdoptAllRetries.test.tsx` drives three of these through the
 * real client's retries. This file closes the rest: that each caller hands its
 * client function the pin at all, and the RIGHT one — the project stored when
 * the request was made, or the run's project for the run's requests:
 *
 * - the status read (its refusal is stamped and latched);
 * - the publish-all dry run and armed run, and the publish-mode PATCH (each
 *   can latch the same refusal);
 * - the re-ask and the list re-read at open (the page's mount read alone is
 *   not pinned: it goes out before the page's project is known, in the
 *   stored project);
 * - every adopt POST, and the post-run list re-read;
 * - the status read RE-TAKEN, and the rows re-read, once the provider
 *   reconciles the page's project (pinned to that project, even when another
 *   project is stored by then).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();

vi.mock("@/services/service-factory", async () => {
  const { withVerbFetch } = await import("@/test/verbFetch");
  return {
    httpClient: withVerbFetch({
      get: (...args: unknown[]) => getMock(...args),
      post: (...args: unknown[]) => postMock(...args),
      patch: (...args: unknown[]) => patchMock(...args),
      put: vi.fn(),
      delete: vi.fn(),
    }),
  };
});
vi.mock("@/lib/api/operations/coordPromptDocuments", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/lib/api/operations/coordPromptDocuments")
    >();
  return {
    ...real,
    fetchAutoPublishStatus: vi.fn(real.fetchAutoPublishStatus),
    listPromptDocuments: vi.fn(real.listPromptDocuments),
    previewPublishAll: vi.fn(real.previewPublishAll),
    publishAllPromptDocuments: vi.fn(real.publishAllPromptDocuments),
    updatePromptDocument: vi.fn(real.updatePromptDocument),
    adoptUpstreamPublication: vi.fn(real.adoptUpstreamPublication),
  };
});
const listTenantsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/operations/tenants", () => ({
  listTenants: (...args: unknown[]) => listTenantsMock(...args),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

import * as client from "@/lib/api/operations/coordPromptDocuments";
import { PromptDocumentList } from "./PromptDocumentList";
import { TenantProvider } from "@/contexts/tenant-context";
import type { PromptDocumentSummary } from "../types";

const LIST = "/api/v1/operations/coord/prompt-documents";
const STATUS = `${LIST}/auto-publish/status`;
const KEY = "qontinui.active_tenant_id";
const NOT_SYSTEM_TENANT = new Error(
  `GET ${STATUS} failed: 403 - ${JSON.stringify({
    error: "FORBIDDEN",
    message: JSON.stringify({ error: "not_system_tenant", detail: "x" }),
  })}`
);

function doc(
  extra: Partial<PromptDocumentSummary> = {}
): PromptDocumentSummary {
  return {
    id: "a",
    kind: "policy",
    name: "a",
    description: null,
    format: "markdown",
    default_source: null,
    current_version: 2,
    updated_by: "x",
    updated_at: "2026-11-07T00:00:00Z",
    upstream_publication_version: null,
    latest_publication_version: 1,
    local_modified: true,
    update_available: true,
    publish_mode: "auto",
    ...extra,
  };
}

const argAt = (fn: unknown, index: number) => {
  const calls = (fn as ReturnType<typeof vi.fn>).mock.calls;
  return calls.map((c) => c[index]);
};

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  patchMock.mockReset();
  vi.mocked(client.fetchAutoPublishStatus).mockClear();
  vi.mocked(client.listPromptDocuments).mockClear();
  vi.mocked(client.previewPublishAll).mockClear();
  vi.mocked(client.publishAllPromptDocuments).mockClear();
  vi.mocked(client.updatePromptDocument).mockClear();
  vi.mocked(client.adoptUpstreamPublication).mockClear();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe("the pin each request is sent with", () => {
  it("pins the status read, the re-ask and re-read at open, every adopt and the post-run re-read", async () => {
    localStorage.setItem(KEY, "t-b");
    getMock.mockImplementation((url: string) => {
      if (url === STATUS) return Promise.reject(NOT_SYSTEM_TENANT);
      if (url === LIST) {
        return Promise.resolve({ documents: [doc()], degraded: null });
      }
      return Promise.reject(new Error(url));
    });
    postMock.mockResolvedValue({
      adopted: true,
      kind: "policy",
      name: "a",
      from_version: 2,
      to_version: 3,
      publication_version: 1,
      local_modified: true,
    });
    render(<PromptDocumentList />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId("adopt-all"));
    await screen.findByTestId("adopt-all-candidates");
    await user.click(screen.getByTestId("adopt-all-confirm"));
    await screen.findByTestId("adopt-all-summary");
    await waitFor(() =>
      expect(argAt(client.listPromptDocuments, 0)).toHaveLength(3)
    );

    // The page's status read and the re-ask at open: both pinned to B.
    expect(argAt(client.fetchAutoPublishStatus, 0)).toEqual(
      expect.arrayContaining([{ tenant: "t-b" }])
    );
    expect(
      argAt(client.fetchAutoPublishStatus, 0).every(
        (p) => JSON.stringify(p) === JSON.stringify({ tenant: "t-b" })
      )
    ).toBe(true);
    // The page's own mount read is not pinned (it goes in the stored
    // project); the re-read at open and the post-run re-read are pinned to B.
    expect(argAt(client.listPromptDocuments, 0)).toEqual([
      undefined,
      { tenant: "t-b" },
      { tenant: "t-b" },
    ]);
    // The adopt POST: pinned to the run's project.
    expect(argAt(client.adoptUpstreamPublication, 3)).toEqual([
      { tenant: "t-b" },
    ]);
  });

  it("pins the publish-all dry run, the armed run and the publish-mode PATCH", async () => {
    localStorage.setItem(KEY, "t-sys");
    getMock.mockImplementation((url: string) => {
      if (url === STATUS) return Promise.resolve({ candidates: [], count: 1 });
      if (url === LIST) {
        return Promise.resolve({ documents: [doc()], degraded: null });
      }
      return Promise.reject(new Error(url));
    });
    postMock.mockImplementation((_url: string, body: { dry_run?: boolean }) =>
      Promise.resolve(
        body?.dry_run === false
          ? { dry_run: false, results: [], fan_out: "spawned" }
          : {
              dry_run: true,
              candidates: [
                {
                  kind: "policy",
                  name: "a",
                  current_version: 2,
                  next_publication_version: 2,
                },
              ],
            }
      )
    );
    patchMock.mockResolvedValue({ ...doc(), current_version: 3 });
    render(<PromptDocumentList />);
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("publish-all"));
    const confirm = await screen.findByTestId("publish-all-confirm");
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(() =>
      expect(client.publishAllPromptDocuments).toHaveBeenCalled()
    );
    expect(argAt(client.previewPublishAll, 0)).toEqual([{ tenant: "t-sys" }]);
    expect(argAt(client.publishAllPromptDocuments, 2)).toEqual([
      { tenant: "t-sys" },
    ]);
    await user.keyboard("{Escape}");

    await user.click(await screen.findByTestId("doc-publish-mode-policy-a"));
    await user.click(
      await screen.findByTestId("doc-publish-mode-manual-policy-a")
    );
    await waitFor(() => expect(client.updatePromptDocument).toHaveBeenCalled());
    expect(argAt(client.updatePromptDocument, 3)).toEqual([
      { tenant: "t-sys" },
    ]);
  });

  it("re-takes the status read pinned to the reconciled project, even when another is stored by then", async () => {
    // Fresh browser: nothing stored; the provider reconciles to home, H. A
    // moment after it stores H, another tab stores X — so a re-take sent in
    // the STORED project would go to X.
    let releaseTenants: (() => void) | undefined;
    listTenantsMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseTenants = () =>
            resolve({
              tenants: [{ id: "t-home", slug: "home", name: "Home" }],
              active_tenant_id: "t-home",
            });
        })
    );
    const realSetItem = Storage.prototype.setItem;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        realSetItem.call(this, key, value);
        if (key === KEY && value === "t-home")
          realSetItem.call(this, KEY, "t-x");
      });
    getMock.mockImplementation((url: string) => {
      if (url === STATUS) return Promise.reject(NOT_SYSTEM_TENANT);
      if (url === LIST) {
        return Promise.resolve({ documents: [doc()], degraded: null });
      }
      return Promise.reject(new Error(url));
    });
    try {
      render(
        <TenantProvider>
          <PromptDocumentList />
        </TenantProvider>
      );
      await screen.findByTestId("doc-row-policy-a");
      await waitFor(() =>
        expect(client.fetchAutoPublishStatus).toHaveBeenCalledTimes(1)
      );
      expect(argAt(client.fetchAutoPublishStatus, 0)).toEqual([
        { tenant: null },
      ]);
      await act(async () => {
        releaseTenants?.();
      });
      await waitFor(() =>
        expect(client.fetchAutoPublishStatus).toHaveBeenCalledTimes(2)
      );
      expect(localStorage.getItem(KEY)).toBe("t-x");
      expect(argAt(client.fetchAutoPublishStatus, 0)[1]).toEqual({
        tenant: "t-home",
      });
      // The rows are re-read too, pinned the same way: the mount read went
      // out with no project.
      await waitFor(() =>
        expect(client.listPromptDocuments).toHaveBeenCalledTimes(2)
      );
      expect(argAt(client.listPromptDocuments, 0)).toEqual([
        undefined,
        { tenant: "t-home" },
      ]);
    } finally {
      setItem.mockRestore();
    }
  });
});
