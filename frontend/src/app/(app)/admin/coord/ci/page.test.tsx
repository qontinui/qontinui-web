/**
 * /admin/coord/ci — rendered.
 *
 * Plan `2026-10-04-ci-dashboard-in-the-dev-ops-console` Phase 4. The pure
 * derivation is pinned by `_lib/ciDashboardStatus.test.ts`; this file pins
 * that the PAGE honours it:
 *
 * 1. **A coord that predates `/coord/ci/overview` (404) is an UNKNOWN
 *    banner** and an amber strip, never an empty fleet and never green.
 * 2. **An unknown pool renders `–`, never `0`, and the strip reads UNKNOWN**
 *    (Phase 4 verification (b), as a unit-level stand-in for the UI Bridge
 *    check).
 * 3. **The authored testids exist** — `ci-page`, `ci-health-strip`,
 *    `ci-pool-row-<pool>`, `ci-repo-row-<repo>`, `ci-freshness-*` — and every
 *    figure on a row has a freshness stamp beside it.
 * 4. **A pool row expands in place** to its per-repo members.
 * 5. **The machines line links to the Overview** (D1: the machine axis stays
 *    there).
 * 6. **The GitHub-hosted CI panel mounts here, directly under the strip**
 *    (Phase 6), and its writes stay gated on admin IN THE ACTIVE TENANT even
 *    though the page itself is member-visible.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { RepoCiRow } from "@/components/operations/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/coord/ci",
}));

const httpGet = vi.fn();
const httpPut = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...a: unknown[]) => httpGet(...a),
    put: (...a: unknown[]) => httpPut(...a),
    // The typed /operations client reads over `httpClient.fetch` (plan
    // 2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls
    // Phase 7): route it through the same GET table. A rejection passes
    // through unchanged, so error-path tests see the identical Error. Only
    // a GET may take this route: any other method throws, so a future
    // write cannot silently be answered from the GET table.
    fetch: async (...a: unknown[]) => {
      const method = (a[1] as RequestInit | undefined)?.method;
      if (method !== undefined && method.toUpperCase() !== "GET") {
        throw new Error(
          `httpClient.fetch mock serves GET only; got ${method} ${String(a[0])}`
        );
      }
      return new Response(JSON.stringify(await httpGet(...a)), {
        status: 200,
      });
    },
  },
}));

// The hosted-CI panel's writes are offered to an admin of the ACTIVE tenant
// only (`isActiveTenantCoordAdmin`), so the page reads both contexts.
const authState = {
  user: { is_superuser: false, coord_is_admin: false },
};
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: false, user: authState.user }),
}));
const tenantState: {
  tenants: { id: string; slug: string; name: string; roles?: string[] }[];
  activeTenantId: string | null;
} = {
  tenants: [{ id: "t-a", slug: "a", name: "A", roles: ["admin"] }],
  activeTenantId: "t-a",
};
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: tenantState.tenants,
    activeTenantId: tenantState.activeTenantId,
  }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const ciStream = vi.fn();
vi.mock("@/components/operations/useCiStatusStream", () => ({
  useCiStatusStream: () => ciStream(),
}));

import CoordCiPage from "./page";

const NOW_ISO = new Date().toISOString();
const WEB = "qontinui/qontinui-web";
const CCFG = "qontinui/qontinui-claude-config";

function measuredPool(over: Record<string, unknown> = {}) {
  return {
    repo: WEB,
    pool: "qontinui,self-hosted",
    state: "measured",
    state_reason: null,
    observed_at: NOW_ISO,
    stale_after_secs: 360,
    poll_ok: true,
    poll_complete: true,
    queued_jobs: 0,
    oldest_queued_age_secs: null,
    threshold_secs: 1800,
    p90_wait_secs: 42,
    eligibility_state: "eligible",
    eligible_runners: 2,
    eligible_registrations: 3,
    unknown_registrations: 0,
    eligible_runners_drained: 0,
    eligibility_observed_at: NOW_ISO,
    required: true,
    required_note: null,
    coverage_note: "repo-registered runners only",
    open_alerts: [],
    ...over,
  };
}

const UNKNOWN_POOL = measuredPool({
  repo: CCFG,
  pool: "qontinui-ccfg,self-hosted",
  state: "unknown",
  state_reason: "registrar unrefreshed",
  poll_ok: false,
  poll_complete: false,
  queued_jobs: null,
  threshold_secs: null,
  p90_wait_secs: null,
  eligibility_state: null,
  eligible_runners: null,
  eligible_registrations: null,
  unknown_registrations: null,
  eligible_runners_drained: null,
  eligibility_observed_at: null,
});

function overviewBody(pools: unknown[], hosted?: unknown) {
  return {
    as_of: NOW_ISO,
    coverage_note: "self-hosted jobs only",
    note: null,
    pools,
    repos: [
      {
        repo: WEB,
        window_hours: 24,
        state: "measured",
        state_reason: null,
        outcomes: {
          pass: 10,
          content_fail: 0,
          infra_shaped: 2,
          neutral: 0,
          unknown: 0,
        },
        hosted: hosted ?? {
          state: "not_measured",
          note: "hosted-only workflows are not sampled",
        },
      },
    ],
  };
}

const CI_ROW: RepoCiRow = {
  repo: WEB,
  main_verdict: "green",
  open_pr_checks: { success: 3, failure: 0, pending: 0 },
  latest_details_url: null,
  main_head_sha: "abc",
  main_verdict_observed_at: NOW_ISO,
  pr_checks_observed_at: NOW_ISO,
};

function route(overview: unknown | Error) {
  httpGet.mockImplementation((url: string) => {
    if (url.endsWith("/ci/overview")) {
      return overview instanceof Error
        ? Promise.reject(overview)
        : Promise.resolve(overview);
    }
    if (url.endsWith("/pr-merge/merge-economics")) {
      return Promise.resolve({
        as_of: NOW_ISO,
        repos: [{ repo: WEB, candidate_ci_p90_secs: 600 }],
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  httpGet.mockReset();
  httpPut.mockReset();
  authState.user = { is_superuser: false, coord_is_admin: false };
  tenantState.tenants = [{ id: "t-a", slug: "a", name: "A", roles: ["admin"] }];
  tenantState.activeTenantId = "t-a";
  ciStream.mockReturnValue({
    byRepo: new Map([[WEB, CI_ROW]]),
    connected: true,
    seeded: true,
    error: null,
    asOf: NOW_ISO,
    refetch: vi.fn(),
  });
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage — the panels default open either way.
  }
});

describe("/admin/coord/ci", () => {
  it("renders a coord 404 as UNKNOWN, never an empty fleet or green", async () => {
    route(new Error("GET /api/v1/operations/ci/overview failed: 404 - "));
    render(<CoordCiPage />);
    const banner = await screen.findByTestId("ci-overview-unknown-banner");
    expect(banner.textContent).toContain("UNKNOWN");
    expect(banner.textContent).toContain("predates the route");
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "unknown"
    );
    expect(
      screen.getByTestId("ci-health-strip").getAttribute("data-health-level")
    ).toBe("amber");
    expect(screen.getByTestId("ci-pools-empty").textContent).toContain(
      "unknown, not none"
    );
    expect(screen.getByTestId("ci-pools-summary-count").textContent).toBe(
      "– pools"
    );
  });

  it("an unknown pool renders – (never 0) and holds the strip at UNKNOWN", async () => {
    route(overviewBody([measuredPool(), UNKNOWN_POOL]));
    render(<CoordCiPage />);
    const row = await screen.findByTestId(
      "ci-pool-row-qontinui-ccfg,self-hosted"
    );
    expect(row.textContent).not.toMatch(/eligible 0|queued 0/);
    const unknownCells = row.querySelectorAll('[data-known="false"]');
    expect(unknownCells.length).toBeGreaterThan(0);
    for (const c of Array.from(unknownCells)) {
      expect(c.textContent).toContain("–");
      expect(c.getAttribute("title")).toBeTruthy();
    }
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "unknown"
    );
    expect(screen.getByTestId("ci-health-strip").textContent).toContain(
      "CI capacity UNKNOWN"
    );
    // The measured pool's real zero IS a zero.
    expect(
      screen.getByTestId("ci-pool-row-qontinui,self-hosted").textContent
    ).toContain("queued 0");
  });

  it("renders the authored testids, freshness stamps, and a green strip when everything is measured", async () => {
    route(overviewBody([measuredPool()]));
    render(<CoordCiPage />);
    await screen.findByTestId("ci-pool-row-qontinui,self-hosted");
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "green"
    );
    expect(
      screen.getByTestId("ci-health-strip").getAttribute("data-health-level")
    ).toBe("green");
    expect(screen.getByTestId(`ci-repo-row-${WEB}`)).toBeTruthy();
    expect(
      screen.getByTestId("ci-freshness-pool-qontinui,self-hosted")
    ).toBeTruthy();
    expect(screen.getByTestId(`ci-freshness-main-${WEB}`)).toBeTruthy();
    expect(screen.getByTestId("ci-freshness-overview")).toBeTruthy();
    expect(screen.getByTestId("ci-freshness-ci-status")).toBeTruthy();
    // A legacy (not_measured) hosted block is a dash, never a count.
    expect(screen.getByTestId(`ci-repo-row-${WEB}`).textContent).toContain(
      "hosted –"
    );
  });

  it("an observed hosted refusal renders as an infra floor on the repo row, never content red", async () => {
    route(
      overviewBody([measuredPool()], {
        state: "observed",
        hosted_refused: 3,
        last_refused_at: NOW_ISO,
        billing_refusal: {
          alert_id: "77",
          opened_at: NOW_ISO,
          last_seen_at: NOW_ISO,
        },
        note: "hosted jobs GitHub never started",
      })
    );
    render(<CoordCiPage />);
    const cell = await screen.findByTestId(`ci-repo-hosted-${WEB}`);
    expect(cell.getAttribute("data-known")).toBe("true");
    expect(cell.getAttribute("data-tone")).toBe("infra");
    expect(cell.textContent).toBe("hosted ≥3 refused (billing)");
    expect(cell.getAttribute("title")).toMatch(/not a code failure/);
    const row = screen.getByTestId(`ci-repo-row-${WEB}`);
    expect(row.textContent).toContain("content fail 0");
    // The level does not move (R3's third case — hosted CI is off, so the
    // floor never self-clears); the strip DETAIL names the billing cause.
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "green"
    );
    expect(screen.getByTestId("ci-health-strip").textContent).toContain(
      "GitHub Actions billing refusing hosted jobs"
    );
    expect(screen.getByTestId("ci-health-badge-hosted").textContent).toBe(
      "billing refusing hosted ≥3"
    );
  });

  it("a none_observed hosted block renders –, never 0", async () => {
    route(
      overviewBody([measuredPool()], {
        state: "none_observed",
        hosted_refused: null,
        last_refused_at: null,
        billing_refusal: null,
        note: "no hosted refusal in the window",
      })
    );
    render(<CoordCiPage />);
    const cell = await screen.findByTestId(`ci-repo-hosted-${WEB}`);
    expect(cell.getAttribute("data-known")).toBe("false");
    expect(cell.textContent).toBe("hosted –");
    expect(cell.getAttribute("title")).toMatch(/not a measured zero/);
  });

  it("expands a pool row in place to its per-repo members", async () => {
    route(overviewBody([measuredPool(), measuredPool({ repo: CCFG })]));
    render(<CoordCiPage />);
    const row = await screen.findByTestId("ci-pool-row-qontinui,self-hosted");
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    const members = await screen.findByTestId("ci-pool-members");
    expect(within(members).getByTestId(`ci-pool-member-${WEB}`)).toBeTruthy();
    expect(within(members).getByTestId(`ci-pool-member-${CCFG}`)).toBeTruthy();
  });

  it("an open alert on an unknown pool is amber with its age, never 'Stuck'", async () => {
    route(
      overviewBody([
        {
          ...UNKNOWN_POOL,
          open_alerts: [
            {
              alert_id: "918273",
              kind: "ci_job_queue_stalled",
              opened_at: "2026-10-03T09:00:00Z",
              last_seen_at: "2026-10-03T11:30:00Z",
              occurrences: 4,
              current_state_note: "pool not measured since the alert fired",
              summary: "14 queued, oldest 3h12m",
            },
          ],
        },
      ])
    );
    render(<CoordCiPage />);
    const row = await screen.findByTestId(
      "ci-pool-row-qontinui-ccfg,self-hosted"
    );
    expect(
      within(row).getByTestId("ci-pool-status").getAttribute("data-status")
    ).toBe("alert_unconfirmed");
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "unknown"
    );
    expect(screen.getByTestId("ci-health-strip").textContent).not.toContain(
      "Stuck"
    );
    fireEvent.click(within(row).getAllByRole("button")[0]!);
    const alert = await screen.findByTestId("ci-pool-alert-918273");
    expect(alert.textContent).toContain("at fire time: 14 queued");
    expect(alert.textContent).toContain(
      "pool not measured since the alert fired"
    );
    expect(screen.getByTestId("ci-freshness-alert-918273")).toBeTruthy();
  });

  it("drives data-ci-health=red for a measured required pool with no eligible runner", async () => {
    route(
      overviewBody([
        measuredPool({
          eligibility_state: "no_eligible_runner",
          eligible_runners: 0,
          queued_jobs: 14,
        }),
      ])
    );
    render(<CoordCiPage />);
    await screen.findByTestId("ci-pool-row-qontinui,self-hosted");
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "red"
    );
    expect(
      screen.getByTestId("ci-health-strip").getAttribute("data-health-level")
    ).toBe("red");
    expect(screen.getByTestId("ci-health-strip").textContent).toContain(
      "Stuck: [qontinui, self-hosted]"
    );
  });

  it("drives data-ci-health=amber for a measured pool over its bound with no alert", async () => {
    route(
      overviewBody([
        measuredPool({ queued_jobs: 3, oldest_queued_age_secs: 4000 }),
      ])
    );
    render(<CoordCiPage />);
    await screen.findByTestId("ci-pool-row-qontinui,self-hosted");
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "amber"
    );
    expect(screen.getByTestId("ci-health-strip").textContent).toContain(
      "Waiting:"
    );
  });

  it("renders candidate CI p90 from the economics read", async () => {
    route(overviewBody([measuredPool()]));
    render(<CoordCiPage />);
    const row = await screen.findByTestId(`ci-repo-row-${WEB}`);
    // 600 s from the economics fixture.
    await waitFor(() => expect(row.textContent).toContain("cand. p90 10m"));
  });

  it("lists unattached alerts amber, keyed by alert id, and never turns the strip red", async () => {
    const body = {
      ...overviewBody([measuredPool()]),
      unattached_alerts: [
        {
          repo: WEB,
          pool: "qontinui,self-hosted",
          alert_id: "47990",
          kind: "ci_pool_no_eligible_runner",
          opened_at: "2026-10-03T08:12:00Z",
          last_seen_at: "2026-10-03T08:40:00Z",
          occurrences: 3,
          summary: "0 eligible runners",
          current_state_note: "no persisted pool row matches this alert",
        },
      ],
    };
    route(body);
    render(<CoordCiPage />);
    const row = await screen.findByTestId("ci-alert-unattached-47990");
    expect(row.getAttribute("data-attention")).toBe("waiting");
    expect(row.textContent).toContain("fired 2026-10-03T08:12:00Z");
    expect(row.textContent).toContain("no persisted pool row matches");
    expect(screen.getByTestId("ci-page").getAttribute("data-ci-health")).toBe(
      "unknown"
    );
    expect(screen.getByTestId("ci-health-strip").textContent).not.toContain(
      "Stuck"
    );
  });

  it("stamps repo outcomes with last_observed_at and notes unwatched pools", async () => {
    const body = overviewBody([measuredPool()]);
    body.repos[0] = {
      ...body.repos[0]!,
      last_observed_at: NOW_ISO,
      pools_watched: false,
    } as (typeof body.repos)[number];
    route(body);
    render(<CoordCiPage />);
    const stamp = await screen.findByTestId(
      `ci-freshness-repo-outcomes-${WEB}`
    );
    expect(stamp.textContent).not.toMatch(/NaN|freshness unknown/);
    expect(screen.getByTestId(`ci-repo-no-pools-${WEB}`).textContent).toBe(
      "no watched pools"
    );
  });

  it("a pool with a null observed_at shows 'freshness unknown', never NaN or '–ago'", async () => {
    route(
      overviewBody([
        { ...UNKNOWN_POOL, observed_at: null, stale_after_secs: null },
      ])
    );
    render(<CoordCiPage />);
    const stamp = await screen.findByTestId(
      "ci-freshness-pool-qontinui-ccfg,self-hosted"
    );
    expect(stamp.textContent).toBe("freshness unknown");
    expect(
      screen.getByTestId("ci-pool-row-qontinui-ccfg,self-hosted").textContent
    ).not.toMatch(/NaN|–ago|undefined/);
  });

  it("links the machine axis to the Dev Ops overview", async () => {
    route(overviewBody([measuredPool()]));
    render(<CoordCiPage />);
    const link = await screen.findByTestId("ci-machines-link");
    expect(link.getAttribute("href")).toBe("/admin/coord/devops");
  });
});

/** Layer the hosted-CI reads over `route()`'s overview + economics routes. */
function withHostedCi(opts: { canEdit: boolean }) {
  const base = httpGet.getMockImplementation();
  httpGet.mockImplementation((url: string) => {
    if (url.includes("/fleet-policy")) {
      return Promise.resolve({
        domain: "github_hosted_ci",
        effective_level: "off",
        master_enabled: true,
        resolved_scope: "tenant",
        can_edit: opts.canEdit,
        keys_not_shown: [],
        keys_not_shown_source: null,
      });
    }
    if (url.includes("/ci-hosting")) {
      return Promise.resolve({
        domain: "github_hosted_ci",
        tenant_default: {
          level: "off",
          resolved_scope: "tenant",
          unknown_reason: null,
        },
        repos: [
          {
            repo: WEB,
            level: "off",
            resolved_scope: "tenant",
            unknown_reason: null,
          },
        ],
        can_edit: opts.canEdit,
      });
    }
    return base
      ? base(url)
      : Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

describe("/admin/coord/ci — GitHub-hosted CI (Phase 6)", () => {
  it("mounts the panel directly under the strip; a coord without the read renders it UNKNOWN", async () => {
    // `route()` rejects every hosted-CI route — a build that serves neither the
    // hosted-CI read nor the dial yet.
    route(overviewBody([measuredPool()]));
    render(<CoordCiPage />);

    const panel = await screen.findByTestId("github-hosted-ci-panel");
    expect(
      await within(panel).findByTestId("github-hosted-ci-repos-error")
    ).toBeInTheDocument();
    expect(
      within(panel).getByTestId("github-hosted-ci-tenant-effective").textContent
    ).toBe("–");
    // Order: strip, then the panel, then the Pools panel.
    const page = screen.getByTestId("ci-page");
    const order = Array.from(
      page.querySelectorAll(
        "[data-testid='ci-health-strip'], [data-testid='github-hosted-ci-panel'], [data-testid='ci-pools-panel']"
      )
    ).map((el) => el.getAttribute("data-testid"));
    expect(order).toEqual([
      "ci-health-strip",
      "github-hosted-ci-panel",
      "ci-pools-panel",
    ]);
  });

  it("an admin of the active tenant gets the tenant write controls", async () => {
    route(overviewBody([measuredPool()]));
    withHostedCi({ canEdit: true });
    render(<CoordCiPage />);

    const panel = await screen.findByTestId("github-hosted-ci-panel");
    await waitFor(() =>
      expect(
        within(panel).getByTestId("github-hosted-ci-tenant-effective")
          .textContent
      ).toBe("Off")
    );
    expect(
      within(panel).getByTestId("github-hosted-ci-tenant-on")
    ).toBeEnabled();
    expect(within(panel).queryByTestId("github-hosted-ci-readonly")).toBeNull();
  });

  it("a member of the active tenant sees the setting read-only, even when the backend says can_edit", async () => {
    tenantState.tenants = [
      { id: "t-a", slug: "a", name: "A", roles: ["member"] },
      // Admin of ANOTHER tenant must not leak into this one: the union flag is
      // TRUE here, so a page gated on `coord_is_admin` (the cross-tenant
      // union) instead of the active tenant's roles would offer the write.
      { id: "t-b", slug: "b", name: "B", roles: ["admin"] },
    ];
    authState.user = { is_superuser: false, coord_is_admin: true };
    route(overviewBody([measuredPool()]));
    withHostedCi({ canEdit: true });
    render(<CoordCiPage />);

    const panel = await screen.findByTestId("github-hosted-ci-panel");
    await waitFor(() =>
      expect(
        within(panel).getByTestId("github-hosted-ci-tenant-effective")
          .textContent
      ).toBe("Off")
    );
    expect(
      within(panel).getByTestId("github-hosted-ci-tenant-on")
    ).toBeDisabled();
    expect(
      within(panel).getByTestId("github-hosted-ci-tenant-off")
    ).toBeDisabled();
    expect(
      await within(panel).findByTestId("github-hosted-ci-readonly")
    ).toBeInTheDocument();
  });
});
