/**
 * /admin/coord/devops in presentation mode — plan
 * `2026-10-23-console-presentation-spaces` Phase 7.
 *
 * The arming claim this file holds: `/admin/coord/devops?present=1` shows NO
 * drain control and ONLY aliased machines. It renders the real page through
 * the presentation helper (`renderInPresentationMode` — the real UI Bridge
 * provider, a fixed presenting lens, a ready redaction scope) over the fixture
 * in `src/test/devopsPresentationFixture.ts`, whose every identifier is
 * distinctive and which feeds every free-text carrier the page can render.
 * It asserts:
 *
 *  1. `expectPresentationSafe` — no enabled write control, no write or
 *     undeclared UI Bridge action, no cost, and every section caption renders —
 *     behind every disclosure;
 *  2. no drain lever, dialog or target line, no CI-capacity disclosure, no
 *     rename, no role control and no operator-orientation note — by testid
 *     and by accessible name;
 *  3. NO fixture identifier anywhere in the document — text AND attributes,
 *     behind every disclosure and every tooltip — while each carrier is shown
 *     to be on the page;
 *  4. one machine, one alias, across the machine card, resources, worktree
 *     slots and the audit feed;
 *  5. headline figures and every section's sources with provenance — and a
 *     failed read UNKNOWN, never zero, said in fixed words rather than its own
 *     text, with an operator control proving that text does reach the page;
 *  6. the operator console unchanged: levers, real names, no lens chrome, and
 *     no edit carried over into presentation mode;
 *  7. the route is registered presentation-ready (`presentationReadiness.ts`),
 *     so the console's page gate renders the page rather than withholding it.
 *
 * The headline's derivations are pinned in
 * `components/operations/devOpsHeadline.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import {
  FAILURE_REASON_WITHHELD,
  FAILURE_SENTENCE_WITHHELD,
} from "@/components/operations/presentedFailure";
import { DEVOPS_SOURCES } from "@/components/operations/devOpsHeadline";

const httpGet = vi.fn();
const httpFetch = vi.fn();

// Same transport split as `page.test.tsx`: the typed coord reads go through
// `httpClient.fetch` and are answered from `httpGet`'s table as a 200
// Response; everything else is answered by `httpFetch`.
vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => httpGet(...args),
    fetch: async (url: string, init?: unknown) =>
      /fleet\/health|resource-samples|worktree-slots|ci-runners|fault-to-visibility|dispatch-roles|coord\/audit/.test(
        String(url)
      )
        ? new Response(JSON.stringify(await httpGet(url, init)), {
            status: 200,
          })
        : httpFetch(url, init),
  },
}));

// The page's one device-status subscription, seeded with rows that carry
// every free-text field the tile can render.
const deviceStatusRows = new Map<string, unknown>();
/** The stream's failure, when a test makes it fail. */
const deviceStatusState: { error: string | null } = { error: null };
vi.mock("@/components/operations/useDeviceStatusStream", () => ({
  useDeviceStatusStream: () => ({
    byHostname: deviceStatusRows,
    connected: false,
    error: deviceStatusState.error,
    seeded: true,
    everSeeded: true,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/components/operations/useSymbolClaimsStream", () => ({
  useSymbolClaimsStream: () => ({
    byMachine: new Map(),
    error: null,
    refetch: vi.fn(),
  }),
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => routerPush(...args) }),
  // The console layout's page gate (`PresentationPage`) reads the pathname.
  usePathname: () => "/admin/coord/devops",
}));

// An ADMIN, so every admin-gated write control would render for the
// operator: presentation mode must remove them, not the auth gate.
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    isCoordAdmin: true,
    loading: false,
    user: { is_superuser: false, coord_is_admin: true },
  }),
}));
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: "t-a", slug: "a", name: "A", roles: ["admin"] }],
    activeTenantId: "t-a",
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

import CoordDevOpsPage from "./page";
import {
  type CaptionKey,
  FixedPresentationMode,
  NAVIGATION_ONLY_ATTRIBUTE,
  PresentationPage,
  isPresentationReady,
  sessionMachineAliases,
} from "@/components/presentation";

import {
  checkBehindEveryDisclosure,
  DEV_A,
  DEV_B,
  DEVOPS_CAPTIONS,
  type DevOpsFixture,
  DISPLAY_NAME_A,
  ERROR_DEVICE,
  ERROR_HOST,
  FIRST_PARTY_REPO,
  HOST_A,
  HOST_B,
  machineSectionChips,
  mockDevOpsRoutes,
  MUST_NOT_APPEAR,
  NEUTRAL_FOREIGN_TASK,
  readFailure,
  SCOPE,
  SECTION_SOURCES,
  sectionChips,
  seedDeviceStatus as seedDeviceStatusInto,
  settle,
  toggleOf,
  VOLUME_MOUNT,
} from "@/test/devopsPresentationFixture";

