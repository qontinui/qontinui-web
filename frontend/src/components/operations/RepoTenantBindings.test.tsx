/**
 * Tests for the Repository tenant bindings card (plan
 * `2026-10-17-per-repo-tenant-binding-overrides-the-org-tenant` Phase 7).
 *
 * Under test:
 *   - the three read states: LOADED (both sides of the one list door),
 *     EMPTY-MEASURED (an explicit "none, measured at …"), and UNKNOWN (a
 *     failed read names coord's code and message and never renders an empty
 *     list);
 *   - the bind form's validation: repo shape, required reason, required
 *     target — and no request leaves while any of them fails;
 *   - the target list is the operator's ADMIN tenants;
 *   - a bind acknowledges itself and lands in a terminal state, with coord's
 *     error code on a refusal;
 *   - unbind requires a reason, sends DELETE with `{repo, reason}`, and
 *     reports its success after the row is re-read away.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

const authState = vi.hoisted(() => ({ isCoordAdmin: true }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

const tenantState = vi.hoisted(() => ({
  tenants: [] as { id: string; slug: string; name: string; roles?: string[] }[],
  loading: false,
  error: null as string | null,
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: tenantState.tenants,
    activeTenantId: tenantState.tenants[0]?.id ?? null,
    isMultiTenant: tenantState.tenants.length > 1,
    loading: tenantState.loading,
    error: tenantState.error,
    setActiveTenantId: () => undefined,
    refresh: async () => true,
  }),
}));

import {
  RepoTenantBindings,
  bindTargetOptions,
  validateBindForm,
} from "./RepoTenantBindings";

const BOUND_TENANT = "ce1ec20c-9cf1-427a-857d-81d6449cc6e4";
const ORG_TENANT = "b3ecb579-0000-4000-8000-000000000001";
const LIST_URL_SUFFIX = "/pr-merge/onboarding/repo-bindings";

const BOUND_HERE = {
  repo: "meryts/bauhaus-b2b-dev-notes",
  tenant_id: BOUND_TENANT,
  tenant_slug: "bauhaus-b2b",
  org_tenant_id: ORG_TENANT,
  org_tenant_slug: "meryts-2-0",
  bound_by: "operator:alice",
  reason: "operator decision 2026-10-17",
  decision_ref: "decision_record/repositories-live-in-the-meryts-org",
  created_at: "2026-10-17T10:00:00Z",
  updated_at: "2026-10-17T10:00:00Z",
  caller_side: "bound" as const,
};

const BOUND_AWAY = {
  ...BOUND_HERE,
  repo: "meryts/bauhaus-b2b-shop",
  decision_ref: null,
  caller_side: "org" as const,
};

const MOVE_RESULT = {
  repo: "Meryts/bauhaus-b2b-shop",
  from_tenant: ORG_TENANT,
  to_tenant: BOUND_TENANT,
  governed_by: "binding",
  moved: { tenant_repos: 1, profile: 0, canonical: 1 },
  binding_written: true,
  audit_ids: ["a1", "a2"],
  notified: true,
  idempotent: false,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = [string, { method: string; body?: string; maxRetries?: number }];

function callsOf(method: string): Call[] {
  return (fetchMock.mock.calls as Call[]).filter((c) => c[1].method === method);
}

/** Route GETs to `listBodies` in order (the last repeats); writes to `write`. */
function routeFetch(
  listBodies: Array<() => Response>,
  write?: () => Response | Promise<Response>
) {
  let i = 0;
  fetchMock.mockImplementation(
    async (url: string, opts: { method: string }) => {
      expect(url.endsWith(LIST_URL_SUFFIX)).toBe(true);
      if (opts.method === "GET") {
        const make = listBodies[Math.min(i, listBodies.length - 1)];
        i += 1;
        return make!();
      }
      if (!write) throw new Error(`unexpected ${opts.method}`);
      return write();
    }
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  authState.isCoordAdmin = true;
  tenantState.tenants = [
    { id: ORG_TENANT, slug: "meryts-2-0", name: "Meryts", roles: ["admin"] },
    {
      id: BOUND_TENANT,
      slug: "bauhaus-b2b",
      name: "Bauhaus",
      roles: ["admin"],
    },
    {
      id: "dev-only",
      slug: "pizzeria",
      name: "Pizzeria",
      roles: ["developer"],
    },
  ];
  tenantState.loading = false;
  tenantState.error = null;
});

