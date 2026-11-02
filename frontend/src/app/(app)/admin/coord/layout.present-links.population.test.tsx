/**
 * The console header's links keep a presentation, entered the way their
 * population enters them (plan `2026-10-23-console-presentation-spaces` D2:
 * a link opened in a new tab starts with no tab choice of its own, so unless
 * its URL says otherwise it shows the operator view).
 *
 * The REAL `CoordLayout` renders the REAL header row (`CoordNav`) and the REAL
 * red-main banner on a console URL; what is faked is the router and the
 * network (`httpClient`: the banner's alerts read, the header's two polls and
 * the lens's scope read). The links are read as a browser opening one in a
 * new tab would read them: by their `href`.
 *
 * The file imports nothing the phase added, so without the phase it fails on
 * its assertions (the header's links carry no `?present=1`), not on an
 * import. The rest of the chrome in presentation mode is checked whole in
 * `layout.presentation-chrome.population.test.tsx`.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
  useRouter: () => router,
}));

const wire = vi.hoisted(() => {
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
    respond(url: string): Response {
      if (url.includes("/presentation/scope")) return json(scope);
      if (url.includes("/alerts")) return json([]);
      if (url.includes("/notifications")) {
        return json({ notifications: [], unread_count: 2 });
      }
      if (url.includes("fleet/health")) return json({ devices: [] });
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

import CoordLayout from "./layout";

function visit(path: string, search: string) {
  window.history.replaceState(null, "", `${path}${search}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — the header's links on a console URL", () => {
  it("carries ?present=1 on the header's links while presenting, so one opened in a new tab still presents", () => {
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
  });

  it("leaves the operator's links as they are", () => {
    // `?present=0` rather than no query: the tab's own choice is module-wide
    // and outlives a test, and the URL is what wins over it.
    visit("/admin/coord/devops", "?present=0");
    render(
      <CoordLayout>
        <p>Console page</p>
      </CoordLayout>
    );
    expect(
      screen.getByTestId("coord-nav-notifications").getAttribute("href")
    ).toBe("/admin/coord/notifications");
    expect(
      screen.getByTestId("coord-nav-devops-alarm").getAttribute("href")
    ).toBe("/admin/coord/devops");
  });
});
