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
 *    coord READS BACK for the tenant default it enforces: off, "read back as
 *    asked" — and the operator's own preference, if it disagrees, is a note
 *    beside it, not a contradiction.
 * 3. **A read-back that disagrees is shown as one**, never smoothed over; a
 *    refused write keeps coord's value and says so; a write whose read-back
 *    failed is UNKNOWN.
 * 4. **The other doors** — `PUT /coord/next-step-settings`, and `PATCH
 *    /pr-merge/settings` for the PR fixer dial and the red-main knob — each
 *    show coord's answer or re-read, compared with the ask. A dial write coord
 *    refuses says so with no read-back; one it could not confirm is UNKNOWN
 *    until the re-read answers, and then that read is compared.
 * 5. **A registry or next-step write that timed out is not a refusal** — the
 *    backend's 504 and the client's own timeout read UNKNOWN until a re-read
 *    answers, and that read is compared; a 502 (nothing was sent) is refused.
 * 6. **A level coord only defaults to can be recorded** — the active level of
 *    a `code_fallback` domain stays a live button, and a recorded one does not.
 * 7. **The read-back mark belongs to the read that settled the write** — a
 *    later read that differs is a change since, not a contradiction; a refusal's
 *    note goes with it; a failed read-back is UNKNOWN only until a read answers.
 * 8. **Machines** — aliased by nobody in operator mode (real names), with the
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
/** While set, a GET of a URL containing `match` waits before answering. */
let holdRead: { match: string; until: Promise<void> } | null = null;
/** While set, a write of this method rejects as the client's own timeout does. */
let timeOutMethod: string | null = null;

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      requests.push({
        url,
        method,
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      if (holdRead && method === "GET" && url.includes(holdRead.match)) {
        await holdRead.until;
      }
      if (timeOutMethod === method) {
        throw new Error(`Request timeout - ${method} ${url}`);
      }
      return answerSpawnsRequest(routes, url, init);
    },
  },
}));

import {
  answerSpawnsRequest,
  defaultSpawnsRoutes,
  type SpawnsRoutes,
} from "./__fixtures__/spawnsRoutes";
import { listFx, rowFx } from "./__fixtures__/coordSpawns";
import {
  defaultsBody,
  effectiveBody,
  mergeSettingsBody,
  nextStepBody,
} from "./__fixtures__/spawnPaths";
import { OTHER_RUNNER_STARTS } from "./_components/SpawnPathMatrix";
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
    fireEvent.click(
      within(pathRow(key)).getByTestId("coord-spawns-path-toggle")
    );
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
  holdRead = null;
  timeOutMethod = null;
});

/** Hold every GET of `match` until the returned function is called. */
function holdReads(match: string): () => Promise<void> {
  let release: () => void = () => {};
  holdRead = {
    match,
    until: new Promise((r) => {
      release = r;
    }),
  };
  return async () => {
    await act(async () => {
      release();
    });
    holdRead = null;
    await settle();
  };
}

async function refreshPage() {
  await click(screen.getByTestId("coord-spawns-refresh"));
}

function effectiveOf(gateKey: string): HTMLElement {
  return within(gate(gateKey)).getByTestId("coord-spawns-gate-effective");
}

function readBackOf(gateKey: string): HTMLElement | null {
  return within(gate(gateKey)).queryByTestId(
    "coord-spawns-gate-effective-readback"
  );
}

function writeNoteOf(gateKey: string): HTMLElement | null {
  return within(gate(gateKey)).queryByTestId(
    "coord-spawns-gate-effective-write-note"
  );
}