describe("<RepoTenantBindings> read states", () => {
  it("LOADED: lists both sides of the one list door", async () => {
    routeFetch([
      () =>
        json({
          bindings: [BOUND_HERE, BOUND_AWAY],
          measured_at: "2026-10-24T08:00:00Z",
        }),
    ]);
    render(<RepoTenantBindings />);

    const here = await screen.findByTestId("repo-bindings-bound-here");
    expect(
      within(here).getByTestId(`repo-binding-row-${BOUND_HERE.repo}`)
        .textContent
    ).toContain("from meryts-2-0");
    const away = screen.getByTestId("repo-bindings-bound-away");
    expect(
      within(away).getByTestId(`repo-binding-row-${BOUND_AWAY.repo}`)
        .textContent
    ).toContain("bound to bauhaus-b2b");
    expect(screen.getByTestId("repo-tenant-bindings").dataset.readState).toBe(
      "loaded"
    );
    expect(screen.queryByTestId("repo-tenant-bindings-unknown")).toBeNull();

    // Detail expands in place with who / why / decision.
    fireEvent.click(
      within(
        screen.getByTestId(`repo-binding-row-${BOUND_HERE.repo}`)
      ).getByRole("button", { expanded: false })
    );
    const detail = await screen.findByTestId(
      `repo-binding-detail-${BOUND_HERE.repo}`
    );
    expect(detail.textContent).toContain("operator:alice");
    expect(detail.textContent).toContain("operator decision 2026-10-17");
    expect(detail.textContent).toContain(BOUND_HERE.decision_ref);
  });

  it("EMPTY-MEASURED: says none were measured, rather than rendering nothing", async () => {
    routeFetch([
      () => json({ bindings: [], measured_at: "2026-10-24T08:00:00Z" }),
    ]);
    render(<RepoTenantBindings />);

    const emptyHere = await screen.findByTestId(
      "repo-bindings-bound-here-empty"
    );
    expect(emptyHere.textContent).toContain(
      "No repositories are bound to this tenant"
    );
    expect(emptyHere.textContent).toContain("measured");
    expect(screen.getByTestId("repo-bindings-bound-away-empty")).toBeTruthy();
    expect(screen.queryByTestId("repo-tenant-bindings-unknown")).toBeNull();
  });

  it("UNKNOWN: a failed read names coord's code and never renders an empty list", async () => {
    routeFetch([
      () =>
        json(
          {
            error: "migration_pending",
            message: "the bindings table is not migrated yet",
          },
          503
        ),
    ]);
    render(<RepoTenantBindings />);

    const unknown = await screen.findByTestId("repo-tenant-bindings-unknown");
    expect(unknown.textContent).toContain("UNKNOWN");
    expect(unknown.textContent).toContain("503 migration_pending");
    expect(unknown.textContent).toContain(
      "the bindings table is not migrated yet"
    );
    expect(screen.queryByTestId("repo-bindings-bound-here-empty")).toBeNull();
    expect(screen.queryByTestId("repo-bindings-bound-here")).toBeNull();
    expect(screen.getByTestId("repo-tenant-bindings").dataset.readState).toBe(
      "unknown"
    );
  });

  it("UNKNOWN: a 200 without a bindings list is not read as empty", async () => {
    routeFetch([() => json({ measured_at: "2026-10-24T08:00:00Z" })]);
    render(<RepoTenantBindings />);
    const unknown = await screen.findByTestId("repo-tenant-bindings-unknown");
    expect(unknown.textContent).toContain("without a bindings list");
    expect(screen.queryByTestId("repo-bindings-bound-here-empty")).toBeNull();
  });
});

