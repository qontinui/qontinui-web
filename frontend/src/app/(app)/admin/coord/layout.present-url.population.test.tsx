/**
 * The console layout entered the way its population enters it (plan
 * `2026-10-23-console-presentation-spaces` Phase 1 Arming: "a console page
 * loaded with `?present=1` ... | the console header toggle and `?present=1`
 * URLs").
 *
 * The REAL `CoordLayout` renders, with the REAL red-main banner it mounts on
 * every console page; what is faked is only the network (`httpClient`, which
 * both the banner's alerts read and the lens's scope read go through) and the
 * router's search params. The file imports nothing the phase added, so
 * without the phase it fails on its assertions, not on an import — which is
 * what lets `arming-record.sh prove` observe it.
 */

import { render, screen, waitFor } from "@testing-library/react";
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
  const DEVICE = "0b9d6a54-0000-4000-8000-0000000000aa";
  const SESSION = "5f3c2e1d-1111-4222-8333-444455556666";
  const RUN = "987654321";
  const alertRow = (
    repo: string,
    workflows: string[],
    detail: Record<string, unknown> = {},
    extra: Record<string, unknown> = {}
  ) => ({
    id: repo.length,
    alert_key: `red_main:${repo}`,
    severity: "critical",
    kind: "red_main",
    summary: `Main CI for ${repo} is RED`,
    first_seen_at: "2026-07-06T01:00:00Z",
    detail: {
      repo,
      workflows,
      blocked_pr_count: 1,
      fix_session: "none",
      ...detail,
    },
    ...extra,
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
    DEVICE,
    SESSION,
    RUN,
    urls: [] as string[],
    respond(url: string): Response {
      if (url.includes("/presentation/scope")) return json(scope);
      if (url.includes("/alerts")) {
        return json([
          // First-party, claimed by an agent on a device, with coord's own
          // self-heal re-run in flight.
          alertRow(
            FIRST_PARTY,
            ["CI"],
            { fix_session: `auto-rerun-failed-jobs:${RUN}` },
            {
              claimed: true,
              claim: { claimed_by: `device:${DEVICE}:session:${SESSION}` },
            }
          ),
          // Foreign, with a stale push baseline on one of its workflows.
          alertRow(FOREIGN, ["deploy", "lint-portal"], {
            baseline_freshness: {
              read: "ok",
              all_contradicted: false,
              workflows: [
                { workflow: "deploy", verdict: "corroborated" },
                { workflow: "lint-portal", verdict: "contradicted" },
              ],
            },
          }),
        ]);
      }
      return new Response("null", { status: 404 });
    },
  };
});

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string) => {
      wire.urls.push(url);
      return wire.respond(url);
    },
  },
}));

import CoordLayout from "./layout";

function visit(search: string) {
  window.history.replaceState(null, "", `/admin/coord/devops${search}`);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  wire.urls.length = 0;
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("CoordLayout — entered through a console URL", () => {
  it("opens a console URL carrying ?present=1 as the presentation lens, and the red-main banner names only repositories the scope clears", async () => {
    visit("?present=1");
    const { container } = render(
      <CoordLayout>
        <p>Console page</p>
      </CoordLayout>
    );

    // The scope is the lens's one read; once it is in, the first-party
    // repository is named and the foreign one stays withheld. Asserted
    // before the chip, so a console without the redaction fails HERE.
    await waitFor(() =>
      expect(container).toHaveTextContent(`${wire.FIRST_PARTY} main is RED`)
    );
    expect(container).toHaveTextContent("A repository main is RED");
    expect(container.innerHTML).not.toContain("client-org");
    expect(container.innerHTML).not.toContain("deploy");
    expect(wire.urls.some((u) => u.includes("/presentation/scope"))).toBe(true);
    expect(
      screen.getByRole("button", { name: "Presentation mode" })
    ).toHaveAttribute("aria-pressed", "true");
    // The redacted row names none of its workflows, stale ones included.
    expect(container.innerHTML).not.toContain("lint-portal");
    expect(container).toHaveTextContent(
      "stale push baseline on 1 workflow, contradicted by newer passing runs"
    );
    // The claimant is a kind and a machine alias, never an id; coord's run
    // reference is not shown.
    expect(container).toHaveTextContent("claimed by an agent on Machine A");
    expect(container.innerHTML).not.toContain(wire.DEVICE.slice(0, 8));
    expect(container.innerHTML).not.toContain(wire.SESSION.slice(0, 8));
    expect(container.innerHTML).not.toContain(wire.RUN);
    // A console page nobody prepared for presentation is withheld, not shown:
    // its caption and a plain statement stand in for it.
    expect(screen.queryByText("Console page")).toBeNull();
    expect(
      screen.getByRole("heading", { level: 1, name: "Dev Ops" })
    ).toBeTruthy();
    expect(screen.getByText("Shown in the operator view only")).toBeTruthy();
  });
});