/** The page's reads, answered from the fixture's route table. */
function mockRoutes(fixture: DevOpsFixture = {}) {
  mockDevOpsRoutes(httpGet, httpFetch, fixture);
}

/** The device-status stream's rows, seeded from the fixture. */
function seedDeviceStatus() {
  seedDeviceStatusInto(deviceStatusRows);
}

function resetEnvironment() {
  httpGet.mockReset();
  httpFetch.mockReset();
  routerPush.mockReset();
  deviceStatusRows.clear();
  deviceStatusState.error = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  sessionMachineAliases.reset();
  // The audit panel is collapsed by default; its persisted choice opens it,
  // so its rows are in the document to be checked.
  window.localStorage.setItem("devops:operator-audit", "1");
}

describe("/admin/coord/devops?present=1 — no drain control, only aliased machines", () => {
  beforeEach(resetEnvironment);

  it("is safe to show an outsider: no write control, no cost, every section captioned", async () => {
    mockRoutes();
    seedDeviceStatus();
    const view = renderInPresentationMode(<CoordDevOpsPage />, {
      scope: SCOPE,
    });
    await settle();

    // The live controls that ARE on this page are each navigation-only — and
    // they are here, so the check below is not passing on a page that
    // rendered none of them.
    for (const testId of [
      "coord-devops-credential-dark-badge",
      "coord-devops-conditions-awaiting-badge",
      "fleet-resource-refresh",
      "fleet-worktree-slots-refresh",
    ]) {
      // The strip's badges sit inside the button that carries the mark.
      expect(
        screen.getByTestId(testId).closest("button"),
        testId
      ).toHaveAttribute(NAVIGATION_ONLY_ATTRIBUTE);
    }

    checkBehindEveryDisclosure(() =>
      expectPresentationSafe(view, { captions: DEVOPS_CAPTIONS })
    );
  });

  it("shows no drain control, no CI-capacity edit, no rename and no role control", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();
    // A role row's write controls live in its detail: open one.
    // `getAllByTestId` throws on none, so the first row exists.
    fireEvent.click(toggleOf(screen.getAllByTestId("fleet-roles-row")[0]!));

    // The lever, its dialog and its target line — gone, not hidden.
    for (const testId of [
      "device-drain",
      "device-drain-open",
      "device-drain-undrain",
      "device-drain-dialog",
      "device-drain-target",
      "ci-capacity-disclosure",
      "ci-runner-drain-scope",
      "fleet-roles-set-workhorse",
      "fleet-roles-set-bench",
      "fleet-roles-set-ci_node",
      "fleet-roles-by-host",
      "fleet-roles-dialog",
      "operator-audit-resource-key",
    ]) {
      expect(screen.queryByTestId(testId), testId).toBeNull();
    }
    // By accessible name too: the lever is "Drain…" / "Undrain", its submit
    // "Drain machine". (An audit row reading "Drained a machine" is a
    // disclosure, not a lever — `\b` keeps it out of the match.)
    expect(
      screen.queryByRole("button", { name: /^(drain|undrain)\b/i })
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /^rename\b/i })).toBeNull();
    // The operator's orientation notes — where to act, what the list is
    // keyed on, the mirror's window — are not rendered for an outsider.
    for (const testId of [
      "coord-devops-hosted-ci-link-line",
      "coord-devops-join-note",
      "coord-devops-computers-note",
      "ci-runner-mirror-freshness",
    ]) {
      expect(screen.queryByTestId(testId), testId).toBeNull();
    }
    // ...nor the audit feed's note on where the lever it explains lives.
    expect(document.body.textContent).not.toContain(
      "Every operator write coord stamped"
    );

    // What remains is the drain STATE, read-only: the drained machine says
    // so, with no actor and no reason.
    const states = screen.getAllByTestId("device-drain-status");
    expect(states.length).toBeGreaterThan(0);
    const drained = states.filter(
      (s) => s.getAttribute("data-device-drain") === "drained"
    );
    expect(drained).toHaveLength(1);
    expect(drained[0]).toHaveTextContent(/out of service/i);
    expect(drained[0]).toHaveTextContent(/drained until/i);
  });

  it("renders no hostname, device id, display name, repository, person or free text — in text or attributes", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    // Every free-text carrier the fixture feeds IS on the page — so their
    // identifiers' absence below is redaction, not an empty render: the
    // runner's reports (as counts), the dark credential, the setting in
    // effect.
    expect(
      screen.getAllByTestId("devops-runner-wedges-presented")[0]
    ).toHaveTextContent("1 open");
    expect(
      document.querySelector('[data-operations-coord-credential="dark"]')
    ).not.toBeNull();
    expect(
      screen.getByTestId("coord-devops-conditions-setting-12")
    ).toBeTruthy();
    // Both machines report a task, and both are withheld as descriptors —
    // machine A's for naming a client, machine B's ONLY because its
    // repository's owner is not first-party (its text names nobody).
    const taskCells = document.querySelectorAll(
      '[data-ui-bridge-id="operations.device-status-task"]'
    );
    expect(taskCells).toHaveLength(2);
    for (const cell of taskCells) {
      expect(cell.querySelector('[data-redacted="true"]')).not.toBeNull();
    }

    checkBehindEveryDisclosure(() => {
      // `innerHTML` is text AND every attribute: a `data-hostname`, a
      // `title`, a row key or an `href` leaks exactly as visible text does.
      const html = document.body.innerHTML;
      const leaked = MUST_NOT_APPEAR.filter((needle) => html.includes(needle));
      expect(leaked, "identifiers that reached the presentation DOM").toEqual(
        []
      );
    });

    // A tooltip's text is in front of the audience the moment it opens —
    // a coord state's explanation, a stall's detail — and is not in the DOM
    // until then. Open each one in turn and check again.
    let opened = 0;
    for (const trigger of document.querySelectorAll('[data-state="closed"]')) {
      fireEvent.focus(trigger);
      if (trigger.getAttribute("data-state")?.endsWith("open")) opened += 1;
      const html = document.body.innerHTML;
      expect(
        MUST_NOT_APPEAR.filter((needle) => html.includes(needle)),
        "identifiers behind a tooltip"
      ).toEqual([]);
      fireEvent.blur(trigger);
    }
    // The coord-state, stall and resource tooltips really opened.
    expect(opened).toBeGreaterThan(5);

    // Machine A's workstation row notes the CI-host role set under its own
    // name — without the name. (The list orders its rows itself, so each one
    // is opened in turn.)
    const twins: string[] = [];
    for (const row of screen.getAllByTestId("fleet-roles-row")) {
      fireEvent.click(toggleOf(row));
      const twin = screen.queryByTestId("fleet-roles-host-row-twin");
      if (twin) twins.push(twin.textContent ?? "");
    }
    expect(twins).toHaveLength(1);
    expect(twins[0]).toContain("this machine's name");
  });

  it("names a kill switch's repository only when the scope clears it — coord's `repo:` scope included", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    // The partner's: its resource key and its `metadata.scope` are both
    // `repo:acme-partner/secret-repo`, and neither may reach the page.
    fireEvent.click(toggleOf(screen.getByTestId("audit-row-audit-3")));
    const partner = screen.getByTestId("audit-detail-audit-3");
    expect(partner.textContent).not.toMatch(/acme|secret/i);
    expect(partner).toHaveTextContent(/Repository · /);

    // The tenant's own: the same row shape, and its repository shows — in
    // the row's label and in the blast radius.
    fireEvent.click(toggleOf(screen.getByTestId("audit-row-audit-4")));
    const own = screen.getByTestId("audit-row-audit-4");
    expect(own).toHaveTextContent(`repo:${FIRST_PARTY_REPO}`);
    expect(screen.getByTestId("audit-blast-audit-4")).toHaveTextContent(
      FIRST_PARTY_REPO
    );
  });

  it("says what a gap or a limit means in plain words, never in coord's vocabulary", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    // The CI panel's missing columns: why they are missing, without the
    // table name or a retired claim that the lane is switched off.
    const gap = screen.getByTestId("ci-run-missing-columns");
    expect(gap).toHaveTextContent(/does not publish them yet/);
    expect(gap.textContent).not.toMatch(/coord\.|still dark|dispatch flag/);

    // The worktree cap is the one reported for the machine — no retired
    // fleet-wide constant, no default.
    fireEvent.focus(screen.getByText("Slots"));
    const capTip = await screen.findByTestId("fleet-worktree-slots-cap-tip");
    expect(capTip).toHaveTextContent(
      "Agent workspaces in use, against the limit reported for this machine."
    );
    expect(capTip.textContent).not.toMatch(/COORD_|default 8/);
    fireEvent.blur(screen.getByText("Slots"));

    // A machine with no recent count says so, without coord's "census".
    const [unknownCell] = screen.getAllByTestId(
      "fleet-worktree-slots-unknown-cell"
    );
    fireEvent.focus(unknownCell!);
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "This machine has sent no recent count, so how many workspaces it holds is unknown."
      )
    );
    expect(document.body.textContent).not.toMatch(/census/);
    fireEvent.blur(unknownCell!);
  });

  it("names machines by alias, and one machine by ONE alias across the machine card, the resources table and the worktree slots", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    const aliased = document.querySelectorAll('[data-machine-alias="true"]');
    expect(aliased.length).toBeGreaterThanOrEqual(4);
    for (const el of aliased) {
      expect(el.textContent).toMatch(/^Machine [A-Z]+$/);
    }

    // The registry already holds machine A's letter, linked by device id AND
    // hostname; asking again assigns nothing new.
    const aliasA = sessionMachineAliases.aliasFor({
      deviceId: DEV_A,
      hostname: HOST_A,
    });
    const aliasB = sessionMachineAliases.aliasFor({ deviceId: DEV_B });
    expect(aliasA).not.toBe(aliasB);

    // Machine card: the one carrying the drained state.
    const drainedCard = screen
      .getAllByTestId("device-drain-status")
      .find((s) => s.getAttribute("data-device-drain") === "drained")!
      .closest("[data-operations-machine-card]") as HTMLElement;
    expect(within(drainedCard).getByText(aliasA)).toBeTruthy();
    // Its disk: the figure, named by its position — never by its mount.
    expect(within(drainedCard).getByText("Volume 1")).toBeTruthy();
    expect(drainedCard.querySelector("[data-operations-volume]")).toBeNull();

    // Worktree slots: machine A is the row with a live census.
    const slotRows = screen.getAllByTestId("fleet-worktree-slots-row");
    const knownRow = slotRows.find(
      (r) => r.getAttribute("data-worktree-slots-state") === "known"
    )!;
    expect(knownRow).toHaveTextContent(aliasA);
    expect(knownRow).toHaveTextContent("3/8");

    // Audit feed: the drain row's blast radius names the device by the same
    // alias — not withheld, and not its id.
    fireEvent.click(toggleOf(screen.getByTestId("audit-row-audit-1")));
    expect(screen.getByTestId("audit-blast-audit-1")).toHaveTextContent(aliasA);
    // A write whose ACTOR is a machine: the Operator line is machine A's
    // alias too, and the machine it released is B's.
    fireEvent.click(toggleOf(screen.getByTestId("audit-row-audit-5")));
    expect(screen.getByTestId("audit-detail-audit-5")).toHaveTextContent(
      `Operator: ${aliasA}`
    );
    expect(screen.getByTestId("audit-blast-audit-5")).toHaveTextContent(aliasB);
    const unknownRow = slotRows.find(
      (r) => r.getAttribute("data-worktree-slots-state") === "unknown"
    )!;
    expect(unknownRow).toHaveTextContent(aliasB);

    // Resources table: machine A's host lane.
    const resourceRows = screen.getAllByTestId("fleet-resource-row");
    expect(resourceRows.some((r) => r.textContent?.includes(aliasA))).toBe(
      true
    );
    // The CI publisher's "<runner>/<repo>" instance reads by position.
    expect(
      resourceRows.some((r) => r.textContent?.includes("instance 1"))
    ).toBe(true);
    // Each row's disk figure is shown without the sample's mount, a path
    // someone chose that names a client here (the operator test below shows
    // the same rows DO carry it for the operator).
    for (const row of resourceRows) {
      expect(row.textContent).not.toContain(VOLUME_MOUNT);
    }
  });

  it("opens with three headline figures, each with its provenance", async () => {
    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await settle();

    const machines = await screen.findByTestId("devops-headline-machines");
    // Two of the three coord devices report healthy.
    await waitFor(() => expect(machines).toHaveTextContent("2 of 3"));
    expect(machines).toHaveTextContent(/1 degraded/);

    const workspaces = screen.getByTestId("devops-headline-workspaces");
    // Machine A's 3 of 8. Machine B has no recent census and the CI device is
    // not on the slot read at all: neither is counted, and both are named.
    await waitFor(() => expect(workspaces).toHaveTextContent("3 of 8"));
    expect(workspaces).toHaveTextContent(/2 machines not counted/);

    const ci = screen.getByTestId("devops-headline-ci");
    await waitFor(() => expect(ci).toHaveTextContent("1 of 1"));

    for (const id of [
      "devops-headline-machines-provenance",
      "devops-headline-workspaces-provenance",
      "devops-headline-ci-provenance",
    ]) {
      const chip = screen.getByTestId(id);
      expect(chip.getAttribute("data-provenance-known"), id).toBe("true");
      expect(chip).toHaveTextContent(/source: coord/);
      expect(chip).toHaveTextContent(/as of /);
    }

    // EVERY captioned section names every read its numbers come from — the
    // machine list's disk, drain and device-status times included, and the
    // health strip's device-status reports, which its credential badges count
    // from — and each one answered, so each is dated. (A chip whose as-of went
    // missing, or one source too few, fails here by section and source.)
    await waitFor(() => {
      for (const [id, sources] of SECTION_SOURCES) {
        const chips = sectionChips(id);
        expect([...chips.keys()].sort(), id).toEqual([...sources].sort());
        for (const [source, chip] of chips) {
          expect(
            chip.getAttribute("data-provenance-known"),
            `${id}: ${source}`
          ).toBe("true");
        }
      }
    });
    expect(SECTION_SOURCES.map(([id]) => id).sort()).toEqual(
      DEVOPS_CAPTIONS.filter((id) => id !== "dev-ops.page").sort()
    );
  });

  it("a read that answered and then failed is dated UNKNOWN where its section shows nothing from it — drain, roles, the audit feed", async () => {
    // The hooks KEEP the last answer's date through a failed poll
    // (`devOpsAsOf.test.ts`), so only each section's own gate stops an
    // unknown read being dated by the last good one. Exercised the way the
    // page meets it: each read answers, then starts failing.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const failingRoutes: string[] = [];
    try {
      mockRoutes({ failingRoutes });
      seedDeviceStatus();
      const view = renderInPresentationMode(<CoordDevOpsPage />, {
        scope: SCOPE,
      });
      await settle();
      const known = (id: CaptionKey, source: string) =>
        sectionChips(id).get(source)?.getAttribute("data-provenance-known");
      await waitFor(() => {
        expect(known("dev-ops.machines", DEVOPS_SOURCES.drainState)).toBe(
          "true"
        );
        expect(known("dev-ops.roles", DEVOPS_SOURCES.dispatchRoles)).toBe(
          "true"
        );
        expect(known("dev-ops.audit", DEVOPS_SOURCES.operatorAudit)).toBe(
          "true"
        );
      });
      const drainedBefore = screen
        .getAllByTestId("device-drain-status")
        .filter((s) => s.getAttribute("data-device-drain") === "drained");
      expect(drainedBefore).toHaveLength(1);

      failingRoutes.push("/fleet/drain", "dispatch-roles", "coord/audit");
      // The drain and role polls run every 30 s; the audit feed is re-read
      // by its Refresh (navigation-only, so it is live while presenting).
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000);
      });
      fireEvent.click(screen.getByTestId("operator-audit-refresh"));

      // Each failure has landed — not merely a re-read in flight: the machine
      // cards stay, each drain UNKNOWN rather than the last state read, and
      // the roles and the feed say their reads failed...
      await waitFor(() => {
        const drains = screen.getAllByTestId("device-drain-status");
        expect(
          drains.filter(
            (s) => s.getAttribute("data-device-drain") === "drained"
          )
        ).toHaveLength(0);
        expect(
          drains.some((s) => s.getAttribute("data-device-drain") === "unknown")
        ).toBe(true);
        expect(screen.getByTestId("fleet-roles-unknown")).toBeTruthy();
        expect(screen.getByTestId("operator-audit-error")).toBeTruthy();
      });
      // ...and none of the three is dated by its last good answer.
      expect(known("dev-ops.machines", DEVOPS_SOURCES.drainState)).toBe(
        "false"
      );
      expect(known("dev-ops.roles", DEVOPS_SOURCES.dispatchRoles)).toBe(
        "false"
      );
      expect(known("dev-ops.audit", DEVOPS_SOURCES.operatorAudit)).toBe(
        "false"
      );
      // The reads that kept answering stay dated.
      expect(known("dev-ops.machines", DEVOPS_SOURCES.fleetHealth)).toBe(
        "true"
      );
      expect(known("dev-ops.resources", DEVOPS_SOURCES.resourceSamples)).toBe(
        "true"
      );
      view.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a failed poll's figure UNKNOWN with its reason — never zero — and leaves the others standing", async () => {
    mockRoutes({ worktreeSlotsFail: true });
    seedDeviceStatus();
    renderInPresentationMode(<CoordDevOpsPage />, { scope: SCOPE });
    await screen.findByTestId("devops-headline-strip");

    const workspaces = screen.getByTestId("devops-headline-workspaces");
    await waitFor(() =>
      expect(workspaces.getAttribute("data-headline-known")).toBe("false")
    );
    // The FIGURE is the word UNKNOWN — not a 0, a dash or a blank (the chip
    // saying "as of UNKNOWN" beside it does not count).
    expect(
      workspaces.querySelector('[data-headline-part="value"]')?.textContent
    ).toBe("UNKNOWN");
    expect(workspaces).toHaveTextContent(
      /latest read of agent workspaces failed/
    );
    expect(workspaces).not.toHaveTextContent(/\b0 of\b/);
    const chip = screen.getByTestId("devops-headline-workspaces-provenance");
    expect(chip.getAttribute("data-provenance-known")).toBe("false");

    // The two other polls answered; their figures stand.
    await waitFor(() =>
      expect(screen.getByTestId("devops-headline-machines")).toHaveTextContent(
        "2 of 3"
      )
    );
    expect(
      screen
        .getByTestId("devops-headline-ci")
        .getAttribute("data-headline-known")
    ).toBe("true");
  });
});

