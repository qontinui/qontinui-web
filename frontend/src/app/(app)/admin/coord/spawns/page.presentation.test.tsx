/**
 * /admin/coord/spawns in presentation mode — plan
 * `2026-10-23-console-presentation-spaces` Phase 4, and the proof
 * `PRESENTATION_READY_ROUTES` names for this route.
 *
 * It renders the real page through the presentation helper
 * (`renderInPresentationMode`: the real UI Bridge provider, a fixed presenting
 * lens, a ready redaction scope) over fixtures that feed every carrier the
 * page can show an identity or a free sentence through — hostnames, device
 * ids, a Claude account, a source ref, a terminal reason and an event reason
 * naming a client, a drain's reason and actor, a failed read's URL — and
 * asserts:
 *
 *  1. `expectPresentationSafe` — no enabled write control, no write or
 *     undeclared UI Bridge action, no cost, every section's caption, no
 *     identifier and none of the fixture's names — on the loaded page and
 *     behind every disclosure (each spawn path's switches; the per-request
 *     list is the operator's investigation view, so no request row is
 *     presented), and no device id in any attribute;
 *  2. no write control is mounted (the switches) and the launcher link is
 *     gone, while the session-load link stays text (its page is not
 *     presentable), and machines read as their alias; where a switch's
 *     control would be, every gate's Note says why there is none;
 *  3. a failed read still says UNKNOWN, in fixed words; a path reads the
 *     tenant default coord enforces, never the presenter's own preference;
 *     and no presented word on the whole page — text, `title` or `aria-label`,
 *     across the empty, failed, stale and unusual arms — calls the service
 *     "coord" (provenance chips name their source, as on every lens page);
 *  4. the operator console is unchanged: the same fixtures in operator mode
 *     show the real names, the controls and the launcher — so their absence
 *     above is the lens's doing, not an empty render;
 *  5. the route is registered presentation-ready.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  expectPresentationSafe,
  renderInPresentationMode,
  type PresentationView,
} from "@/test/presentation";

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

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: async (url: string, init?: RequestInit) =>
      answerSpawnsRequest(routes, url, init),
  },
}));

import {
  answerSpawnsRequest,
  defaultSpawnsRoutes,
  type SpawnsRoutes,
} from "./__fixtures__/spawnsRoutes";
import {
  DEVICE_A,
  DEVICE_B,
  detailFx,
  eventFx,
  listFx,
  rowFx,
  statsFx,
} from "./__fixtures__/coordSpawns";
import {
  concurrencyBody,
  drainBody,
  effectiveBody,
  effectiveFx,
} from "./__fixtures__/spawnPaths";
import {
  isPresentationReady,
  sessionMachineAliases,
  type CaptionKey,
} from "@/components/presentation";
import {
  CONTROL_PRESENTED_NOTE,
  OTHER_RUNNER_STARTS,
} from "./_components/SpawnPathMatrix";
import CoordSpawnsPage from "./page";

/** Every caption the page carries. */
const CAPTIONS: CaptionKey[] = [
  "agentic-activity.page",
  "agentic-activity.spawn-paths",
  "agentic-activity.machines",
  "agentic-activity.placement",
  "agentic-activity.requests",
  "agentic-activity.rate",
];

