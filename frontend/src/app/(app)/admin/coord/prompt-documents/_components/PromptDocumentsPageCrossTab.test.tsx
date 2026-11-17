/**
 * The prompt-documents PAGE after another tab switches project: the settings
 * beside the list — kind tiers, the three dials, session compliance — write
 * through the same per-request project as the list's rows, so they are
 * disabled with them while the list's notice stands.
 *
 * Renders the real `PromptDocumentsPage` and the real list (through the real
 * `HttpClient`, `fetch` faked); the five settings sections are stubbed as one
 * button each, which is enough to see whether the page disabled them.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/services/service-factory", async () => {
  const { HttpClient } = await import("@/services/http-client");
  const tokens = {
    getAccessToken: () => "tok",
    getRefreshToken: () => "refresh",
    getAccessTokenExpiry: () => Date.now() + 3_600_000,
    isAccessTokenExpired: () => false,
    isAccessTokenExpiringSoon: () => false,
    isAuthenticated: () => true,
    clearTokens: () => {},
  };
  return {
    httpClient: new HttpClient(
      tokens as unknown as ConstructorParameters<typeof HttpClient>[0]
    ),
  };
});
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock("./KindAuthorshipTierControl", () => ({
  KindAuthorshipTierControl: () => <button data-testid="stub-kind-tiers" />,
}));
vi.mock("./PolicyWriteDialControl", () => ({
  PolicyWriteDialControl: () => <button data-testid="stub-write-dial" />,
}));
vi.mock("./PolicyUpstreamDialControl", () => ({
  PolicyUpstreamDialControl: () => <button data-testid="stub-upstream-dial" />,
}));
vi.mock("./PolicyAutoPublishDialControl", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  PolicyAutoPublishDialControl: () => (
    <button data-testid="stub-auto-publish-dial" />
  ),
}));
vi.mock("./SessionComplianceSection", () => ({
  SessionComplianceSection: () => <button data-testid="stub-compliance" />,
}));

import PromptDocumentsPage from "../page";

const KEY = "qontinui.active_tenant_id";
const B = "t-bravo";
const SYS = "t-system";
const STUBS = [
  "stub-kind-tiers",
  "stub-write-dial",
  "stub-upstream-dial",
  "stub-auto-publish-dial",
  "stub-compliance",
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/auto-publish/status")) {
        return json(403, {
          error: "FORBIDDEN",
          message: JSON.stringify({ error: "not_system_tenant", detail: "x" }),
        });
      }
      if (/\/coord\/prompt-documents(\?|$)/.test(url)) {
        return json(200, {
          documents: [
            {
              id: "d",
              kind: "policy",
              name: "bravo-only",
              description: null,
              format: "markdown",
              default_source: null,
              current_version: 1,
              updated_by: "x",
              updated_at: "2026-11-07T00:00:00Z",
            },
          ],
          degraded: null,
        });
      }
      return json(404, { error: "NOT_FOUND", message: "Not Found" });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

function anotherTabStores(tenant: string) {
  localStorage.setItem(KEY, tenant);
  window.dispatchEvent(
    new StorageEvent("storage", { key: KEY, newValue: tenant })
  );
}

describe("the page's settings after another tab switches project", () => {
  it("are disabled while the notice stands, and enabled again when it clears", async () => {
    localStorage.setItem(KEY, B);
    render(<PromptDocumentsPage />);
    await screen.findByTestId(
      "doc-row-policy-bravo-only",
      {},
      { timeout: 5000 }
    );
    for (const id of STUBS) expect(screen.getByTestId(id)).toBeEnabled();

    await act(async () => anotherTabStores(SYS));

    expect(
      await screen.findByTestId("prompt-documents-cross-tab")
    ).toBeInTheDocument();
    for (const id of STUBS) expect(screen.getByTestId(id)).toBeDisabled();

    await act(async () => anotherTabStores(B));
    await waitFor(() =>
      expect(
        screen.queryByTestId("prompt-documents-cross-tab")
      ).not.toBeInTheDocument()
    );
    for (const id of STUBS) expect(screen.getByTestId(id)).toBeEnabled();
  }, 20_000);
});
