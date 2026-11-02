/**
 * The console layout's header toggle, entered the way its population enters
 * it (plan `2026-10-23-console-presentation-spaces` Phase 1 Arming: "the
 * console header toggle and `?present=1` URLs").
 *
 * The REAL `CoordLayout` and the REAL red-main banner; only the network and
 * the router's search params are faked. Its own file because the lens's mode
 * store is tab-wide: a sibling test that presented first would leave this one
 * starting in the lens. Imports nothing the phase added.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
vi.mock("@/components/admin/coord/CoordNav", () => ({
  default: () => <nav data-testid="coord-nav" />,
}));

const wire = vi.hoisted(() => {
  const FIRST_PARTY = "qontinui/qontinui-web";
  const FOREIGN = "client-org/portal";
  const alertRow = (repo: string, workflows: string[]) => ({
    id: repo.length,
    alert_key: `red_main:${repo}`,
    severity: "critical",
    kind: "red_main",
    summary: `Main CI for ${repo} is RED`,
    first_seen_at: "2026-07-06T01:00:00Z",
    detail: { repo, workflows, blocked_pr_count: 1, fix_session: "none" },
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
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return {
    FIRST_PARTY,
    FOREIGN,
    respond(url: string): Response {
      if (url.includes("/presentation/scope")) return json(scope);
      if (url.includes("/alerts")) {
        return json([
          alertRow(FIRST_PARTY, ["CI"]),
          alertRow(FOREIGN, ["deploy"]),
        ]);
      }
      return new Response("null", { status: 404 });
    },
  };
});

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string) => wire.respond(url),
  },
}));

import CoordLayout from "./layout";

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  // A console page that is not a lens surface, so it is never registered
  // presentation-ready and the layout's `PresentationPage` always withholds
  // it. (It was `/admin/coord/devops` until Phase 7 registered that route.)
  window.history.replaceState(null, "", "/admin/coord/pipeline");
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — entered through the header toggle", () => {
  it("turns the operator console into the presentation lens from the header, and the red-main banner stops naming a repository the scope does not clear", async () => {
    const { container } = render(
      <CoordLayout>
        <p>Console page</p>
      </CoordLayout>
    );

    const toggle = screen.getByRole("button", { name: "Presentation mode" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Console page")).toBeTruthy();
    // The operator sees every repository.
    await waitFor(() =>
      expect(container).toHaveTextContent(`${wire.FOREIGN} main is RED`)
    );

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(container).toHaveTextContent(
        `${wire.FIRST_PARTY}'s main branch is failing its checks`
      )
    );
    expect(container).toHaveTextContent(
      "A repository's main branch is failing its checks"
    );
    expect(container.innerHTML).not.toContain("client-org");
    // The page itself is withheld until it is prepared for presentation.
    expect(screen.queryByText("Console page")).toBeNull();
  });
});