const SCOPE = {
  status: "ready" as const,
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

const HOST_A = "build-host-alpha";
const HOST_B = "build-host-beta";
const ACCOUNT = "partner-a-account";
const SOURCE_REF = "acme-corp/secret-repo#12";
const TERMINAL_REASON = "Acme Corp PR acme-corp/secret-repo#12 superseded it";
const EVENT_REASON = `refused by ${HOST_A}: Acme Corp quota`;
const DRAIN_REASON = "rebuild for Acme Corp";
const FAILED_URL = "http://10.0.0.5:8080/coord";

/** What an outsider must not read anywhere — text or attributes. */
const FORBIDDEN = [
  HOST_A,
  HOST_B,
  ACCOUNT,
  SOURCE_REF,
  "Acme Corp",
  "acme/widgets",
  "operator@example.com",
  DRAIN_REASON,
  "10.0.0.5",
  // Registry names, variables, settings keys and files: the operator's vocabulary.
  "pr_fix_dispatch",
  "merge_shepherd",
  "COORD_",
  "claude_cli",
  "auto_fix",
  "rulebook",
  ".qontinui",
  // A member's own preference is never a path's state in front of an audience.
  "Your preference",
];

/** A request row that carries every free-text field the row and its detail show. */
const SUPERSEDED = rowFx({
  class: "continuation_heavy",
  state: "superseded",
  spawned_at: null,
  session_outcome: null,
  wait_seconds: null,
  terminal_reason: TERMINAL_REASON,
  source_ref: SOURCE_REF,
  claude_account: ACCOUNT,
  pinned_device_id: DEVICE_B,
});
const STARTED = rowFx({
  origin: "gate_continuation",
  claude_account: ACCOUNT,
  source_ref: SOURCE_REF,
});

function presentationRoutes(): SpawnsRoutes {
  const r = defaultSpawnsRoutes();
  r.fleet = () => ({
    body: {
      devices: [
        { device_id: DEVICE_A, hostname: HOST_A, state: "healthy" },
        { device_id: DEVICE_B, hostname: HOST_B, state: "healthy" },
      ],
    },
  });
  r.roles = () => ({
    body: {
      state: "known",
      machines: [
        {
          device_id: DEVICE_A,
          name: HOST_A,
          role: { dispatch_role: "workhorse" },
          registration: "registered",
        },
        {
          device_id: DEVICE_B,
          name: HOST_B,
          role: { dispatch_role: "bench" },
          registration: "registered",
        },
      ],
    },
  });
  r.stats = () => ({ body: statsFx() });
  r.list = () => ({ body: listFx([STARTED, SUPERSEDED]) });
  r.pending = () => ({ body: listFx([]) });
  r.detail = (id) => ({
    body: detailFx(id === STARTED.id ? STARTED : SUPERSEDED, [
      eventFx({ kind: "requested" }),
      eventFx({ kind: "refused", device_id: DEVICE_A, reason: EVENT_REASON }),
      eventFx({ kind: "placed", device_id: DEVICE_B }),
    ]),
  });
  r.drain = () => ({ body: drainBody(Date.now(), DRAIN_REASON) });
  // A preference row: the operator-mode words would name it.
  r.effective = () => ({
    body: effectiveBody({
      next_step_dispatch: { enabled: false, source: "user_pref" },
    }),
  });
  // A failed read whose own text quotes a URL.
  r.concurrency = () => ({
    status: 502,
    body: { detail: `coord unreachable at ${FAILED_URL}` },
  });
  return r;
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 15; i += 1)
      await new Promise((res) => setTimeout(res, 0));
  });
}

/**
 * Open every disclosure the page holds, one at a time, and check the whole
 * render after each — what one click shows is in front of the audience too.
 */
async function checkBehindEveryDisclosure(view: PresentationView) {
  const toggles = () => screen.getAllByTestId("coord-spawns-path-toggle");
  const pathCount = toggles().length;
  expect(pathCount).toBeGreaterThan(15);
  for (let i = 0; i < pathCount; i += 1) {
    await act(async () => {
      fireEvent.click(toggles()[i]!);
    });
    await settle();
    expect(screen.getAllByTestId("coord-spawns-gate").length).toBeGreaterThan(
      0
    );
    expectPresentationSafe(view, { captions: CAPTIONS, forbidden: FORBIDDEN });
  }
  // The per-request list is the investigation view's, an operator page the
  // lens withholds: no request row, and so no request detail, is presented.
  expect(screen.queryAllByTestId("coord-spawn-row")).toHaveLength(0);
}

/** Every attribute value and the text of the whole page — what the DOM carries. */
function everythingInTheDom(): string {
  const all = [...document.body.querySelectorAll("*")].flatMap((el) =>
    [...el.attributes].map((a) => a.value)
  );
  return [document.body.textContent ?? "", ...all].join("\n");
}

/**
 * A section's presented words — its text and every `title` — without its
 * provenance chips, which name their source ("coord agent registry") on
 * every lens page by design.
 */