describe("/admin/coord/devops?present=1 — a failed read says it failed, in fixed words", () => {
  beforeEach(resetEnvironment);

  /** Wait for every panel that raises its own failure to have raised it. */
  async function settleFailures(arm: "all" | "all-but-fleet-health") {
    await screen.findByTestId("devops-headline-strip");
    for (const testId of [
      "fleet-roles-unknown",
      "operator-audit-error",
      "fleet-resource-error",
      "ci-run-error",
      "fleet-worktree-slots-error",
    ]) {
      await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy());
    }
    if (arm === "all") {
      await screen.findByText("Backend Unreachable");
    } else {
      await waitFor(() =>
        expect(
          document.querySelectorAll("[data-operations-machine-card]").length
        ).toBeGreaterThan(0)
      );
      await waitFor(() =>
        expect(
          screen.getByTestId("coord-devops-credential-unknown-badge")
        ).toBeTruthy()
      );
    }
  }

  /** What every arm holds: no failure's own text, and each failure stated. */
  function expectFailuresInFixedWords() {
    const html = document.body.innerHTML;
    expect(html).not.toContain(ERROR_HOST);
    expect(html).not.toContain(ERROR_DEVICE);
    // No machine reported its status: said plainly, without the route agents
    // post to.
    const empty = screen.getByTestId("device-status-empty");
    expect(empty).toHaveTextContent(
      "No machine has reported what it is working on in the last hour."
    );
    expect(empty.textContent).not.toMatch(/POST|\/coord\//);
    expect(screen.getByTestId("fleet-roles-unknown")).toHaveTextContent(
      FAILURE_SENTENCE_WITHHELD
    );
    for (const testId of [
      "operator-audit-error",
      "fleet-resource-error",
      "ci-run-error",
      "fleet-worktree-slots-error",
    ]) {
      expect(screen.getByTestId(testId), testId).toHaveTextContent(
        FAILURE_REASON_WITHHELD
      );
    }
    // UNKNOWN, never zero, at the top too.
    for (const id of ["devops-headline-workspaces", "devops-headline-ci"]) {
      expect(
        screen.getByTestId(id).getAttribute("data-headline-known"),
        id
      ).toBe("false");
    }
  }

  it("every read fails: no failure's own text reaches the page, and every panel says it failed", async () => {
    mockRoutes({ fail: "all" });
    deviceStatusState.error = readFailure("/coord/device-status").message;
    const view = renderInPresentationMode(<CoordDevOpsPage />, {
      scope: SCOPE,
    });
    await settleFailures("all");

    expectFailuresInFixedWords();
    expect(
      screen
        .getByTestId("devops-headline-machines")
        .getAttribute("data-headline-known")
    ).toBe("false");
    // The machine inventory's own failure, and no operator next step.
    expect(document.body).toHaveTextContent(FAILURE_SENTENCE_WITHHELD);
    expect(document.body.textContent).not.toContain("localhost:8000");
    // The health strip's detail and the conditions panel say it in the same
    // fixed words.
    expect(screen.getByTestId("coord-devops-health-strip")).toHaveTextContent(
      FAILURE_REASON_WITHHELD
    );
    expect(
      screen.getByTestId("coord-devops-conditions-panel")
    ).toHaveTextContent(FAILURE_REASON_WITHHELD);
    expectPresentationSafe(view, { captions: DEVOPS_CAPTIONS });
  });

  it("coord's fleet health answers and every other read fails: the machine cards say so in fixed words too", async () => {
    mockRoutes({ fail: "all-but-fleet-health" });
    deviceStatusState.error = readFailure("/coord/device-status").message;
    const view = renderInPresentationMode(<CoordDevOpsPage />, {
      scope: SCOPE,
    });
    await settleFailures("all-but-fleet-health");

    expectFailuresInFixedWords();
    // The credential badge's tooltip quotes the stream's failure.
    expect(
      screen
        .getByTestId("coord-devops-credential-unknown-badge")
        .getAttribute("title")
    ).toContain(FAILURE_REASON_WITHHELD);
    // Every machine's drain is UNKNOWN — said, not guessed.
    const drains = screen.getAllByTestId("device-drain-status");
    expect(drains.length).toBeGreaterThan(0);
    for (const d of drains) {
      if (d.getAttribute("data-device-drain") === "no_device") continue;
      expect(d.getAttribute("data-device-drain")).toBe("unknown");
      expect(d).toHaveTextContent(/drain state has not been read/i);
    }
    // The runner inventory did not answer, so its counts are UNKNOWN — never
    // "Runners 0 · Healthy 0".
    for (const label of [
      "Runners",
      "Healthy",
      "Running Tasks",
      "CC Sessions",
    ]) {
      const stat = screen.getByText(label, { exact: true, selector: "span" })
        .parentElement as HTMLElement;
      expect(stat, label).toHaveTextContent(`${label}unknown`);
    }
    // ...and "Healthy" does not wear the green of a fleet whose every runner
    // is healthy.
    const healthy = screen.getByText("Healthy", {
      exact: true,
      selector: "span",
    }).parentElement as HTMLElement;
    expect(healthy.querySelector('[data-slot="badge"]')).not.toHaveClass(
      "bg-success"
    );
    // Each read that failed is dated UNKNOWN — a failed poll never makes the
    // section look current — while coord's fleet health, which answered, is
    // dated.
    const chips = machineSectionChips();
    expect(
      chips
        .get(DEVOPS_SOURCES.fleetHealth)
        ?.getAttribute("data-provenance-known")
    ).toBe("true");
    for (const source of [
      DEVOPS_SOURCES.runnerInventory,
      DEVOPS_SOURCES.ciRunnerMirror,
      DEVOPS_SOURCES.diskTelemetry,
      DEVOPS_SOURCES.drainState,
    ]) {
      expect(
        chips.get(source)?.getAttribute("data-provenance-known"),
        source
      ).toBe("false");
    }
    // ...and the machine list's refresh-loop clock — "Updated 0s ago", stamped
    // although the inventory read just failed — is not on the page to
    // contradict that chip. (The operator control below shows it IS rendered
    // for the operator in this same state.)
    // (`textContent` glues adjacent cells together — "not readUpdated" — so
    // the pattern keys on the word and the space after it, not a boundary.)
    expect(
      screen.getByTestId("coord-devops-machines").textContent
    ).not.toMatch(/Updated\s/);
    expectPresentationSafe(view, { captions: DEVOPS_CAPTIONS });
  });

  it("(control) the same failures DO carry their own text for the operator", async () => {
    mockRoutes({ fail: "all-but-fleet-health" });
    deviceStatusState.error = readFailure("/coord/device-status").message;
    render(
      <FixedPresentationMode presenting={false}>
        <CoordDevOpsPage />
      </FixedPresentationMode>
    );
    for (const testId of [
      "fleet-roles-unknown",
      "operator-audit-error",
      "fleet-resource-error",
      "ci-run-error",
      "fleet-worktree-slots-error",
    ]) {
      // So the presentation arms above are not passing on a fixture whose
      // failures never reached the page at all.
      await waitFor(() =>
        expect(screen.getByTestId(testId), testId).toHaveTextContent(ERROR_HOST)
      );
    }
    expect(
      screen
        .getByTestId("coord-devops-credential-unknown-badge")
        .getAttribute("title")
    ).toContain(ERROR_HOST);
    // The empty device-status list names the route agents post to — for the
    // operator only.
    expect(screen.getByTestId("device-status-empty")).toHaveTextContent(
      "POST /coord/status"
    );
    // The machine list's refresh-loop clock is the operator's: shown here,
    // over the same failed inventory read the presentation arm hides it over.
    await waitFor(() =>
      expect(screen.getByTestId("coord-devops-machines").textContent).toMatch(
        /Updated\s/
      )
    );
  });
});

