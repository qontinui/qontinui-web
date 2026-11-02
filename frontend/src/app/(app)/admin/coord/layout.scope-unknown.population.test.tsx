/**
 * The console layout entered with `?present=1` while the presentation scope
 * cannot be read (plan `2026-10-23-console-presentation-spaces` D3.3). Every
 * title is withheld, and the header must say so: otherwise a coord outage
 * looks to the presenter like a project with nothing to show.
 *
 * The REAL `CoordLayout` renders; only the network and the router's search
 * params are faked. Its own file, because the scope store is module-wide and
 * this test needs it to have read nothing yet.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
vi.mock("@/components/admin/coord/CoordNav", () => ({
  default: () => <nav data-testid="coord-nav" />,
}));

const wire = vi.hoisted(() => ({
  FOREIGN: "client-org/portal",
  FIRST_PARTY: "qontinui/qontinui-web",
  respond(url: string): Response {
    if (url.includes("/presentation/scope")) {
      return new Response(
        JSON.stringify({ error: "BAD_GATEWAY", message: "coord is down" }),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }
    if (url.includes("/alerts")) {
      return new Response(
        JSON.stringify(
          [wire.FIRST_PARTY, wire.FOREIGN].map((repo, id) => ({
            id,
            alert_key: `red_main:${repo}`,
            severity: "critical",
            kind: "red_main",
            summary: `Main CI for ${repo} is RED`,
            first_seen_at: "2026-07-06T01:00:00Z",
            detail: {
              repo,
              workflows: ["CI"],
              blocked_pr_count: 1,
              fix_session: "none",
            },
          }))
        ),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response("null", { status: 404 });
  },
}));

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string) => wire.respond(url),
  },
}));

import { findPresentationViolations } from "@/test/presentation";
import CoordLayout from "./layout";

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — presenting on a scope that cannot be read", () => {
  it("says every title is withheld, and names no repository, first-party ones included", async () => {
    window.history.replaceState(null, "", "/admin/coord/spawns?present=1");
    const { container } = render(
      <CoordLayout>
        <p>Console page</p>
      </CoordLayout>
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("presentation-scope-failed-notice")
      ).toHaveTextContent("Titles withheld: scope unknown")
    );
    await waitFor(() =>
      expect(container).toHaveTextContent(
        "A repository's main branch is failing its checks"
      )
    );
    expect(container.innerHTML).not.toContain("client-org");
    expect(container.innerHTML).not.toContain(wire.FIRST_PARTY);
    // The server's own wording stays off the presenting page.
    expect(container.innerHTML).not.toContain("coord is down");
    expect(
      findPresentationViolations(
        {
          baseElement: document.body,
          uiBridge: {
            unobservable:
              "the layout test fakes no UI Bridge provider; the chrome's controls are checked as DOM",
          },
        },
        {
          forbidden: [
            "client-org",
            wire.FIRST_PARTY,
            "coord is down",
            "BAD_GATEWAY",
          ],
        }
      )
    ).toEqual([]);
  });
});
