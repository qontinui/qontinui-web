/**
 * The page's project-list notice over the REAL tenants client (plan
 * `2026-11-09-prompt-documents-cross-tab-write-guard`, review round 9).
 *
 * `listTenants` writes the message the layout's provider keeps as its
 * `error`, and the page reads coord's refusal back out of it
 * (`isTenantsListUnauthorized`). The guard's own suite mocks `listTenants`
 * with a literal; this one does not. A real `HttpClient` answers from a faked
 * `fetch`, with the web backend's production envelope, so a change to the
 * message on either end fails here instead of passing silently.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

import { TenantProvider } from "@/contexts/tenant-context";
import { PageWriteGuardProvider } from "./PageWriteGuard";
import { WaitingForProject } from "./WaitingForProject";

const TENANTS = "/api/v1/operations/tenants";

/**
 * The web backend's production envelope for an HTTPException's detail, as
 * `error_handler.py` builds it: `time.time()` and `str(request.url)`.
 */
function envelope(status: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: status === 403 ? "FORBIDDEN" : "BAD_REQUEST",
      message,
      timestamp: 1763208000.123456,
      path: `https://api.qontinui.io${TENANTS}`,
    }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}

/**
 * The tenants read answers `answer`; anything else is not this test's. The
 * faked `fetch` is returned, so a test can read what the client sent.
 */
function tenantsAnswer(answer: () => Response) {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(async (url) =>
    String(url).includes(TENANTS)
      ? answer()
      : new Response("{}", { status: 404 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A fresh browser: nothing stored, the layout's provider over the page. */
function renderPage() {
  render(
    <TenantProvider>
      <PageWriteGuardProvider>
        <WaitingForProject testId="section-waiting" />
      </PageWriteGuardProvider>
    </TenantProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the project-list notice over the real tenants client", () => {
  it("coord's refusal to list, as the web backend answers it, names the operator role in the home project as the way out and no Reload", async () => {
    const fetchMock = tenantsAnswer(() => envelope(403, "tenant_not_resolved"));
    renderPage();

    const notice = await screen.findByTestId(
      "prompt-documents-project-list-failed"
    );
    expect(notice).toHaveTextContent(
      "Coord refused to list your projects (tenant_not_resolved)"
    );
    expect(notice).toHaveTextContent(
      "Your account lacks the operator role in its home project, or belongs to no project; ask your project's admin for the role."
    );
    // What that cause rests on: nothing was stored, so the read went out with
    // no project header, and `/me` was scoped to the home project.
    const reads = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(TENANTS)
    );
    expect(reads.length).toBeGreaterThan(0);
    for (const [, init] of reads) {
      expect(init?.headers).not.toHaveProperty("X-Qontinui-Active-Tenant");
    }
    expect(
      screen.queryByTestId("prompt-documents-project-list-failed-reload")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("prompt-documents-project-list-failed-error")
    ).toHaveTextContent(`GET ${TENANTS} failed: 403 (tenant_not_resolved)`);
  });

  it("another refusal, as the web backend answers it, keeps the reload arm", async () => {
    // A 400 is not retried by the client, and is not coord's refusal to list.
    tenantsAnswer(() => envelope(400, "unexpected query"));
    renderPage();

    const notice = await screen.findByTestId(
      "prompt-documents-project-list-failed"
    );
    expect(notice).toHaveTextContent(
      "The list of your projects could not be read"
    );
    expect(
      screen.getByTestId("prompt-documents-project-list-failed-reload")
    ).toBeEnabled();
    expect(
      screen.getByTestId("prompt-documents-project-list-failed-error")
    ).toHaveTextContent(`GET ${TENANTS} failed: 400 (unexpected query)`);
  });
});