describe("bind form validation", () => {
  it("validateBindForm: repo shape, required reason, required target", () => {
    expect(
      validateBindForm({ repo: "", targetTenant: "", reason: "" })
    ).toEqual({
      repo: "Enter a repository as owner/name.",
      targetTenant: "Choose the tenant to bind to.",
      reason: "A reason is required.",
    });
    for (const bad of ["backend", "a/b/c", "owner/", "/name", "owner/na me"]) {
      expect(
        validateBindForm({ repo: bad, targetTenant: "t", reason: "r" }).repo
      ).toBe("Repository must be owner/name (one slash, no spaces).");
    }
    expect(
      validateBindForm({ repo: "Meryts/x", targetTenant: "t", reason: "   " })
        .reason
    ).toBe("A reason is required.");
    expect(
      validateBindForm({
        repo: " Meryts/bauhaus-b2b-shop ",
        targetTenant: "t",
        reason: "r",
      })
    ).toEqual({});
  });

  it("bindTargetOptions: admin tenants only; absent roles offered as unknown", () => {
    const opts = bindTargetOptions([
      { id: "a", slug: "a", name: "A", roles: ["admin"] },
      { id: "b", slug: "b", name: "B", roles: ["developer"] },
      { id: "c", slug: "c", name: "C" },
    ]);
    expect(opts.map((o) => o.id)).toEqual(["a", "c"]);
    expect(opts[1]!.label).toContain("admin role unknown");
  });

  it("refuses to send while invalid and shows every field's error", async () => {
    routeFetch([
      () => json({ bindings: [], measured_at: "2026-10-24T08:00:00Z" }),
    ]);
    render(<RepoTenantBindings />);
    await screen.findByTestId("repo-bindings-bound-here-empty");

    fireEvent.change(screen.getByTestId("repo-binding-bind-repo"), {
      target: { value: "not-a-repo" },
    });
    fireEvent.click(screen.getByTestId("repo-binding-bind-submit"));

    expect(
      (await screen.findByTestId("repo-binding-bind-repo-error")).textContent
    ).toContain("owner/name");
    expect(screen.getByTestId("repo-binding-bind-target-error")).toBeTruthy();
    expect(screen.getByTestId("repo-binding-bind-reason-error")).toBeTruthy();
    expect(callsOf("POST")).toHaveLength(0);
  });

  it("offers only the operator's admin tenants as targets", async () => {
    routeFetch([
      () => json({ bindings: [], measured_at: "2026-10-24T08:00:00Z" }),
    ]);
    render(<RepoTenantBindings />);
    const select = (await screen.findByTestId(
      "repo-binding-bind-target"
    )) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["", ORG_TENANT, BOUND_TENANT]);
  });

  it("an unreadable tenant list is UNKNOWN, not 'no admin tenants'", async () => {
    tenantState.tenants = [];
    tenantState.error = "failed to load tenants";
    routeFetch([
      () => json({ bindings: [], measured_at: "2026-10-24T08:00:00Z" }),
    ]);
    render(<RepoTenantBindings />);
    const unknown = await screen.findByTestId(
      "repo-binding-bind-target-unknown"
    );
    expect(unknown.textContent).toContain("UNKNOWN");
    expect(screen.queryByTestId("repo-binding-bind-target-none")).toBeNull();
  });
});

