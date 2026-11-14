/**
 * `/sessions` — the "Saved tab lists" panel, entered the way the operator
 * enters it: by loading the page.
 *
 * This is the Arming proof of plan
 * `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3: the REAL `SessionsPage` (`page.tsx`) is rendered, and Save is
 * driven through the typed client (`lib/api/savedSessionLists.ts`) with only
 * the network faked. Nothing the page renders is replaced — the mocks are the
 * data sources alone: `httpClient.fetch` (answered by
 * `src/test/savedSessionListsFixture.ts`), the device-status stream hook, the
 * auth and tenant contexts and the router.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DEVICE_A,
  createFakeNetwork,
  type FakeNetwork,
} from "@/test/savedSessionListsFixture";

const holder = vi.hoisted(() => ({
  fetch: null as
    | null
    | ((url: string, init?: RequestInit) => Promise<Response>),
}));
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (url: string, init?: RequestInit) => {
      if (holder.fetch === null) throw new Error("no fake network installed");
      return holder.fetch(url, init);
    },
  },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/sessions",
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false }),
}));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [],
    activeTenantId: null,
    isMultiTenant: false,
    setActiveTenantId: vi.fn(),
    loading: false,
    error: null,
  }),
}));

// The page's live device-status stream — the source of `hostnameFor`.
vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({
    byHostname: new Map([
      [
        "merytshost",
        {
          device_id: "aaaaaaaa-1111-4111-8111-111111111111",
          hostname: "merytshost",
        },
      ],
    ]),
    connected: false,
    error: null,
    seeded: true,
    everSeeded: true,
    refetch: vi.fn(),
  }),
}));

import SessionsPage from "./page";

let net: FakeNetwork;

beforeEach(() => {
  net = createFakeNetwork();
  // The sessions console below the panel reads its consolidated list too.
  net.other = (method, path) =>
    method === "GET" && path === "/api/v1/operations/sessions"
      ? {
          status: 200,
          body: {
            count: 0,
            scope: "all",
            shape: "consolidated",
            sessions: [],
            row_class_counts: {
              linked: 0,
              lifecycle_only: 0,
              agent_only: 0,
              unknown: 0,
            },
            agent_half: { read: "ok" },
          },
        }
      : { status: 404, body: { detail: `no route for ${method} ${path}` } };
  holder.fetch = net.fetch;
  window.localStorage.clear();
});

describe("SessionsPage › Saved tab lists", () => {
  it("saves a relay-connected runner's tab list through the typed client and opens it grouped by tab in runner order", async () => {
    const user = userEvent.setup();
    render(<SessionsPage />);

    // The page's own hook is unchanged, and the panel sits above the console.
    const page = document.querySelector('[data-ui-bridge-id="sessions.page"]');
    expect(page).not.toBeNull();
    const panel = await screen.findByTestId("saved-tab-lists-panel");
    expect(panel).toHaveAttribute(
      "data-ui-bridge-id",
      "sessions.saved-tab-lists"
    );
    const consoleHealth = await screen.findByTestId("sessions-console-health");
    expect(
      panel.compareDocumentPosition(consoleHealth) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Collapsed by default; its header counts the caller's lists.
    const countBadge = within(panel).getByTestId("saved-tab-lists-count");
    await waitFor(() => expect(countBadge).toHaveTextContent("0"));
    expect(within(panel).queryByTestId("saved-tab-lists-save-form")).toBeNull();

    await user.click(
      within(panel).getByRole("button", { name: /^saved tab lists/i })
    );
    const picker = await within(panel).findByTestId(
      "saved-tab-lists-runner-picker"
    );
    // The one relay-connected runner, named by the page's device-status stream.
    expect(
      await within(picker).findByRole("radio", { name: /merytshost/ })
    ).toBeChecked();
    await user.type(
      within(panel).getByTestId("saved-tab-lists-title"),
      "Before rebuild"
    );
    await user.click(within(panel).getByTestId("saved-tab-lists-save"));

    // The request went through the typed client to the capture route.
    await waitFor(() =>
      expect(net.calls.filter((c) => c.method === "POST")).toEqual([
        {
          method: "POST",
          path: "/api/v1/saved-session-lists",
          body: { device_id: DEVICE_A, title: "Before rebuild" },
        },
      ])
    );

    // The new list opens, grouped by tab in the runner's order, each terminal
    // with its account, name and finished badge.
    const opened = await within(panel).findByTestId("saved-tab-list-detail");
    const tabs = within(opened).getAllByTestId("saved-tab-list-tab");
    expect(
      tabs.map(
        (t) =>
          within(t).getByTestId("saved-tab-list-tab-heading").firstChild
            ?.textContent
      )
    ).toEqual([
      "Build",
      "Review (1b1b1b1b)",
      "Review (2c2c2c2c)",
      "Tab 3d3d3d3d (name not reported)",
    ]);
    const first = opened.querySelector<HTMLElement>(
      '[data-terminal-id="term-build-1"]'
    );
    if (first === null) throw new Error("the first terminal is not shown");
    expect(
      within(first).getByTestId("saved-tab-list-session-name")
    ).toHaveTextContent("brave-otter");
    expect(
      within(first).getByTestId("saved-tab-list-session-account")
    ).toHaveTextContent("work");
    expect(first.querySelector("[data-status-kind]")).toHaveTextContent(
      "✓ finished"
    );

    // The list is now one of the caller's, with its deletion countdown.
    await waitFor(() => expect(countBadge).toHaveTextContent("1"));
    const [row] = within(panel).getAllByTestId("saved-tab-lists-row");
    if (!row) throw new Error("no row");
    expect(
      within(row).getByTestId("saved-tab-lists-countdown")
    ).toHaveTextContent(/^deletes in 14 days$/);
  });
});
