/**
 * /admin/coord/spawns — the spawn-path matrix and the machine list, rendered
 * in operator mode over the real client (plan
 * `2026-10-23-console-presentation-spaces` Phase 4). Every route answers
 * `{status, body}` from the shared table, so each arm runs through the real
 * hooks, the real derivations and the real controls. Pinned here:
 *
 * 1. **The matrix renders what coord serves** — a line per path with its
 *    switch, scope, enforcement (the post-merge row's served `mode`), coord's
 *    value and the other switches' values; read-only rows say where they are
 *    set.
 * 2. **The arming** — switching a tenant row off writes the existing door
 *    (`PUT /agent-registry/admin/registry/:name`) and the row then shows what
 *    coord's effective registry READS BACK: off, "read back as asked".
 * 3. **A read-back that disagrees is shown as one**, never smoothed over; a
 *    refused write keeps coord's value and says so; a write whose read-back
 *    failed is UNKNOWN.
 * 4. **The other two doors** — `PUT /coord/next-step-settings` and `PATCH
 *    /pr-merge/settings` — each show coord's answer, compared with the ask.
 * 5. **Machines** — aliased by nobody in operator mode (real names), with the
 *    in-flight UNKNOWN stated once for the list.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/coord/spawns",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

let routes: SpawnsRoutes = defaultSpawnsRoutes();
const requests: Array<{ url: string; method: string; body: unknown }> = [];

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({
        url,
        method: (init?.method ?? "GET").toUpperCase(),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      return answerSpawnsRequest(routes, url, init);
    },
  },
}));

import {
  answerSpawnsRequest,
  defaultSpawnsRoutes,
  type SpawnsRoutes,
} from "./__fixtures__/spawnsRoutes";
import {
  effectiveBody,
  mergeSettingsBody,
  nextStepBody,
} from "./__fixtures__/spawnPaths";
import CoordSpawnsPage from "./page";

async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i += 1) await new Promise((r) => setTimeout(r, 0));
  });
}

async function renderPage() {
  render(<CoordSpawnsPage />);
  await settle();
}

function pathRow(key: string): HTMLElement {
  const row = screen
    .getAllByTestId("coord-spawns-path-row")
    .find((r) => r.getAttribute("data-path") === key);
  if (!row) throw new Error(`no path row ${key}`);
  return row;
}

async function openPath(key: string) {
  await act(async () => {
    fireEvent.click(within(pathRow(key)).getByTestId("coord-spawns-path-toggle"));
  });
  await settle();
}

function gate(key: string): HTMLElement {
  const g = screen
    .getAllByTestId("coord-spawns-gate")
    .find((el) => el.getAttribute("data-gate") === key);
  if (!g) throw new Error(`no gate ${key}`);
  return g;
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
  await settle();
}

beforeEach(() => {
  requests.length = 0;
  routes = defaultSpawnsRoutes();
});

describe("the spawn-path matrix — what coord serves", () => {
  it("draws one line per path with its switch, scope, enforcement, coord's value and the other switches", async () => {
    await renderPage();
    const pr = pathRow("pr_fix_dispatch");
    expect(within(pr).getByTestId("coord-spawns-path-switch").textContent).toContain(
      "Agent registry switch"
    );
    expect(within(pr).getByTestId("coord-spawns-path-switch").textContent).toContain(
      "and 4 more switches"
    );
    expect(within(pr).getByTestId("coord-spawns-path-scope").textContent).toBe("tenant");
    expect(
      within(pr).getByTestId("coord-spawns-path-enforced").getAttribute("data-enforced")
    ).toBe("enforce");
    expect(within(pr).getByTestId("coord-spawns-path-effective").textContent).toBe("On");
    expect(
      within(pr)
        .getAllByTestId("coord-spawns-path-chip")
        .map((c) => c.getAttribute("data-gate"))
    ).toEqual([
      "mirror:standing_continuation",
      "dial:auto_fix_pr",
      "autonomy:pr_fix",
      "flag:pr_fix",
    ]);

    // The post-merge row's enforcement is coord's served rollout mode.
    const pm = pathRow("post_merge_followup");
    expect(
      within(pm).getByTestId("coord-spawns-path-enforced").getAttribute("data-enforced")
    ).toBe("shadow");
    expect(within(pm).getByTestId("coord-spawns-path-scope").textContent).toBe("repo");

    // Runner paths: runner-only, device-scoped, UNKNOWN here by construction.
    const st = pathRow("runner_stewards");
    expect(
      within(st).getByTestId("coord-spawns-path-enforced").getAttribute("data-enforced")
    ).toBe("runner-only");
    expect(
      within(st).getByTestId("coord-spawns-path-effective").getAttribute("data-gate-state")
    ).toBe("unknown");

    // Last spawned: coord does not serve the ledger here? It does (the
    // default table) — and the gate-continuation origin names its path.
    expect(
      within(pathRow("gate_continuation"))
        .getByTestId("coord-spawns-path-last")
        .getAttribute("data-last-spawned")
    ).toBe("none");
    expect(
      within(pr).getByTestId("coord-spawns-path-last").getAttribute("data-last-spawned")
    ).toBe("unknown");
  });

  it("says where a read-only switch is set, and offers no control for it", async () => {
    await renderPage();
    await openPath("next_step_dispatch");
    const flag = gate("flag:next_step");
    expect(flag.textContent).toContain("COORD_NEXT_STEP_AUTODISPATCH_ENABLED");
    expect(within(flag).getByTestId("coord-spawns-gate-readonly").textContent).toContain(
      "deployment environment"
    );
    expect(within(flag).queryByRole("button")).toBeNull();
    await openPath("account_migration");
    const runner = gate("runner:account_migration");
    expect(runner.textContent).toContain("claude_cli.auto_migrate_on_token_exhaustion");
    expect(within(runner).queryByRole("button")).toBeNull();
  });

  it("links the operator to where a per-repository switch is set", async () => {
    await renderPage();
    await openPath("post_merge_followup");
    const link = screen.getByTestId("coord-spawns-path-set-on-post_merge_followup");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/admin/coord/agent-registry");
    expect(within(gate("scope:post_merge_followup")).queryByRole("button")).toBeNull();
  });

  it("states the in-flight UNKNOWN once for the machine list, and names machines for the operator", async () => {
    await renderPage();
    expect(screen.getByTestId("coord-spawns-inflight-note").textContent).toContain(
      "/coord/agent-fixer-arm-readiness"
    );
    const names = screen.getAllByTestId("coord-spawns-machine-name").map((n) => n.textContent);
    expect(names).toEqual(["msi-wsl", "spaceship"]);
    const [a, b] = screen.getAllByTestId("coord-spawns-machine");
    expect(within(a!).getByTestId("coord-spawns-machine-sessions").textContent).toBe(
      "3 open now"
    );
    expect(within(b!).getByTestId("coord-spawns-machine-drain").textContent).toMatch(
      /^out of service/
    );
    expect(within(b!).getByTestId("coord-spawns-machine-inflight").textContent).toBe(
      "UNKNOWN"
    );
  });
});

describe("the spawn-path matrix — writes show coord's read-back", () => {
  it("switches a tenant row off through the registry door, and shows the effective row reading off", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    // From here on coord's effective registry reads the row off.
    routes.effective = () => ({
      body: effectiveBody({ merge_shepherd: { enabled: false } }),
    });
    await click(screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off"));

    const put = requests.find((r) => r.method === "PUT");
    expect(put?.url).toBe("/api/v1/agent-registry/admin/registry/merge_shepherd");
    expect(put?.body).toEqual({ default_enabled: false });
    // The read-back is a read made AFTER the write.
    const putAt = requests.indexOf(put!);
    expect(
      requests.slice(putAt + 1).some((r) => r.url === "/api/v1/agent-registry")
    ).toBe(true);

    const effective = within(gate("registry:merge_shepherd")).getByTestId(
      "coord-spawns-gate-effective"
    );
    expect(effective.textContent).toBe("Off");
    expect(effective.getAttribute("data-gate-tone")).toBe("known");
    expect(
      within(gate("registry:merge_shepherd"))
        .getByTestId("coord-spawns-gate-effective-readback")
        .getAttribute("data-readback")
    ).toBe("matches");
    expect(
      within(pathRow("merge_shepherd")).getByTestId("coord-spawns-path-effective").textContent
    ).toBe("Off");
  });

  it("shows a read-back that disagrees with the request as a contradiction", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    // The write lands, and the operator's own preference keeps the row on.
    routes.effective = () => ({
      body: effectiveBody({ merge_shepherd: { enabled: true, source: "user_pref" } }),
    });
    await click(screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off"));
    const effective = within(gate("registry:merge_shepherd")).getByTestId(
      "coord-spawns-gate-effective"
    );
    expect(effective.textContent).toBe("On (your preference)");
    expect(effective.getAttribute("data-gate-tone")).toBe("contradiction");
    expect(
      within(gate("registry:merge_shepherd"))
        .getByTestId("coord-spawns-gate-effective-readback")
        .textContent
    ).toBe("you asked for off; coord reads back otherwise");
  });

  it("keeps coord's value and says the write was refused", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.putRegistry = () => ({
      status: 403,
      body: { error: "FORBIDDEN", message: "not_coord_tenant_admin" },
    });
    await click(screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off"));
    const g = gate("registry:merge_shepherd");
    expect(within(g).getByTestId("coord-spawns-gate-effective").textContent).toBe("On");
    expect(within(g).getByTestId("coord-spawns-gate-effective-write-note").textContent).toContain(
      "was refused"
    );
  });

  it("reads a write whose read-back failed as UNKNOWN, never as the value asked for", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.effective = () => ({ status: 502, body: { detail: "coord unreachable" } });
    await click(screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off"));
    const effective = within(gate("registry:merge_shepherd")).getByTestId(
      "coord-spawns-gate-effective"
    );
    expect(effective.textContent).toBe("UNKNOWN");
    expect(effective.getAttribute("data-gate-state")).toBe("unknown");
  });

  it("writes an autonomy level through the next-step door and shows coord's answer", async () => {
    routes.nextStep = () => ({
      body: nextStepBody({ red_main_fix: { autonomy_level: "guidance_only", effective_state: "not_effective" } }),
    });
    routes.putNextStep = () => ({
      body: nextStepBody({ red_main_fix: { autonomy_level: "auto_decide" } }),
    });
    await renderPage();
    await openPath("red_main_fix_dispatch");
    await click(screen.getByTestId("coord-spawns-path-autonomy-red_main_fix-auto_decide"));
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.url).toBe("/api/v1/operations/coord/next-step-settings");
    expect(put?.body).toEqual({
      domains: [{ decision_domain: "red_main_fix", autonomy_level: "auto_decide" }],
    });
    const g = gate("autonomy:red_main_fix");
    expect(within(g).getByTestId("coord-spawns-gate-effective").getAttribute("data-gate-state")).toBe(
      "auto_decide"
    );
    expect(
      within(g).getByTestId("coord-spawns-gate-effective-readback").getAttribute("data-readback")
    ).toBe("matches");
  });

  it("writes the PR fixer dial through the merge-settings door and shows coord's answer", async () => {
    routes.patchMerge = () => ({
      body: mergeSettingsBody({ tenant: false, resolved: false, source: "tenant" }),
    });
    await renderPage();
    await openPath("pr_fix_dispatch");
    await click(screen.getByTestId("coord-spawns-path-fixer-dial-off"));
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.url).toBe("/api/v1/operations/pr-merge/settings");
    expect(patch?.body).toEqual({ auto_fix_pr: false });
    const g = gate("dial:auto_fix_pr");
    expect(within(g).getByTestId("coord-spawns-gate-effective").textContent).toBe("Off");
    expect(
      within(g).getByTestId("coord-spawns-gate-effective-readback").getAttribute("data-readback")
    ).toBe("matches");
  });
});