function presentedWords(testId: string): string {
  const section = screen.getByTestId(testId).cloneNode(true) as HTMLElement;
  for (const chip of section.querySelectorAll("[data-provenance]"))
    chip.remove();
  const titles = [...section.querySelectorAll("[title]")].map(
    (el) => el.getAttribute("title") ?? ""
  );
  return [section.textContent ?? "", ...titles].join("\n");
}

/** What the audience reads on the whole page, chips aside. */
function pageWords(): string {
  const page = document.body.cloneNode(true) as HTMLElement;
  for (const chip of page.querySelectorAll("[data-provenance]")) chip.remove();
  const attrs = [...page.querySelectorAll("[title], [aria-label]")].flatMap(
    (el) => [
      el.getAttribute("title") ?? "",
      el.getAttribute("aria-label") ?? "",
    ]
  );
  return [page.textContent ?? "", ...attrs].join("\n");
}

function expectNoServiceToken() {
  expect(pageWords()).not.toMatch(/\bcoord\b/i);
}

async function openEverything() {
  const toggles = () => screen.getAllByTestId("coord-spawns-path-toggle");
  for (let i = 0; i < toggles().length; i += 1) {
    await act(async () => {
      fireEvent.click(toggles()[i]!);
    });
  }
  const rows = () => screen.queryAllByTestId("coord-spawn-row");
  for (let i = 0; i < rows().length; i += 1) {
    await act(async () => {
      fireEvent.click(within(rows()[i]!).getAllByRole("button")[0]!);
    });
  }
  await settle();
}

/** Every state with nothing recorded about why, on an unassigned device. */
function unusualRows() {
  const bare = {
    spawned_at: null,
    session_outcome: null,
    session_outcome_at: null,
    wait_seconds: null,
    terminal_reason: null,
    claude_code_session_id: null,
    claude_account: null,
    current_device_id: null,
    spawned_device_id: null,
    origin: "coord_dispatch",
  } as const;
  // The fixture's request times are days old, which reads as stuck; these
  // reach the sentences of a request that is still in time.
  const justNow = {
    requested_at: new Date(Date.now() - 60_000).toISOString(),
    updated_at: new Date(Date.now() - 30_000).toISOString(),
  };
  return [
    rowFx({ ...bare, ...justNow, state: "queued", first_dispatched_at: null }),
    rowFx({ ...bare, ...justNow, state: "dispatched" }),
    rowFx({ ...bare, ...justNow, state: "deferred", deferrals: 1 }),
    rowFx({ ...bare, state: "queued", first_dispatched_at: null }),
    rowFx({ ...bare, state: "queued", requested_at: "not-a-date" }),
    rowFx({ ...bare, state: "dispatched", deferrals: 0 }),
    rowFx({ ...bare, state: "deferred", deferrals: 2 }),
    rowFx({ ...bare, state: "failed" }),
    rowFx({ ...bare, state: "expired" }),
    rowFx({ ...bare, state: "cancelled" }),
    rowFx({ ...bare, state: "superseded" }),
    rowFx({ ...bare, state: "held_by_a_new_build" }),
    rowFx({
      state: "spawned",
      origin: "coord_dispatch",
      session_outcome: "unknown",
    }),
    rowFx({
      state: "spawned",
      origin: "coord_dispatch",
      session_outcome: "reaped_by_a_new_build",
    }),
  ];
}