describe("the spawn-path matrix — what coord serves", () => {
  it("draws one line per path with its switch, scope, enforcement, coord's value and the other switches", async () => {
    // A gate continuation that started: the only kind the ledger names here.
    routes.list = () => ({
      body: listFx([
        rowFx({
          origin: "gate_continuation",
          spawned_at: "2026-10-21T11:40:00Z",
        }),
      ]),
    });
    await renderPage();
    // What the matrix lists, counted by kind — person-started and class
    // switches are not counted as paths the system starts on its own.
    const note = screen.getByTestId("coord-spawns-paths-note").textContent;
    // It says what it covers, and limits the refusal to the switches that refuse.
    expect(note).toContain(OTHER_RUNNER_STARTS);
    expect(note).toContain(
      "the coordination service refuses a spawn when the path's agent registry switch or its class switch is off, and every other switch says on its own line whether it is enforced."
    );
    expect(note).not.toContain("own switch or its class switch");
    expect(screen.queryByTestId("coord-spawns-paths-unclassified")).toBeNull();
    expect(screen.getByTestId("coord-spawns-paths-note").textContent).toContain(
      "11 paths the coordination service starts on its own, 1 path a person starts from the console, 2 class switches that each govern many paths at once and 3 paths each machine starts on its own."
    );
    const pr = pathRow("pr_fix_dispatch");
    expect(
      within(pr).getByTestId("coord-spawns-path-switch").textContent
    ).toContain("Agent registry switch");
    expect(
      within(pr).getByTestId("coord-spawns-path-switch").textContent
    ).toContain("and 4 more switches");
    expect(within(pr).getByTestId("coord-spawns-path-scope").textContent).toBe(
      "tenant"
    );
    expect(
      within(pr)
        .getByTestId("coord-spawns-path-enforced")
        .getAttribute("data-enforced")
    ).toBe("enforce");
    expect(
      within(pr).getByTestId("coord-spawns-path-effective").textContent
    ).toBe("On");
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
    // The red-main fixer carries the knob coord checks before consulting it.
    expect(
      within(pathRow("red_main_fix_dispatch"))
        .getAllByTestId("coord-spawns-path-chip")
        .map(
          (c) =>
            `${c.getAttribute("data-gate")}=${c.getAttribute("data-gate-state")}`
        )
    ).toEqual([
      "mirror:standing_continuation=on",
      "knob:auto_fix_red_main=on",
      "autonomy:red_main_fix=auto_decide",
      "flag:red_main_fix=on",
    ]);

    // The post-merge row's enforcement is coord's served rollout mode.
    const pm = pathRow("post_merge_followup");
    expect(
      within(pm)
        .getByTestId("coord-spawns-path-enforced")
        .getAttribute("data-enforced")
    ).toBe("shadow");
    expect(within(pm).getByTestId("coord-spawns-path-scope").textContent).toBe(
      "repo"
    );

    // Runner paths: runner-only, device-scoped, UNKNOWN here by construction.
    const st = pathRow("runner_stewards");
    expect(
      within(st)
        .getByTestId("coord-spawns-path-enforced")
        .getAttribute("data-enforced")
    ).toBe("runner-only");
    expect(
      within(st)
        .getByTestId("coord-spawns-path-effective")
        .getAttribute("data-gate-state")
    ).toBe("unknown");

    // Last spawned: the gate-continuation origin names its path, and a start
    // found in the window's requests is a lower bound, said as one.
    const last = within(pathRow("gate_continuation")).getByTestId(
      "coord-spawns-path-last"
    );
    expect(last.getAttribute("data-last-spawned")).toBe("spawned");
    expect(last.textContent).toMatch(/^started .+ or more recently$/);
    expect(last.getAttribute("title")).toContain(
      "may have started more recently"
    );
    expect(
      within(pathRow("runner_scheduler")).getByTestId("coord-spawns-path-last")
        .textContent
    ).toBe("no request in the last 7 days");
    expect(
      within(pr)
        .getByTestId("coord-spawns-path-last")
        .getAttribute("data-last-spawned")
    ).toBe("unknown");
  });

  it("says where a read-only switch is set, and offers no control for it", async () => {
    await renderPage();
    await openPath("next_step_dispatch");
    const flag = gate("flag:next_step");
    expect(flag.textContent).toContain("COORD_NEXT_STEP_AUTODISPATCH_ENABLED");
    expect(
      within(flag).getByTestId("coord-spawns-gate-readonly").textContent
    ).toContain("deployment environment");
    expect(within(flag).queryByRole("button")).toBeNull();
    await openPath("account_migration");
    const runner = gate("runner:account_migration");
    expect(runner.textContent).toContain(
      "claude_cli.auto_migrate_on_token_exhaustion"
    );
    expect(within(runner).queryByRole("button")).toBeNull();
  });

  it("links the operator to where a per-repository switch is set", async () => {
    await renderPage();
    await openPath("post_merge_followup");
    const link = screen.getByTestId(
      "coord-spawns-path-set-on-post_merge_followup"
    );
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/admin/coord/agent-registry");
    expect(
      within(gate("scope:post_merge_followup")).queryByRole("button")
    ).toBeNull();
  });

  it("states the in-flight UNKNOWN once for the machine list, and names machines for the operator", async () => {
    await renderPage();
    expect(
      screen.getByTestId("coord-spawns-inflight-note").textContent
    ).toContain("/coord/agent-fixer-arm-readiness");
    const names = screen
      .getAllByTestId("coord-spawns-machine-name")
      .map((n) => n.textContent);
    expect(names).toEqual(["msi-wsl", "spaceship"]);
    const [a, b] = screen.getAllByTestId("coord-spawns-machine");
    expect(
      within(a!).getByTestId("coord-spawns-machine-sessions").textContent
    ).toBe("3 open now");
    expect(
      within(b!).getByTestId("coord-spawns-machine-drain").textContent
    ).toMatch(/^out of service/);
    expect(
      within(b!).getByTestId("coord-spawns-machine-inflight").textContent
    ).toBe("UNKNOWN");
  });
});

