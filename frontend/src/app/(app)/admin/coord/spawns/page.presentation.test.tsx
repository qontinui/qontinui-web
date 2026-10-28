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
 *     behind every disclosure (each spawn path's switches, each request's
 *     detail and timeline);
 *  2. no write control is mounted (the switches) and the launcher link is
 *     gone, while the session-load link stays text (its page is not
 *     presentable), and machines read as their alias;
 *  3. a failed read still says UNKNOWN, in fixed words;
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
import { drainBody, effectiveBody } from "./__fixtures__/spawnPaths";
import {
  isPresentationReady,
  sessionMachineAliases,
  type CaptionKey,
} from "@/components/presentation";
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
  // Registry names, variables and settings keys: the operator's vocabulary.
  "pr_fix_dispatch",
  "merge_shepherd",
  "COORD_",
  "claude_cli",
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
        { device_id: DEVICE_A, name: HOST_A, role: { dispatch_role: "workhorse" }, registration: "registered" },
        { device_id: DEVICE_B, name: HOST_B, role: { dispatch_role: "bench" }, registration: "registered" },
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
    body: effectiveBody({ next_step_dispatch: { enabled: false, source: "user_pref" } }),
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
    for (let i = 0; i < 15; i += 1) await new Promise((res) => setTimeout(res, 0));
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
    expect(screen.getAllByTestId("coord-spawns-gate").length).toBeGreaterThan(0);
    expectPresentationSafe(view, { captions: CAPTIONS, forbidden: FORBIDDEN });
  }
  const rows = () => screen.getAllByTestId("coord-spawn-row");
  expect(rows()).toHaveLength(2);
  for (let i = 0; i < rows().length; i += 1) {
    await act(async () => {
      fireEvent.click(within(rows()[i]!).getAllByRole("button")[0]!);
    });
    await settle();
    expect(screen.getAllByTestId("coord-spawn-event")).toHaveLength(3);
    expectPresentationSafe(view, { captions: CAPTIONS, forbidden: FORBIDDEN });
  }
}

beforeEach(() => {
  routes = presentationRoutes();
  sessionMachineAliases.reset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("/admin/coord/spawns?present=1", () => {
  it("is safe to show an outsider, behind every disclosure: no write control, no cost, no identity, every caption", async () => {
    const view = renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    // The page rendered its data: the matrix, the machines, the requests.
    expect(screen.getAllByTestId("coord-spawns-path-row").length).toBeGreaterThan(15);
    expect(screen.getAllByTestId("coord-spawns-machine")).toHaveLength(2);
    expect(screen.getAllByTestId("coord-spawn-row")).toHaveLength(2);
    expectPresentationSafe(view, { captions: CAPTIONS, forbidden: FORBIDDEN });
    await checkBehindEveryDisclosure(view);
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
    expect(screen.queryByTestId("coord-spawns-path-switch-merge_shepherd")).toBeNull();
    expect(screen.queryByTestId("coord-spawns-path-fixer-dial")).toBeNull();
    expect(document.querySelector('[data-testid^="coord-spawns-path-switch-"]')).toBeNull();
    expect(document.querySelector('[data-testid^="coord-spawns-path-autonomy-"]')).toBeNull();
    expect(screen.queryByTestId("coord-spawns-launch-link")).toBeNull();
    expect(
      screen.getByTestId("coord-spawns-session-load-link").getAttribute("data-lens-link")
    ).toBe("unlinked");
    const names = screen.getAllByTestId("coord-spawns-machine-name");
    expect(names.map((n) => n.textContent)).toEqual(["Machine A", "Machine B"]);
    for (const n of names) expect(n.getAttribute("data-machine-alias")).toBe("true");
    // The per-device share list names the same machines by the same letters.
    const shares = screen.getAllByTestId("coord-spawns-device").map((d) => d.textContent ?? "");
    expect(shares[0]).toContain("Machine A");
    expect(shares[1]).toContain("Machine B");
  });

  it("states where a per-repository switch is set as text, with no link into a page it cannot present", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    const postMerge = screen
      .getAllByTestId("coord-spawns-path-row")
      .find((r) => r.getAttribute("data-path") === "post_merge_followup")!;
    await act(async () => {
      fireEvent.click(within(postMerge).getByTestId("coord-spawns-path-toggle"));
    });
    await settle();
    const setOn = screen.getByTestId("coord-spawns-path-set-on-post_merge_followup");
    expect(setOn.getAttribute("data-lens-link")).toBe("unlinked");
    expect(setOn.tagName).toBe("SPAN");
    expect(document.querySelector('a[href*="/admin/coord/agent-registry"]')).toBeNull();
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
    expect(screen.getByTestId("coord-spawns-inflight-note").textContent).toContain(
      "does not offer that figure"
    );
  });

  it("carries every section's caption and the provenance of its reads", async () => {
    renderInPresentationMode(<CoordSpawnsPage />, { scope: SCOPE });
    await settle();
    for (const id of CAPTIONS) {
      expect(document.querySelector(`[data-presentation-caption="${id}"]`), id).not.toBeNull();
    }
    const paths = screen.getByTestId("coord-spawns-paths-caption");
    expect(paths.querySelectorAll("[data-provenance]").length).toBe(6);
    const machines = screen.getByTestId("coord-spawns-machines-caption");
    expect(machines.querySelectorAll("[data-provenance]").length).toBe(4);
    // The session read failed: its chip says UNKNOWN rather than an age.
    const unknownChips = [...machines.querySelectorAll("[data-provenance]")].filter(
      (c) => c.getAttribute("data-provenance-known") === "false"
    );
    expect(unknownChips).toHaveLength(1);
  });

  it("is registered presentation-ready", () => {
    expect(isPresentationReady("/admin/coord/spawns")).toBe(true);
  });
});

describe("/admin/coord/spawns for the operator — the same fixtures", () => {
  it("shows the real names, the switches and the launcher the lens withholds", async () => {
    render(<CoordSpawnsPage />);
    await settle();
    expect(screen.getAllByTestId("coord-spawns-machine-name").map((n) => n.textContent)).toEqual([
      HOST_A,
      HOST_B,
    ]);
    expect(screen.getByTestId("coord-spawns-launch-link").getAttribute("href")).toBe(
      "/admin/coord/spawn"
    );
    const shepherd = screen
      .getAllByTestId("coord-spawns-path-row")
      .find((r) => r.getAttribute("data-path") === "merge_shepherd")!;
    await act(async () => {
      fireEvent.click(within(shepherd).getByTestId("coord-spawns-path-toggle"));
    });
    await settle();
    expect(screen.getByTestId("coord-spawns-path-switch-merge_shepherd")).toBeTruthy();
    expect(document.body.textContent).toContain("merge_shepherd");
    const sessions = screen.getAllByTestId("coord-spawns-machine-sessions");
    expect(sessions[0]!.getAttribute("title")).toContain("10.0.0.5");
  });
});