beforeEach(() => {
  routes = presentationRoutes();
  sessionMachineAliases.reset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("/admin/coord/spawns?present=1", () => {
  it("is safe to show an outsider, behind every disclosure: no write control, no cost, no identity, every caption", async () => {
    const view = renderInPresentationMode(<CoordSpawnsPage />, {
      scope: SCOPE,
    });
    await settle();
    // The page rendered its data: the matrix, the machines, the requests.
    expect(
      screen.getAllByTestId("coord-spawns-path-row").length
    ).toBeGreaterThan(15);
    expect(screen.getAllByTestId("coord-spawns-machine")).toHaveLength(2);
    expect(
      screen.getByTestId("coord-spawns-count-all").getAttribute("data-count")
    ).toBe("2");
    expectPresentationSafe(view, { captions: CAPTIONS, forbidden: FORBIDDEN });
    await checkBehindEveryDisclosure(view);
    // No device id reaches the presented DOM, in text or in any attribute
    // (the per-device list it was carried on, as a share key, is gone).
    for (const id of [DEVICE_A, DEVICE_B]) {
      expect(everythingInTheDom()).not.toContain(id);
    }
  });

  it("mounts no switch and no launcher, keeps the session-load link as text, and aliases every machine", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    for (const toggle of screen.getAllByTestId("coord-spawns-path-toggle")) {
      await act(async () => {
        fireEvent.click(toggle);
      });
    }
    await settle();
    expect(
      screen.queryByTestId("coord-spawns-path-switch-merge_shepherd")
    ).toBeNull();
    expect(screen.queryByTestId("coord-spawns-path-fixer-dial")).toBeNull();
    expect(
      document.querySelector('[data-testid^="coord-spawns-path-switch-"]')
    ).toBeNull();
    expect(
      document.querySelector('[data-testid^="coord-spawns-path-autonomy-"]')
    ).toBeNull();
    expect(screen.queryByTestId("coord-spawns-launch-link")).toBeNull();
    expect(
      screen
        .getByTestId("coord-spawns-session-load-link")
        .getAttribute("data-lens-link")
    ).toBe("unlinked");
    const names = screen.getAllByTestId("coord-spawns-machine-name");
    expect(names.map((n) => n.textContent)).toEqual(["Machine A", "Machine B"]);
    for (const n of names)
      expect(n.getAttribute("data-machine-alias")).toBe("true");
    // The investigation view is the operator's: no link into it is mounted.
    expect(screen.queryByTestId("coord-spawns-requests-link")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-placement-link")).toBeNull();
  });

  it("states where a per-repository switch is set as text, with no link into a page it cannot present", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    const postMerge = screen
      .getAllByTestId("coord-spawns-path-row")
      .find((r) => r.getAttribute("data-path") === "post_merge_followup")!;
    await act(async () => {
      fireEvent.click(
        within(postMerge).getByTestId("coord-spawns-path-toggle")
      );
    });
    await settle();
    const setOn = screen.getByTestId(
      "coord-spawns-path-set-on-post_merge_followup"
    );
    expect(setOn.getAttribute("data-lens-link")).toBe("unlinked");
    expect(setOn.tagName).toBe("SPAN");
    expect(
      document.querySelector('a[href*="/admin/coord/agent-registry"]')
    ).toBeNull();
  });

  it("reads a path's tenant default, never the presenter's own preference row", async () => {
    // The fixture's presenter holds a preference row turning next-step OFF;
    // the tenant default — what the coordination service enforces — is on.
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    const nextStep = screen
      .getAllByTestId("coord-spawns-path-row")
      .find((r) => r.getAttribute("data-path") === "next_step_dispatch")!;
    const line = within(nextStep).getByTestId("coord-spawns-path-effective");
    expect(line.textContent).toBe("On");
    expect(line.getAttribute("title")).toBe(
      "Switched on for the whole project."
    );
    expect(
      within(nextStep).queryByTestId("coord-spawns-path-preference")
    ).toBeNull();
  });

  it("says, in every gate's Note, why there is no control — and never calls the service 'coord' in a sentence", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    const toggles = () => screen.getAllByTestId("coord-spawns-path-toggle");
    for (let i = 0; i < toggles().length; i += 1) {
      await act(async () => {
        fireEvent.click(toggles()[i]!);
      });
      await settle();
      for (const g of screen.getAllByTestId("coord-spawns-gate")) {
        const cells = g.querySelectorAll("td");
        const note = (cells[cells.length - 1]!.textContent ?? "").trim();
        expect(note, g.getAttribute("data-gate") ?? "").not.toBe("");
      }
      expect(presentedWords("coord-spawns-paths-section")).not.toMatch(
        /\bcoord\b/i
      );
    }
    expect(presentedWords("coord-spawns-machines-section")).not.toMatch(
      /\bcoord\b/i
    );

    // A writable switch's Note is the fixed sentence where its control would be.
    const shepherd = screen
      .getAllByTestId("coord-spawns-path-row")
      .find((r) => r.getAttribute("data-path") === "merge_shepherd")!;
    await act(async () => {
      fireEvent.click(within(shepherd).getByTestId("coord-spawns-path-toggle"));
    });
    await settle();
    const gate = screen
      .getAllByTestId("coord-spawns-gate")
      .find((g) => g.getAttribute("data-gate") === "registry:merge_shepherd")!;
    expect(
      within(gate).getByTestId("coord-spawns-gate-presented-note").textContent
    ).toBe(CONTROL_PRESENTED_NOTE);
    expect(within(gate).queryByRole("button")).toBeNull();
  });

  describe("never calls the service 'coord', anywhere on the page", () => {
    it("with a silent machine, one the role read misses, no per-device figures, and rows with nothing recorded, behind every disclosure", async () => {
      const rows = unusualRows();
      routes.roles = () => ({
        body: {
          state: "known",
          machines: [
            {
              device_id: DEVICE_A,
              name: HOST_A,
              role: { dispatch_role: "workhorse" },
              registration: "registered",
            },
          ],
        },
      });
      routes.concurrency = () => ({
        body: concurrencyBody({
          devices: [
            {
              ...concurrencyBody().devices[0]!,
              heartbeat_age_seconds: null,
              open_now: null,
            },
            { ...concurrencyBody().devices[0]!, device_id: DEVICE_B },
          ],
        }),
      });
      routes.stats = () => ({ body: statsFx({}, { per_device: [] }) });
      routes.list = () => ({
        body: listFx([...rows, { id: 1 } as never], {
          truncated: true,
          total: 900,
        }),
      });
      routes.detail = (id) => ({
        body: detailFx(rows.find((r) => r.id === id)!, []),
      });
      renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
      await settle();
      expect(pageWords()).toContain("The role read does not list this machine");
      expect(pageWords()).toContain("This machine has not reported recently");
      expect(pageWords()).toContain("as the session run record counts them");
      expectNoServiceToken();
      await openEverything();
      expectNoServiceToken();
    });

    it("when the role read says its device list was cut short", async () => {
      routes.roles = () => ({
        body: { state: "known", machines: [], roster_truncated: true },
      });
      renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
      await settle();
      expect(pageWords()).toContain("reported its device list as cut short");
      expectNoServiceToken();
    });

    it("with an empty roster and an empty ledger", async () => {
      routes.fleet = () => ({ body: { devices: [] } });
      routes.list = () => ({ body: listFx([]) });
      renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
      await settle();
      expect(pageWords()).toContain("The fleet roster lists no machine.");
      expect(
        screen.getByTestId("coord-spawns-count-all").getAttribute("data-count")
      ).toBe("0");
      expectNoServiceToken();
    });

    it.each([
      [
        "refused",
        {
          status: 403,
          body: { error: "FORBIDDEN", message: "not_coord_tenant_admin" },
        },
        "Project administrators only",
      ],
      [
        "not served",
        { status: 404, body: { error: "no_such_route" } },
        "The spawn ledger is not offered yet",
      ],
      ["failed", { status: 502, body: { detail: "upstream" } }, ""],
    ])("when the ledger read is %s", async (_arm, answer, headline) => {
      routes.stats = () => answer;
      routes.list = () => answer;
      routes.pending = () => answer;
      routes.fleet = () => ({ status: 502, body: { detail: "upstream" } });
      routes.roles = () => ({ status: 502, body: { detail: "upstream" } });
      renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
      await settle();
      expect(screen.getByTestId("coord-spawns-health").textContent).toContain(
        headline
      );
      expect(
        screen.getByTestId("coord-spawns-count-all").getAttribute("data-count")
      ).toBe("unknown");
      expectNoServiceToken();
    });
  });

  it("says a failed roster refresh keeps the last good list, in fixed words", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    expect(screen.queryByTestId("coord-spawns-machines-stale")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-machine-stale")).toBeNull();

    routes.fleet = () => ({
      status: 502,
      body: { detail: `coord unreachable at ${FAILED_URL}` },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-spawns-refresh"));
    });
    await settle();

    expect(screen.getAllByTestId("coord-spawns-machine")).toHaveLength(2);
    const note = screen.getByTestId("coord-spawns-machines-stale").textContent;
    expect(note).toContain("this list is from the last good read");
    expect(note).not.toContain("10.0.0.5");
    expect(note).toContain("reason withheld");
    expect(screen.getAllByTestId("coord-spawns-machine-stale")).toHaveLength(2);
    // The name stays the machine's alias alone: the mark is beside it.
    expect(
      screen
        .getAllByTestId("coord-spawns-machine-name")
        .map((n) => n.textContent)
    ).toEqual(["Machine A", "Machine B"]);
    expectNoServiceToken();

    routes.fleet = presentationRoutes().fleet;
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-spawns-refresh"));
    });
    await settle();
    expect(screen.queryByTestId("coord-spawns-machines-stale")).toBeNull();
  });

  it("tells apart two devices on one host without naming either device", async () => {
    routes.fleet = () => ({
      body: {
        devices: [
          { device_id: DEVICE_A, hostname: HOST_A },
          { device_id: DEVICE_B, hostname: HOST_A },
        ],
      },
    });
    const view = renderInPresentationMode(<CoordSpawnsPage />, {
      scope: SCOPE,
    });
    await settle();
    const lines = screen.getAllByTestId("coord-spawns-machine");
    expect(lines).toHaveLength(2);
    // One computer keeps one letter on every panel; each device line says
    // which of its devices it is.
    expect(
      lines.map((l) => l.textContent?.match(/^Machine [A-Z]+, device \d/)?.[0])
    ).toEqual(["Machine A, device 1", "Machine A, device 2"]);
    const dom = everythingInTheDom();
    for (const id of [DEVICE_A, DEVICE_B]) {
      expect(dom).not.toContain(id);
      expect(dom).not.toContain(id.slice(0, 8));
    }
    expectPresentationSafe(view, { captions: CAPTIONS, forbidden: FORBIDDEN });
  });

  it("names what the matrix leaves out, and lists a row it cannot classify without its name", async () => {
    routes.effective = () => ({
      body: {
        agents: [
          ...effectiveBody().agents,
          effectiveFx("secret_inline_kind", "in_session_subagent"),
        ],
      },
    });
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    const pathsNote = screen.getByTestId("coord-spawns-paths-note").textContent;
    expect(pathsNote).toContain(OTHER_RUNNER_STARTS);
    // Measured: nothing writes these starts to the list this page reads, so the
    // sentence must not send a reader looking for them there. It stops at this
    // page and that list: the Runner Drain page does show a session's origin.
    expect(pathsNote).toContain(
      "those starts have no line on this page, and the list of spawn requests does not record them."
    );
    expect(pathsNote).not.toMatch(/this console reads no record/);
    expect(pathsNote).not.toMatch(/appear under spawn requests/);
    const unclassified = screen.getByTestId(
      "coord-spawns-paths-unclassified"
    ).textContent;
    expect(unclassified).toContain("1 further registry row");
    expect(unclassified).not.toContain("secret_inline_kind");
    // The part alone: a caption's textContent runs its title into this line.
    const oneLiner = (id: string) =>
      document.querySelector(
        `[data-presentation-caption="${id}"] [data-caption-part="one-liner"]`
      )?.textContent;
    expect(oneLiner("agentic-activity.page")).toMatch(/^The paths that start/);
    expect(oneLiner("agentic-activity.spawn-paths")).toMatch(
      /^The paths this console knows of/
    );
  });

  it("still says a failed read is UNKNOWN, in fixed words", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    const sessions = screen.getAllByTestId("coord-spawns-machine-sessions");
    for (const cell of sessions) {
      expect(cell.textContent).toBe("UNKNOWN");
      expect(cell.getAttribute("title")).toBe(
        "How many sessions this machine has open could not be read."
      );
    }
    expect(
      screen.getByTestId("coord-spawns-inflight-note").textContent
    ).toContain("does not offer that figure");
  });

  it("says a failed ledger, stats or role read in fixed words — never the failure's own text", async () => {
    const failing = {
      status: 502,
      body: { detail: `coord unreachable at ${FAILED_URL}` },
    };
    routes.list = () => failing;
    routes.pending = () => failing;
    routes.stats = () => failing;
    routes.roles = () => failing;
    const view = renderInPresentationMode(<CoordSpawnsPage />, {
      scope: SCOPE,
    });
    await settle();
    expect(screen.getByTestId("coord-spawns-unknown-banner").textContent).toBe(
      "The record of spawn requests could not be read, so which spawns were requested is unknown."
    );
    expectPresentationSafe(view, { captions: CAPTIONS, forbidden: FORBIDDEN });
  });

  it("carries every section's caption and the provenance of its reads", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    for (const id of CAPTIONS) {
      expect(
        document.querySelector(`[data-presentation-caption="${id}"]`),
        id
      ).not.toBeNull();
    }
    const paths = screen.getByTestId("coord-spawns-paths-caption");
    expect(paths.querySelectorAll("[data-provenance]").length).toBe(6);
    const machines = screen.getByTestId("coord-spawns-machines-caption");
    expect(machines.querySelectorAll("[data-provenance]").length).toBe(4);
    // The session read failed: its chip says UNKNOWN rather than an age.
    const unknownChips = [
      ...machines.querySelectorAll("[data-provenance]"),
    ].filter((c) => c.getAttribute("data-provenance-known") === "false");
    expect(unknownChips).toHaveLength(1);
  });

  it("is registered presentation-ready", () => {
    expect(isPresentationReady("/admin/coord/spawns")).toBe(true);
  });
});