describe("the spawn-path matrix — writes show coord's read-back", () => {
  it("switches a tenant row off through the registry door, and shows the tenant default reading off", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    // From here on coord's registry reads the tenant default off.
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );

    const put = requests.find((r) => r.method === "PUT");
    expect(put?.url).toBe(
      "/api/v1/agent-registry/admin/registry/merge_shepherd"
    );
    expect(put?.body).toEqual({ default_enabled: false });
    // The read-back is a read made AFTER the write.
    const putAt = requests.indexOf(put!);
    expect(
      requests
        .slice(putAt + 1)
        .some((r) => r.url === "/api/v1/agent-registry/admin/registry")
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
      within(pathRow("merge_shepherd")).getByTestId(
        "coord-spawns-path-effective"
      ).textContent
    ).toBe("Off");
  });

  it("shows a read-back that disagrees with the request as a contradiction", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    // The PUT answers 2xx, and coord's re-read still holds the default on.
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    const effective = within(gate("registry:merge_shepherd")).getByTestId(
      "coord-spawns-gate-effective"
    );
    expect(effective.textContent).toBe("On");
    expect(effective.getAttribute("data-gate-tone")).toBe("contradiction");
    expect(
      within(gate("registry:merge_shepherd")).getByTestId(
        "coord-spawns-gate-effective-readback"
      ).textContent
    ).toBe("you asked for off; coord reads back otherwise");
  });

  it("keeps a correct write green when the operator's own preference disagrees, and shows the preference beside it", async () => {
    routes.effective = () => ({
      body: effectiveBody({
        merge_shepherd: { enabled: true, source: "user_pref" },
      }),
    });
    await renderPage();
    await openPath("merge_shepherd");
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    const g = gate("registry:merge_shepherd");
    const effective = within(g).getByTestId("coord-spawns-gate-effective");
    expect(effective.textContent).toBe("Off");
    expect(effective.getAttribute("data-gate-tone")).toBe("known");
    expect(
      within(g)
        .getByTestId("coord-spawns-gate-effective-readback")
        .getAttribute("data-readback")
    ).toBe("matches");
    expect(
      within(g).getByTestId("coord-spawns-gate-preference").textContent
    ).toBe("Your preference: on");
    expect(
      within(pathRow("merge_shepherd")).getByTestId(
        "coord-spawns-path-preference"
      ).textContent
    ).toBe("Your preference: on");
  });

  it("keeps coord's value and says the write was refused", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.putRegistry = () => ({
      status: 403,
      body: { error: "FORBIDDEN", message: "not_coord_tenant_admin" },
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    const g = gate("registry:merge_shepherd");
    expect(
      within(g).getByTestId("coord-spawns-gate-effective").textContent
    ).toBe("On");
    expect(
      within(g).getByTestId("coord-spawns-gate-effective-write-note")
        .textContent
    ).toContain("was refused");
  });

  it("reads a write whose read-back failed as UNKNOWN, never as the value asked for", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.defaults = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    const effective = within(gate("registry:merge_shepherd")).getByTestId(
      "coord-spawns-gate-effective"
    );
    expect(effective.textContent).toBe("UNKNOWN");
    expect(effective.getAttribute("data-gate-state")).toBe("unknown");
  });

  it("writes an autonomy level through the next-step door and shows coord's answer", async () => {
    routes.nextStep = () => ({
      body: nextStepBody({
        red_main_fix: {
          autonomy_level: "guidance_only",
          effective_state: "not_effective",
        },
      }),
    });
    routes.putNextStep = () => ({
      body: nextStepBody({ red_main_fix: { autonomy_level: "auto_decide" } }),
    });
    await renderPage();
    await openPath("red_main_fix_dispatch");
    await click(
      screen.getByTestId("coord-spawns-path-autonomy-red_main_fix-auto_decide")
    );
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.url).toBe("/api/v1/operations/coord/next-step-settings");
    expect(put?.body).toEqual({
      domains: [
        { decision_domain: "red_main_fix", autonomy_level: "auto_decide" },
      ],
    });
    const g = gate("autonomy:red_main_fix");
    expect(
      within(g)
        .getByTestId("coord-spawns-gate-effective")
        .getAttribute("data-gate-state")
    ).toBe("auto_decide");
    expect(
      within(g)
        .getByTestId("coord-spawns-gate-effective-readback")
        .getAttribute("data-readback")
    ).toBe("matches");
  });

  it("says a refused dial write was refused, with no read-back it never had", async () => {
    await renderPage();
    await openPath("pr_fix_dispatch");
    routes.patchMerge = () => ({
      status: 403,
      body: { error: "FORBIDDEN", message: "not_coord_tenant_admin" },
    });
    const readsBefore = requests.filter(
      (r) => r.method === "GET" && r.url.includes("/pr-merge/settings")
    ).length;
    await click(screen.getByTestId("coord-spawns-path-fixer-dial-off"));
    const g = gate("dial:auto_fix_pr");
    const effective = within(g).getByTestId("coord-spawns-gate-effective");
    // Coord's value stands, in its own tone — not a contradiction.
    expect(effective.textContent).toBe("On");
    expect(effective.getAttribute("data-gate-tone")).toBe("known");
    expect(
      within(g).queryByTestId("coord-spawns-gate-effective-readback")
    ).toBeNull();
    expect(
      within(g).getByTestId("coord-spawns-gate-effective-write-note")
        .textContent
    ).toContain("was refused");
    // A clean refusal re-reads nothing.
    expect(
      requests.filter(
        (r) => r.method === "GET" && r.url.includes("/pr-merge/settings")
      )
    ).toHaveLength(readsBefore);
  });

  it("reads a dial write coord could not confirm as UNKNOWN until its re-read answers, then compares that read", async () => {
    await renderPage();
    await openPath("pr_fix_dispatch");
    routes.patchMerge = () => ({
      status: 503,
      body: {
        error: "auto_fix_pr_column_unavailable",
        cause: "commit_unconfirmed",
        written: null,
      },
    });
    const release = holdReads("/pr-merge/settings");
    routes.merge = () => ({
      body: mergeSettingsBody({
        tenant: false,
        resolved: false,
        source: "tenant",
      }),
    });
    await click(screen.getByTestId("coord-spawns-path-fixer-dial-off"));
    const pending = within(gate("dial:auto_fix_pr")).getByTestId(
      "coord-spawns-gate-effective"
    );
    expect(pending.textContent).toBe("UNKNOWN");
    expect(pending.getAttribute("data-gate-state")).toBe("unknown");
    expect(
      within(gate("dial:auto_fix_pr")).queryByTestId(
        "coord-spawns-gate-effective-readback"
      )
    ).toBeNull();
    expect(
      within(gate("dial:auto_fix_pr")).getByTestId(
        "coord-spawns-gate-effective-write-note"
      ).textContent
    ).toContain("Outcome unknown");
    // The switch is busy until the read-back lands: no second write races it.
    for (const choice of ["default", "on"]) {
      expect(
        screen
          .getByTestId(`coord-spawns-path-fixer-dial-${choice}`)
          .getAttribute("aria-disabled")
      ).toBe("true");
    }

    await release();
    expect(
      screen
        .getByTestId("coord-spawns-path-fixer-dial-on")
        .getAttribute("aria-disabled")
    ).toBeNull();
    const g = gate("dial:auto_fix_pr");
    expect(
      within(g).getByTestId("coord-spawns-gate-effective").textContent
    ).toBe("Off");
    expect(
      within(g)
        .getByTestId("coord-spawns-gate-effective-readback")
        .getAttribute("data-readback")
    ).toBe("matches");
    expect(
      within(g).getByTestId("coord-spawns-gate-effective-write-note")
        .textContent
    ).toContain("could not confirm the write itself");
  });

  it("writes the red-main knob through the merge-settings door alone and shows the re-read", async () => {
    await renderPage();
    await openPath("red_main_fix_dispatch");
    routes.merge = () => ({
      body: mergeSettingsBody(undefined, { auto_fix_red_main: false }),
    });
    await click(screen.getByTestId("coord-spawns-path-red-main-knob-off"));
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.url).toBe("/api/v1/operations/pr-merge/settings");
    expect(patch?.body).toEqual({ auto_fix_red_main: false });
    const patchAt = requests.indexOf(patch!);
    expect(
      requests
        .slice(patchAt + 1)
        .some((r) => r.method === "GET" && r.url.includes("/pr-merge/settings"))
    ).toBe(true);
    const g = gate("knob:auto_fix_red_main");
    expect(
      within(g).getByTestId("coord-spawns-gate-effective").textContent
    ).toBe("Off");
    expect(
      within(g)
        .getByTestId("coord-spawns-gate-effective-readback")
        .getAttribute("data-readback")
    ).toBe("matches");
  });

  it("shows a red-main knob write the re-read contradicts as a contradiction", async () => {
    await renderPage();
    await openPath("red_main_fix_dispatch");
    // The PATCH answers 2xx; coord's re-read still holds the knob on.
    await click(screen.getByTestId("coord-spawns-path-red-main-knob-off"));
    const g = gate("knob:auto_fix_red_main");
    const effective = within(g).getByTestId("coord-spawns-gate-effective");
    expect(effective.textContent).toBe("On");
    expect(effective.getAttribute("data-gate-tone")).toBe("contradiction");
  });

  it("writes the PR fixer dial through the merge-settings door and shows coord's answer", async () => {
    routes.patchMerge = () => ({
      body: mergeSettingsBody({
        tenant: false,
        resolved: false,
        source: "tenant",
      }),
    });
    await renderPage();
    await openPath("pr_fix_dispatch");
    await click(screen.getByTestId("coord-spawns-path-fixer-dial-off"));
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.url).toBe("/api/v1/operations/pr-merge/settings");
    expect(patch?.body).toEqual({ auto_fix_pr: false });
    const g = gate("dial:auto_fix_pr");
    expect(
      within(g).getByTestId("coord-spawns-gate-effective").textContent
    ).toBe("Off");
    expect(
      within(g)
        .getByTestId("coord-spawns-gate-effective-readback")
        .getAttribute("data-readback")
    ).toBe("matches");
  });
});

