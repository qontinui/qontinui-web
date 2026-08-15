/**
 * CoordNav — grouped console navigation.
 *
 * Contracts under test (nav redesign):
 *  - five direct tabs; everything else inside persona dropdown groups
 *  - operator gating: the Infra group and operator-only items (Merge
 *    Settings) never render for a plain member
 *  - wayfinding crumb: the group trigger of the active page highlights and
 *    exposes `<testid>-active`
 *  - live Alerts badge from the unresolved-alerts rollup
 *  - live Notifications badge from the server's `unread_count` SCALAR —
 *    never the returned page length (plan
 *    `2026-08-05-coord-notifications-type-and-tab.md`, Change 4)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

let pathname = "/admin/coord/fleet";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

let isSuperuser = false;
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { is_superuser: isSuperuser } }),
}));

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
  },
}));

import CoordNav from "./CoordNav";

describe("CoordNav", () => {
  beforeEach(() => {
    httpGet.mockReset();
    httpGet.mockResolvedValue({ alerts: [] });
    pathname = "/admin/coord/fleet";
    isSuperuser = false;
  });

  it("renders five direct tabs and the member groups (no Infra)", () => {
    render(<CoordNav />);

    expect(screen.getByTestId("coord-nav-fleet")).toHaveTextContent("Pipeline");
    expect(screen.getByTestId("coord-nav-prs")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-gates")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-alerts")).toBeInTheDocument();
    const notifications = screen.getByTestId("coord-nav-notifications");
    expect(notifications).toHaveTextContent("Notifications");
    expect(notifications).toHaveAttribute("href", "/admin/coord/notifications");

    expect(screen.getByTestId("coord-nav-group-work")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-group-merge")).toBeInTheDocument();
    expect(screen.getByTestId("coord-nav-group-access")).toBeInTheDocument();
    // Operator-infra group hidden for members.
    expect(
      screen.queryByTestId("coord-nav-group-infra")
    ).not.toBeInTheDocument();
  });

  it("hides operator-only items inside member-visible groups", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-merge"));
    expect(await screen.findByTestId("coord-nav-policies")).toBeVisible();
    expect(screen.getByTestId("coord-nav-pull-decisions")).toBeVisible();
    expect(
      screen.queryByTestId("coord-nav-merge-settings")
    ).not.toBeInTheDocument();
  });

  it("shows the Infra group with its items for operators", async () => {
    isSuperuser = true;
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-infra"));
    expect(await screen.findByTestId("coord-nav-trees")).toBeVisible();
    expect(screen.getByTestId("coord-nav-git-ops")).toBeVisible();
    expect(screen.getByTestId("coord-nav-onboarding-status")).toBeVisible();
    // Runner releases dashboard lives beside Deploys in the operator-infra group.
    expect(screen.getByTestId("coord-nav-releases")).toBeVisible();
  });

  it("hides the Releases infra tab from a plain member", () => {
    render(<CoordNav />);
    expect(screen.queryByTestId("coord-nav-releases")).not.toBeInTheDocument();
  });

  it("surfaces the active page as a crumb on its group trigger", () => {
    pathname = "/admin/coord/lands";
    render(<CoordNav />);

    const trigger = screen.getByTestId("coord-nav-group-work");
    expect(trigger).toHaveTextContent("Work");
    const crumb = screen.getByTestId("coord-nav-lands-active");
    expect(crumb).toHaveTextContent("Lands");
    expect(trigger).toContainElement(crumb);
    // Sibling groups stay idle — no crumb.
    expect(screen.getByTestId("coord-nav-group-merge")).toHaveTextContent(
      /^Merge$/
    );
  });

  it("cross-links live in the Access group with external hrefs", async () => {
    const user = userEvent.setup();
    render(<CoordNav />);

    await user.click(screen.getByTestId("coord-nav-group-access"));
    const claims = await screen.findByTestId("coord-nav-claims");
    expect(claims).toHaveAttribute("href", "/admin/agent-claims");
    expect(screen.getByTestId("coord-nav-sessions")).toHaveAttribute(
      "href",
      "/admin/agent-sessions"
    );
    expect(screen.getByTestId("coord-nav-members")).toHaveAttribute(
      "href",
      "/admin/coord/members"
    );
  });

  it("renders a live unresolved-alerts badge, red when critical", async () => {
    httpGet.mockResolvedValue({
      alerts: [{ severity: "critical" }, { severity: "warning" }],
    });
    render(<CoordNav />);

    const badge = await screen.findByTestId("coord-nav-alerts-badge");
    expect(badge).toHaveTextContent("2");
    expect(badge.className).toContain("text-red-200");
    expect(httpGet).toHaveBeenCalledWith("/api/v1/operations/alerts");
  });

  it("renders no badge when the rollup is empty or unavailable", async () => {
    httpGet.mockRejectedValue(new Error("boom"));
    render(<CoordNav />);

    await waitFor(() => expect(httpGet).toHaveBeenCalled());
    expect(
      screen.queryByTestId("coord-nav-alerts-badge")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("coord-nav-notifications-badge")
    ).not.toBeInTheDocument();
  });

  describe("Notifications badge", () => {
    /** Route the two nav polls independently. */
    const routeGet = (notifications: unknown) => {
      httpGet.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/v1/operations/notifications")) {
          return notifications instanceof Error
            ? Promise.reject(notifications)
            : Promise.resolve(notifications);
        }
        return Promise.resolve({ alerts: [] });
      });
    };

    it("reads the server's unread_count scalar, not the page length", async () => {
      // The regression this test exists for: the endpoint is PAGED, so the
      // returned row count is the page size. A badge derived from
      // `notifications.length` would read 2 forever; the truth is 137.
      routeGet({
        notifications: [{ notification_id: "a" }, { notification_id: "b" }],
        next_cursor: "opaque",
        total: 900,
        unread_count: 137,
      });
      render(<CoordNav />);

      const badge = await screen.findByTestId("coord-nav-notifications-badge");
      expect(badge).toHaveTextContent("137");
      // Never the returned page length, and never the unfiltered total.
      expect(badge).not.toHaveTextContent(/^2$/);
      expect(badge).not.toHaveTextContent(/^900$/);
      // A count is not a condition — the notifications badge is never red.
      expect(badge.className).not.toContain("text-red-200");
    });

    it("asks for a single row, and opts 503 out of the 5xx retry", async () => {
      routeGet({ notifications: [], total: 0, unread_count: 0 });
      render(<CoordNav />);

      // `?limit=1` keeps a poll that runs on every console page cheap;
      // `noRetryStatuses: [503]` stops the pre-migration window costing five
      // requests a minute per open tab against a route that is 503ing by
      // design (the default policy is measured at 5 requests / ~15s in
      // `http-client.test.ts`). Retrying a days-long answer buys nothing.
      await waitFor(() =>
        expect(httpGet).toHaveBeenCalledWith(
          "/api/v1/operations/notifications?limit=1",
          expect.objectContaining({ noRetryStatuses: [503] })
        )
      );
    });

    it("keeps the LAST KNOWN count when a later poll fails", async () => {
      // A poll failure is evidence about the network, not about the mailbox.
      // Clearing the badge would assert "nothing unread" on no evidence.
      let call = 0;
      httpGet.mockImplementation((url: unknown) => {
        if (String(url).startsWith("/api/v1/operations/notifications")) {
          call += 1;
          return call === 1
            ? Promise.resolve({ notifications: [], unread_count: 7 })
            : Promise.reject(new Error("GET … failed: 503 - pending"));
        }
        return Promise.resolve({ alerts: [] });
      });
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        render(<CoordNav />);
        const badge = await screen.findByTestId(
          "coord-nav-notifications-badge"
        );
        expect(badge).toHaveTextContent("7");

        await vi.advanceTimersByTimeAsync(60_000);
        await waitFor(() => expect(call).toBeGreaterThan(1));
        expect(
          screen.getByTestId("coord-nav-notifications-badge")
        ).toHaveTextContent("7");
      } finally {
        vi.useRealTimers();
      }
    });

    it("renders no badge when nothing is unread", async () => {
      routeGet({
        notifications: [],
        next_cursor: null,
        total: 4,
        unread_count: 0,
      });
      render(<CoordNav />);

      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(
        screen.queryByTestId("coord-nav-notifications-badge")
      ).not.toBeInTheDocument();
      // The Notifications tab itself still renders — only the badge is absent.
      expect(screen.getByTestId("coord-nav-notifications")).toBeInTheDocument();
    });

    it("degrades quietly while the coord migration is pending (503)", async () => {
      // Coord answers `503 schema_migration_pending` until the
      // `coord.notifications` alembic revision deploys; the web PR lands
      // first by design, so this is the EXPECTED steady state for a while.
      routeGet(new Error("503 schema_migration_pending"));
      render(<CoordNav />);

      await waitFor(() => expect(httpGet).toHaveBeenCalled());
      expect(
        screen.queryByTestId("coord-nav-notifications-badge")
      ).not.toBeInTheDocument();
      // The sibling Alerts badge is unaffected by the notifications failure.
      expect(screen.getByTestId("coord-nav-alerts")).toBeInTheDocument();
    });
  });
});