describe("/admin/coord/devops?present=1 — the console's page gate renders it", () => {
  beforeEach(resetEnvironment);

  it("is registered presentation-ready, so PresentationPage shows the page instead of withholding it", async () => {
    // The registration (`presentationReadiness.ts`) is what this whole file
    // is the proof of. Rendered bare, every test above would pass for a page
    // the console never shows an evaluator: without the entry the layout's
    // gate swaps the page for "Shown in the operator view only".
    expect(isPresentationReady("/admin/coord/devops")).toBe(true);

    mockRoutes();
    seedDeviceStatus();
    renderInPresentationMode(
      <PresentationPage>
        <CoordDevOpsPage />
      </PresentationPage>,
      { scope: SCOPE }
    );
    await settle();

    expect(screen.queryByTestId("presentation-withheld-page")).toBeNull();
    expect(screen.getByTestId("devops-headline-strip")).toBeTruthy();
  });
});

describe("/admin/coord/devops for the operator — the console is unchanged", () => {
  beforeEach(resetEnvironment);

  it("still shows the drain lever, the rename, the CI capacity and the real names; no headline, no captions", async () => {
    mockRoutes();
    seedDeviceStatus();
    render(
      <FixedPresentationMode presenting={false}>
        <CoordDevOpsPage />
      </FixedPresentationMode>
    );

    await waitFor(() =>
      expect(screen.getAllByTestId("device-drain").length).toBeGreaterThan(0)
    );
    // Machine A is drained, so its lever offers Undrain; the others Drain.
    await waitFor(() =>
      expect(screen.getAllByTestId("device-drain-undrain")).toHaveLength(1)
    );
    expect(screen.getAllByTestId("device-drain-open").length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByTestId("device-drain-target").length).toBeGreaterThan(
      0
    );
    expect(screen.getAllByTestId("ci-capacity-disclosure")).toHaveLength(1);
    expect(
      screen.getAllByRole("button", { name: /rename/i }).length
    ).toBeGreaterThan(0);

    // Real names: the operator's alias for machine A, and the hostnames.
    expect(screen.getAllByText(DISPLAY_NAME_A).length).toBeGreaterThan(0);
    // ...and every task as reported, the one withheld from an outsider for
    // its repository's owner alone included.
    expect(document.body.textContent).toContain(NEUTRAL_FOREIGN_TASK);
    expect(document.body.innerHTML).toContain(HOST_B);
    // The operator still reads the volume's own mount — on the machine card
    // and beside each resources row's disk figure.
    expect(screen.getAllByText(VOLUME_MOUNT).length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("fleet-resource-row")
          .some((r) => r.textContent?.includes(VOLUME_MOUNT))
      ).toBe(true)
    );
    expect(document.querySelector('[data-machine-alias="true"]')).toBeNull();

    expect(screen.queryByTestId("devops-headline-strip")).toBeNull();
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();
    expect(document.querySelector("[data-provenance]")).toBeNull();

    // The operator's CI note names coord's table, and no longer claims the
    // lane behind it is switched off (coord's ci_dispatch.rs: armed).
    const gap = await screen.findByTestId("ci-run-missing-columns");
    expect(gap).toHaveTextContent("coord.ci_dispatches");
    expect(gap.textContent).not.toMatch(/still dark|dispatch flag/);
    // The worktree cap is the one coord reports for the machine — not the
    // retired fleet-wide constant.
    fireEvent.focus(await screen.findByText("Slots"));
    const capTip = await screen.findByTestId("fleet-worktree-slots-cap-tip");
    expect(capTip).toHaveTextContent(
      "Active worktree allocations against the cap coord reports for this machine."
    );
    expect(capTip.textContent).not.toMatch(/COORD_MAX_WORKTREES|default 8/);
  });

  it("a rename begun by the operator does not carry over into presentation mode", async () => {
    mockRoutes();
    seedDeviceStatus();
    const view = render(
      <FixedPresentationMode presenting={false}>
        <CoordDevOpsPage />
      </FixedPresentationMode>
    );
    const [rename] = await screen.findAllByRole("button", {
      name: /^rename /i,
    });
    fireEvent.click(rename!);
    // The edit is open, with the machine's real name in it.
    expect(screen.getByRole("textbox", { name: /^rename /i })).toBeTruthy();

    // The operator switches to presenting mid-edit.
    view.rerender(
      <FixedPresentationMode presenting>
        <CoordDevOpsPage />
      </FixedPresentationMode>
    );
    expect(screen.queryByRole("textbox", { name: /^rename /i })).toBeNull();
  });
});