describe("a registry or next-step write that timed out is not a refusal", () => {
  it("reads a registry PUT 504 as UNKNOWN until its re-read answers, then compares that read", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.putRegistry = () => ({
      status: 504,
      body: { detail: "timeout waiting for coord" },
    });
    // The write landed: only a re-read can tell.
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    const release = holdReads("/agent-registry/admin/registry");
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("UNKNOWN");
    expect(writeNoteOf("registry:merge_shepherd")?.textContent).toContain(
      "Outcome unknown"
    );
    expect(readBackOf("registry:merge_shepherd")).toBeNull();

    await release();
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("Off");
    expect(readBackOf("registry:merge_shepherd")?.dataset.readback).toBe(
      "matches"
    );
    expect(writeNoteOf("registry:merge_shepherd")?.textContent).toContain(
      "could not confirm the write itself"
    );
  });

  it("compares a timed-out registry write with a re-read that says it did not land", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.putRegistry = () => ({
      status: 504,
      body: { detail: "timeout waiting for coord" },
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("On");
    expect(effectiveOf("registry:merge_shepherd").dataset.gateTone).toBe(
      "contradiction"
    );
    expect(writeNoteOf("registry:merge_shepherd")?.textContent).not.toContain(
      "was refused"
    );
  });

  it("reads a next-step PUT 504 as UNKNOWN until its re-read answers, then compares that read", async () => {
    await renderPage();
    await openPath("red_main_fix_dispatch");
    routes.putNextStep = () => ({
      status: 504,
      body: { detail: "timeout waiting for coord" },
    });
    routes.nextStep = () => ({
      body: nextStepBody({ red_main_fix: { autonomy_level: "guidance_only" } }),
    });
    const release = holdReads("/coord/next-step-settings");
    await click(
      screen.getByTestId(
        "coord-spawns-path-autonomy-red_main_fix-guidance_only"
      )
    );
    expect(effectiveOf("autonomy:red_main_fix").textContent).toBe("UNKNOWN");
    expect(writeNoteOf("autonomy:red_main_fix")?.textContent).toContain(
      "Outcome unknown"
    );

    await release();
    expect(effectiveOf("autonomy:red_main_fix").dataset.gateState).toBe(
      "guidance_only"
    );
    expect(readBackOf("autonomy:red_main_fix")?.dataset.readback).toBe(
      "matches"
    );
  });

  it("reads the client's own timeout on a registry PUT as unconfirmed, and re-reads", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    timeOutMethod = "PUT";
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("Off");
    expect(writeNoteOf("registry:merge_shepherd")?.textContent).toContain(
      "could not confirm the write itself"
    );
  });

  it("stays a refusal when nothing was sent (502)", async () => {
    await renderPage();
    await openPath("red_main_fix_dispatch");
    routes.putNextStep = () => ({
      status: 502,
      body: { detail: "coord is not reachable" },
    });
    await click(
      screen.getByTestId(
        "coord-spawns-path-autonomy-red_main_fix-guidance_only"
      )
    );
    expect(writeNoteOf("autonomy:red_main_fix")?.textContent).toContain(
      "was refused"
    );
    expect(readBackOf("autonomy:red_main_fix")).toBeNull();
  });
});