describe("/admin/coord/spawns for the operator — the same fixtures", () => {
  it("names a registry row it cannot classify, and does not call it a role", async () => {
    routes.effective = () => ({
      body: {
        agents: [
          ...effectiveBody().agents,
          effectiveFx("new_inline_kind", "in_session_subagent"),
        ],
      },
    });
    render(<CoordSpawnsPage />);
    await settle();
    expect(
      screen.getByTestId("coord-spawns-paths-unclassified").textContent
    ).toContain("no line here: new_inline_kind.");
  });

  it("says a failed roster refresh's own failure above the kept list", async () => {
    render(<CoordSpawnsPage />);
    await settle();
    routes.fleet = () => ({
      status: 502,
      body: { detail: `coord unreachable at ${FAILED_URL}` },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("coord-spawns-refresh"));
    });
    await settle();
    expect(screen.getAllByTestId("coord-spawns-machine")).toHaveLength(2);
    expect(
      screen.getByTestId("coord-spawns-machines-stale").textContent
    ).toContain("this list is from the last good read");
    expect(screen.getAllByTestId("coord-spawns-machine-stale")).toHaveLength(2);
  });

  it("gives two devices that share a hostname their short device ids, and only those two", async () => {
    routes.fleet = () => ({
      body: {
        devices: [
          { device_id: DEVICE_A, hostname: HOST_A },
          { device_id: DEVICE_B, hostname: HOST_A },
          {
            device_id: "11111111-2222-4333-8444-555555555555",
            hostname: HOST_B,
          },
        ],
      },
    });
    render(<CoordSpawnsPage />);
    await settle();
    const lines = screen.getAllByTestId("coord-spawns-machine");
    expect(lines).toHaveLength(3);
    expect(
      lines.map(
        (l) =>
          within(l).queryByTestId("coord-spawns-machine-distinct")
            ?.textContent ?? null
      )
    ).toEqual([`· ${DEVICE_A.slice(0, 8)}`, `· ${DEVICE_B.slice(0, 8)}`, null]);
  });

  it("shows the real names, the switches and the launcher the lens withholds", async () => {
    render(<CoordSpawnsPage />);
    await settle();
    expect(
      screen
        .getAllByTestId("coord-spawns-machine-name")
        .map((n) => n.textContent)
    ).toEqual([HOST_A, HOST_B]);
    expect(
      screen.getByTestId("coord-spawns-launch-link").getAttribute("href")
    ).toBe("/admin/coord/spawn");
    const shepherd = screen
      .getAllByTestId("coord-spawns-path-row")
      .find((r) => r.getAttribute("data-path") === "merge_shepherd")!;
    await act(async () => {
      fireEvent.click(within(shepherd).getByTestId("coord-spawns-path-toggle"));
    });
    await settle();
    expect(
      screen.getByTestId("coord-spawns-path-switch-merge_shepherd")
    ).toBeTruthy();
    expect(document.body.textContent).toContain("merge_shepherd");
    const sessions = screen.getAllByTestId("coord-spawns-machine-sessions");
    expect(sessions[0]!.getAttribute("title")).toContain("10.0.0.5");
  });
});