describe("bind action", () => {
  function fillValidBind() {
    fireEvent.change(screen.getByTestId("repo-binding-bind-repo"), {
      target: { value: "Meryts/bauhaus-b2b-shop" },
    });
    fireEvent.change(screen.getByTestId("repo-binding-bind-target"), {
      target: { value: BOUND_TENANT },
    });
    fireEvent.change(screen.getByTestId("repo-binding-bind-reason"), {
      target: { value: "operator decision 2026-10-17" },
    });
  }

  it("acknowledges itself, POSTs once, and lands in a success state", async () => {
    let release: (r: Response) => void = () => undefined;
    routeFetch(
      [
        () => json({ bindings: [], measured_at: "2026-10-24T08:00:00Z" }),
        () =>
          json({ bindings: [BOUND_AWAY], measured_at: "2026-10-24T08:01:00Z" }),
      ],
      () => new Promise<Response>((r) => (release = r))
    );
    render(<RepoTenantBindings />);
    await screen.findByTestId("repo-bindings-bound-here-empty");
    fillValidBind();
    fireEvent.click(screen.getByTestId("repo-binding-bind-submit"));

    const submit = await screen.findByTestId("repo-binding-bind-submit");
    await waitFor(() => expect(submit.textContent).toBe("Binding…"));
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    release(json(MOVE_RESULT));
    const outcome = await screen.findByTestId("repo-binding-bind-outcome");
    expect(outcome.dataset.outcome).toBe("ok");
    expect(outcome.textContent).toContain("Bound Meryts/bauhaus-b2b-shop");
    expect(outcome.textContent).toContain("2 audit rows");

    const [, opts] = callsOf("POST")[0]!;
    expect(callsOf("POST")).toHaveLength(1);
    expect(opts.maxRetries).toBe(0);
    expect(JSON.parse(opts.body!)).toEqual({
      repo: "Meryts/bauhaus-b2b-shop",
      target_tenant: BOUND_TENANT,
      reason: "operator decision 2026-10-17",
    });
    // The list was re-read after the write.
    await screen.findByTestId(`repo-binding-row-${BOUND_AWAY.repo}`);
  });

  it("a coord refusal lands in an error state naming its code", async () => {
    routeFetch(
      [() => json({ bindings: [], measured_at: "2026-10-24T08:00:00Z" })],
      () =>
        json(
          {
            error: "not_admin_in_both_tenants",
            message: "admin is required in both tenants",
            failed_tenant: BOUND_TENANT,
          },
          403
        )
    );
    render(<RepoTenantBindings />);
    await screen.findByTestId("repo-bindings-bound-here-empty");
    fillValidBind();
    fireEvent.change(screen.getByTestId("repo-binding-bind-decision-ref"), {
      target: { value: "decision_record/x" },
    });
    fireEvent.click(screen.getByTestId("repo-binding-bind-submit"));

    const outcome = await screen.findByTestId("repo-binding-bind-outcome");
    expect(outcome.dataset.outcome).toBe("error");
    expect(outcome.textContent).toContain("403 not_admin_in_both_tenants");
    expect(outcome.textContent).toContain("admin is required in both tenants");
    expect(JSON.parse(callsOf("POST")[0]![1].body!).decision_ref).toBe(
      "decision_record/x"
    );
    const submit = screen.getByTestId(
      "repo-binding-bind-submit"
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Bind");
  });
});

describe("unbind action", () => {
  async function openRow(repo: string) {
    const row = await screen.findByTestId(`repo-binding-row-${repo}`);
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    return screen.findByTestId(`repo-binding-unbind-form-${repo}`);
  }

  it("requires a reason and sends nothing without one", async () => {
    routeFetch([
      () =>
        json({ bindings: [BOUND_HERE], measured_at: "2026-10-24T08:00:00Z" }),
    ]);
    render(<RepoTenantBindings />);
    await openRow(BOUND_HERE.repo);

    fireEvent.change(
      screen.getByTestId(`repo-binding-unbind-reason-${BOUND_HERE.repo}`),
      {
        target: { value: "   " },
      }
    );
    fireEvent.click(
      screen.getByTestId(`repo-binding-unbind-${BOUND_HERE.repo}`)
    );

    expect(
      (
        await screen.findByTestId(
          `repo-binding-unbind-reason-error-${BOUND_HERE.repo}`
        )
      ).textContent
    ).toBe("A reason is required.");
    expect(callsOf("DELETE")).toHaveLength(0);
  });

  it("sends DELETE {repo, reason} and reports success after the re-read", async () => {
    routeFetch(
      [
        () =>
          json({ bindings: [BOUND_HERE], measured_at: "2026-10-24T08:00:00Z" }),
        () => json({ bindings: [], measured_at: "2026-10-24T08:02:00Z" }),
      ],
      () =>
        json({
          ...MOVE_RESULT,
          repo: BOUND_HERE.repo,
          governed_by: "org",
          binding_written: false,
        })
    );
    render(<RepoTenantBindings />);
    await openRow(BOUND_HERE.repo);

    fireEvent.change(
      screen.getByTestId(`repo-binding-unbind-reason-${BOUND_HERE.repo}`),
      {
        target: { value: "returning it to the org" },
      }
    );
    fireEvent.click(
      screen.getByTestId(`repo-binding-unbind-${BOUND_HERE.repo}`)
    );

    const notice = await screen.findByTestId("repo-binding-unbind-outcome");
    expect(notice.textContent).toContain(`Unbound ${BOUND_HERE.repo}`);
    await screen.findByTestId("repo-bindings-bound-here-empty");

    const [, opts] = callsOf("DELETE")[0]!;
    expect(opts.maxRetries).toBe(0);
    expect(JSON.parse(opts.body!)).toEqual({
      repo: BOUND_HERE.repo,
      reason: "returning it to the org",
    });
  });

  it("an unbind refusal stays on the row with coord's code", async () => {
    routeFetch(
      [
        () =>
          json({ bindings: [BOUND_AWAY], measured_at: "2026-10-24T08:00:00Z" }),
      ],
      () =>
        json(
          {
            error: "in_flight_merge_proposals",
            message: "proposals are in flight",
            proposal_ids: ["p1"],
          },
          409
        )
    );
    render(<RepoTenantBindings />);
    await openRow(BOUND_AWAY.repo);
    // The org side reclaims.
    expect(
      screen.getByTestId(`repo-binding-unbind-${BOUND_AWAY.repo}`).textContent
    ).toBe("Reclaim");

    fireEvent.change(
      screen.getByTestId(`repo-binding-unbind-reason-${BOUND_AWAY.repo}`),
      {
        target: { value: "reclaim" },
      }
    );
    fireEvent.click(
      screen.getByTestId(`repo-binding-unbind-${BOUND_AWAY.repo}`)
    );

    const err = await screen.findByTestId(
      `repo-binding-unbind-error-${BOUND_AWAY.repo}`
    );
    expect(err.textContent).toContain("409 in_flight_merge_proposals");
    expect(screen.queryByTestId("repo-binding-unbind-outcome")).toBeNull();
  });

  it("hides bind and unbind controls from a non-admin", async () => {
    authState.isCoordAdmin = false;
    routeFetch([
      () =>
        json({ bindings: [BOUND_HERE], measured_at: "2026-10-24T08:00:00Z" }),
    ]);
    render(<RepoTenantBindings />);
    const row = await screen.findByTestId(
      `repo-binding-row-${BOUND_HERE.repo}`
    );
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    await screen.findByTestId(`repo-binding-detail-${BOUND_HERE.repo}`);
    expect(
      screen.queryByTestId(`repo-binding-unbind-form-${BOUND_HERE.repo}`)
    ).toBeNull();
    expect(screen.queryByTestId("repo-binding-bind-form")).toBeNull();
  });
});