describe("the autonomy control records a level coord only defaults to", () => {
  const fallback = () =>
    nextStepBody({
      red_main_fix: {
        autonomy_level: "guidance_only",
        autonomy_level_source: "code_fallback",
        effective_state: "not_effective",
      },
    });

  it("keeps the built-in level's button live, says what it does, and sends the PUT", async () => {
    routes.nextStep = () => ({ body: fallback() });
    routes.putNextStep = () => ({
      body: nextStepBody({
        red_main_fix: {
          autonomy_level: "guidance_only",
          autonomy_level_source: "policy_row",
          effective_state: "not_effective",
        },
      }),
    });
    await renderPage();
    await openPath("red_main_fix_dispatch");
    const button = screen.getByTestId(
      "coord-spawns-path-autonomy-red_main_fix-guidance_only"
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.textContent).toBe(
      "Guidance only (built-in default; choose to record it)"
    );

    await click(button);
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.body).toEqual({
      domains: [
        { decision_domain: "red_main_fix", autonomy_level: "guidance_only" },
      ],
    });
    expect(readBackOf("autonomy:red_main_fix")?.dataset.readback).toBe(
      "matches"
    );
    // Now a policy row holds it, so choosing it again would write nothing.
    const recorded = screen.getByTestId(
      "coord-spawns-path-autonomy-red_main_fix-guidance_only"
    ) as HTMLButtonElement;
    expect(recorded.disabled).toBe(true);
    expect(recorded.textContent).toBe("Guidance only");
  });

  it("does not offer a level a policy row already holds", async () => {
    await renderPage();
    await openPath("red_main_fix_dispatch");
    const button = screen.getByTestId(
      "coord-spawns-path-autonomy-red_main_fix-auto_decide"
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    await click(button);
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });
});

