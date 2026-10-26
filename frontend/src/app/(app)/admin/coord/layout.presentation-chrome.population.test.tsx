/**
 * The console's own chrome in presentation mode, entered the way its
 * population enters it (plan `2026-10-23-console-presentation-spaces`; review
 * round 2 found every CoordLayout test mocking the header row away).
 *
 * The REAL `CoordLayout` renders with the REAL header row (`CoordNav`) and the
 * REAL red-main banner; the network (`httpClient`: the banner's alerts read,
 * the header's two polls and the lens's scope read) and the router are faked.
 *
 * - The header in presentation mode: its two links carry `?present=1` (a link
 *   opened in a new tab still presents), its counts are off screen, the
 *   banner says where it came from, and nothing on the chrome writes or names
 *   a foreign party.
 * - `/admin/coord`, where a signed-in user is sent from `/`, `/login` and
 *   `/dashboard`: in presentation mode the landing page mounts — it is
 *   registered presentation-ready — so its redirect runs, and it carries the
 *   URL's `?present=1` to the console, which the tab keeps presenting.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => router,
}));

const wire = vi.hoisted(() => {
  const FOREIGN = "client-org/portal";
  const DEVICE = "0b9d6a54-0000-4000-8000-0000000000aa";
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  const scope = {
    tenant_id: "00000000-0000-0000-0000-00000000000a",
    first_party_owners: ["qontinui"],
    first_party_owners_source: "registered_repos",
    first_party_owners_unknown_reason: null,
    confidential_terms: [],
    configured: {
      first_party_owners: null,
      confidential_terms: [],
      version: 0,
      updated_at: null,
      updated_by: null,
    },
    defaults: {
      registered_repo_owners: ["qontinui"],
      registered_repo_owners_unknown_reason: null,
      viewer_other_tenant_names: [],
    },
    can_edit: false,
  };
  return {
    FOREIGN,
    DEVICE,
    respond(url: string): Response {
      if (url.includes("/presentation/scope")) return json(scope);
      if (url.includes("/alerts")) {
        return json([
          {
            id: 1,
            alert_key: `red_main:${FOREIGN}`,
            severity: "critical",
            kind: "red_main",
            first_seen_at: "2026-07-06T01:00:00Z",
            detail: {
              repo: FOREIGN,
              workflows: ["deploy"],
              blocked_pr_count: 2,
              fix_session: "none",
            },
          },
        ]);
      }
      // The header's two polls: seven unread, one machine coord reports
      // unhealthy — the counts presentation mode must keep off screen.
      if (url.includes("/notifications")) {
        return json({ notifications: [], unread_count: 7 });
      }
      if (url.includes("fleet/health")) {
        return json({
          devices: [
            { device_id: DEVICE, hostname: "build-box-07", state: "degraded" },
          ],
        });
      }
      if (url.includes("fleet/resource-samples")) {
        return json({ latest: [], history: [] });
      }
      return new Response("null", { status: 404 });
    },
  };
});

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: async (url: string) => wire.respond(url) },
}));

import { defaultPresentationModeStore } from "@/components/presentation";
import { findPresentationViolations } from "@/test/presentation";
import CoordLayout from "./layout";
import CoordLandingPage from "./page";

function visit(path: string, search: string) {
  window.history.replaceState(null, "", `${path}${search}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  router.replace.mockReset();
  // The module-wide tab store outlives a test: start each with no choice.
  defaultPresentationModeStore.recordChoice(false, { remember: false });
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — the console's chrome in presentation mode", () => {
  it("carries the presentation on the header's links, keeps its counts off screen, and shows nothing that writes", async () => {
    visit("/admin/coord/devops", "?present=1");
    render(
      <CoordLayout>
        <p>Console page</p>
      </CoordLayout>
    );

    expect(
      screen.getByTestId("coord-nav-notifications").getAttribute("href")
    ).toBe("/admin/coord/notifications?present=1");
    expect(
      screen.getByTestId("coord-nav-devops-alarm").getAttribute("href")
    ).toBe("/admin/coord/devops?present=1");
    // The banner says where its row came from and when coord confirmed it.
    expect(await screen.findByTestId("red-main-provenance")).toHaveTextContent(
      "source: coord red-main alerts"
    );
    expect(screen.queryByTestId("coord-nav-notifications-badge")).toBeNull();
    expect(screen.queryByTestId("coord-nav-devops-unhealthy-badge")).toBeNull();
    expect(
      findPresentationViolations(
        {
          baseElement: document.body,
          uiBridge: {
            unobservable:
              "the layout test fakes no UI Bridge provider; the chrome's controls are checked as DOM",
          },
        },
        { forbidden: [wire.FOREIGN, "client-org", "build-box-07", "deploy"] }
      )
    ).toEqual([]);
  });

  it("shows the operator the header's counts and plain links", async () => {
    visit("/admin/coord/devops", "");
    render(
      <CoordLayout>
        <p>Console page</p>
      </CoordLayout>
    );
    expect(
      await screen.findByTestId("coord-nav-notifications-badge")
    ).toHaveTextContent("7");
    expect(
      screen.getByTestId("coord-nav-notifications").getAttribute("href")
    ).toBe("/admin/coord/notifications");
    expect(screen.queryByTestId("red-main-provenance")).toBeNull();
  });
});

describe("/admin/coord — where a signed-in presenter lands", () => {
  it("mounts the landing page in presentation mode and lands on the console still presenting", async () => {
    visit("/admin/coord", "?present=1");
    render(
      <CoordLayout>
        <CoordLandingPage />
      </CoordLayout>
    );
    // Not withheld: a page that is never mounted never redirects.
    expect(screen.getByTestId("coord-landing")).toBeTruthy();
    expect(screen.queryByText("Shown in the operator view only")).toBeNull();
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/admin/coord/pipeline?present=1"
      )
    );
    // The tab recorded the URL's choice, so the console it lands on presents.
    await waitFor(() =>
      expect(defaultPresentationModeStore.getSnapshot().startsWith("1")).toBe(
        true
      )
    );
  });

  it("lands the operator on the console with no query added", async () => {
    visit("/admin/coord", "");
    render(
      <CoordLayout>
        <CoordLandingPage />
      </CoordLayout>
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/admin/coord/pipeline")
    );
  });
});