describe("the read-back mark belongs to the read that settled the write", () => {
  async function writeOffThatReadsBack() {
    await renderPage();
    await openPath("merge_shepherd");
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    expect(readBackOf("registry:merge_shepherd")?.dataset.readback).toBe(
      "matches"
    );
  }

  it("keeps the mark while later reads give the same value", async () => {
    await writeOffThatReadsBack();
    await refreshPage();
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("Off");
    expect(readBackOf("registry:merge_shepherd")?.dataset.readback).toBe(
      "matches"
    );
  });

  it("says a later change is a change since, never that coord reads the write back otherwise", async () => {
    await writeOffThatReadsBack();
    // Someone switches the default back on elsewhere.
    routes.defaults = () => ({ body: defaultsBody() });
    await refreshPage();
    const effective = effectiveOf("registry:merge_shepherd");
    expect(effective.textContent).toBe("On");
    expect(effective.dataset.gateTone).toBe("known");
    expect(readBackOf("registry:merge_shepherd")).toBeNull();
    expect(writeNoteOf("registry:merge_shepherd")?.textContent).toBe(
      "Changed since your write: coord read back off after it, and a later read differs."
    );
  });

  it("keeps a contradiction red while coord still reads the value that contradicted it", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    await refreshPage();
    expect(effectiveOf("registry:merge_shepherd").dataset.gateTone).toBe(
      "contradiction"
    );
  });

  it("drops a refusal's note once the value has moved, and keeps it until then", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.putRegistry = () => ({
      status: 403,
      body: { detail: "not_coord_tenant_admin" },
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    await refreshPage();
    expect(writeNoteOf("registry:merge_shepherd")?.textContent).toContain(
      "was refused"
    );
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    await refreshPage();
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("Off");
    expect(writeNoteOf("registry:merge_shepherd")).toBeNull();
  });

  it("marks a dial and a knob write's later change the same way", async () => {
    await renderPage();
    await openPath("red_main_fix_dispatch");
    routes.merge = () => ({
      body: mergeSettingsBody(undefined, { auto_fix_red_main: false }),
    });
    await click(screen.getByTestId("coord-spawns-path-red-main-knob-off"));
    expect(readBackOf("knob:auto_fix_red_main")?.dataset.readback).toBe(
      "matches"
    );
    routes.merge = () => ({
      body: mergeSettingsBody(undefined, { auto_fix_red_main: true }),
    });
    await refreshPage();
    expect(effectiveOf("knob:auto_fix_red_main").dataset.gateTone).toBe(
      "known"
    );
    expect(readBackOf("knob:auto_fix_red_main")).toBeNull();
    expect(writeNoteOf("knob:auto_fix_red_main")?.textContent).toContain(
      "Changed since your write"
    );
  });

  it("is UNKNOWN after a failed read-back only until a read answers, which is then compared", async () => {
    await renderPage();
    await openPath("merge_shepherd");
    routes.defaults = () => ({
      status: 502,
      body: { detail: "coord unreachable" },
    });
    await click(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd-off")
    );
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("UNKNOWN");
    routes.defaults = () => ({
      body: defaultsBody({ merge_shepherd: { default_enabled: false } }),
    });
    await refreshPage();
    expect(effectiveOf("registry:merge_shepherd").textContent).toBe("Off");
    expect(readBackOf("registry:merge_shepherd")?.dataset.readback).toBe(
      "matches"
    );
  });
});
