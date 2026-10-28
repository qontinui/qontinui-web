/**
 * /admin/coord/home in presentation mode — plan
 * `2026-10-23-console-presentation-spaces` Phase 2. This file is the proof
 * `PRESENTATION_READY_ROUTES` names for the route (`presentationReadiness.ts`).
 *
 * It renders the REAL page through the presentation helper
 * (`renderInPresentationMode`: the real UI Bridge provider, a fixed presenting
 * lens, a ready redaction scope), mocking only its data sources — the
 * transport the project-state read goes through, and the tenant list — over
 * fixtures (`__fixtures__/presentationFixture.ts`) that feed every free-text
 * carrier the page can show, in every state its regions render. It asserts:
 *
 *  1. `expectPresentationSafe` in every state — read, blocks not read, no live
 *     initiative, decisions counted but not served, nothing read yet, a first
 *     read that failed — behind every disclosure: no enabled write control,
 *     no write or undeclared UI Bridge action, no cost, no identity, every
 *     caption; and no fixture identifier anywhere in the DOM, attributes
 *     included;
 *  2. each region in presentation mode: its caption, the provenance of its
 *     figures, and its carriers redacted (and a first-party one shown);
 *  3. Correct? shows no write control while presenting;
 *  4. a kept reading after a failed refresh is named as the last one, led by
 *     the failure in fixed words, and dated by its read — never as current;
 *  5. the refresh is a read, registered with the UI Bridge where it renders;
 *  6. the route is registered presentation-ready, so the console's page gate
 *     renders it rather than withholding it;
 *  7. the operator console unchanged: every carrier verbatim, the raw lines,
 *     the titles and the answer link, and no lens chrome;
 *  8. an open row stays the record that was opened when a poll removes the
 *     row above it, in both modes: a presented row's key is an alias of the
 *     operator's, never its position.
 *
 * The pure half (descriptors, repository attribution, allowlists) is pinned
 * in `_lib/homeLens.test.ts`.
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
import { UNKNOWN_AMBER } from "@/components/console";
import {
  FixedPresentationMode,
  NAVIGATION_ONLY_ATTRIBUTE,
  PresentationPage,
  WITHHELD_PAGE_TITLE,
  isPresentationReady,
  sessionMachineAliases,
  type CaptionKey,
} from "@/components/presentation";
import {
  FAILURE_REASON_WITHHELD,
  FAILURE_SENTENCE_WITHHELD,
} from "@/components/operations/presentedFailure";
import {
  expectPresentationSafe,
  renderInPresentationMode,
  type PresentationRenderResult,
} from "@/test/presentation";
import {
  CLIENT_DOMAIN,
  FIRST_PARTY_HEADLINE,
  FIRST_PARTY_REPO,
  FIRST_PARTY_SHAPED_SERVICE,
  FIRST_PARTY_UNIT_TITLE,
  GATE_ID,
  HIDDEN_UNIT_TITLE,
  HOST_BUILD,
  MUST_NOT_APPEAR,
  QUESTION_ID,
  REFRESH_FAILURE,
  SCOPE,
  SHARED_UNIT_TITLE,
  TENANT_ID,
  TENANT_NAME,
  firstDecisionAnsweredBody,
  fullBody,
  noLiveInitiativeBody,
  unreadBlocksBody,
  unservedDecisionsBody,
} from "./__fixtures__/presentationFixture";
import {
  PROJECT_STATE_KEPT_SOURCE,
  PROJECT_STATE_SOURCE,
} from "./_lib/homeLens";
import { HOME_REFRESH_ACTION, HOME_REFRESH_ID } from "./_components/HomeLens";

/**
 * The transport `fetchProjectState` reads through. Every answer is a FRESH
 * `Response`: a body can be read only once.
 */
const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));

// The tenant list the strip names the tenant from — the fixture's tenant,
// whose name carries a client's.
vi.mock("@/contexts/tenant-context", async () => {
  const f = await import("./__fixtures__/presentationFixture");
  return {
    useTenant: () => ({
      tenants: [{ id: f.TENANT_ID, name: f.TENANT_NAME }],
      activeTenantId: f.TENANT_ID,
      loading: false,
      error: null,
    }),
  };
});

// The console's page gate (`PresentationPage`) reads the pathname.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/admin/coord/home",
}));

import CoordHomePage from "./page";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Every caption the page renders in presentation mode. */
const HOME_CAPTIONS: CaptionKey[] = [
  "coordination-overview.page",
  "coordination-overview.strip",
  "coordination-overview.needs-you",
  "coordination-overview.degrading",
  "coordination-overview.on-track",
  "coordination-overview.correct",
  "coordination-overview.does-not-know",
];

/** The six regions, as their captions and testids name them. */
const REGIONS = [
  "strip",
  "needs-you",
  "degrading",
  "on-track",
  "correct",
  "does-not-know",
] as const;

function resetEnvironment() {
  httpFetch.mockReset();
  sessionMachineAliases.reset();
  window.localStorage.clear();
  window.sessionStorage.clear();
}

/** The page in presentation mode over `body`, once its read has landed. */
async function renderPresenting(
  body: unknown
): Promise<PresentationRenderResult> {
  httpFetch.mockImplementation(async () => jsonResponse(body));
  const view = renderInPresentationMode(<CoordHomePage />, { scope: SCOPE });
  await waitFor(() => expect(httpFetch).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
  );
  return view;
}

/** The fixture's identifiers found anywhere in the DOM — text AND attributes. */
function leakedIdentifiers(): string[] {
  const html = document.body.innerHTML.toLowerCase();
  return MUST_NOT_APPEAR.filter((needle) =>
    html.includes(needle.toLowerCase())
  );
}

/**
 * Run `check` on the page as rendered, then behind every disclosure: the
 * recently-cleared panel opened, then every record row expanded in turn (a
 * list keeps one row open, so each is checked open on its own).
 */
function checkBehindEveryDisclosure(check: () => void) {
  check();
  const cleared = screen.queryByTestId("coord-home.degrading.cleared");
  if (cleared) {
    fireEvent.click(
      within(cleared).getByRole("button", { name: /Recently cleared/ })
    );
    check();
  }
  const rows = [...document.querySelectorAll("[data-console-row]")];
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    if (row.getAttribute("aria-expanded") !== "true") fireEvent.click(row);
    check();
  }
}

/** Expand the record row in `region` whose line shows `text`. */
function expandRow(region: HTMLElement, text: string | RegExp) {
  const row = [...region.querySelectorAll("[data-console-row]")].find((r) =>
    typeof text === "string"
      ? (r.textContent ?? "").includes(text)
      : text.test(r.textContent ?? "")
  );
  if (!row) throw new Error(`no row showing ${String(text)}`);
  if (row.getAttribute("aria-expanded") !== "true") fireEvent.click(row);
  // `RecordRow`'s own wrapper: the line, and its detail once expanded.
  return row.parentElement as HTMLElement;
}

/** The provenance chips a region's caption carries. */
function regionChips(region: (typeof REGIONS)[number]): HTMLElement[] {
  const caption = document.querySelector<HTMLElement>(
    `[data-presentation-section="coordination-overview.${region}"]`
  );
  if (!caption) throw new Error(`region ${region} has no caption`);
  return [...caption.querySelectorAll<HTMLElement>("[data-provenance]")];
}

/**
 * Controls in `root` an evaluator could use to change something: enabled,
 * and neither navigation-only, a link, nor a pure disclosure.
 */
function writeControlsIn(root: Element): Element[] {
  return [
    ...root.querySelectorAll(
      'button, input, select, textarea, summary, a[href], [contenteditable], [role="button"], [role="switch"], [role="checkbox"], [role="combobox"], [role="menuitem"]'
    ),
  ].filter((el) => {
    if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true")
      return false;
    if (el.hasAttribute(NAVIGATION_ONLY_ATTRIBUTE)) return false;
    if (el.matches("a[href]")) return false;
    const popup = el.getAttribute("aria-haspopup");
    const disclosure =
      el.hasAttribute("aria-expanded") &&
      (popup === null || popup === "false") &&
      el.tagName.toLowerCase() === "button";
    return !disclosure;
  });
}

describe("/admin/coord/home?present=1 — safe to show an outsider", () => {
  beforeEach(resetEnvironment);

  it("over every carrier: no write control, no cost, no identity, every caption — behind every disclosure", async () => {
    const view = await renderPresenting(fullBody());

    // The carriers ARE on the page — so their identifiers' absence below is
    // redaction, not an empty render.
    expect(screen.getAllByTestId("coord-home.needs-you.row")).toHaveLength(3);
    expect(
      screen.getAllByTestId("coord-home.degrading.degrading")
    ).toHaveLength(6);
    expect(screen.getAllByTestId("coord-home.degrading.declared")).toHaveLength(
      1
    );
    expect(screen.getAllByTestId("coord-home.on-track.group")).toHaveLength(4);
    expect(screen.getAllByTestId("coord-home.does-not-know.row")).toHaveLength(
      4
    );
    expect(
      document.querySelectorAll('[data-redacted="true"]').length
    ).toBeGreaterThanOrEqual(8);
    // ...and what the scope clears still shows: the first-party repository's
    // merge-train headline and name.
    expect(screen.getByText(FIRST_PARTY_HEADLINE)).toBeInTheDocument();
    expect(screen.getByTestId("coord-home.degrading")).toHaveTextContent(
      FIRST_PARTY_REPO
    );

    checkBehindEveryDisclosure(() => {
      expectPresentationSafe(view, {
        captions: HOME_CAPTIONS,
        forbidden: MUST_NOT_APPEAR,
      });
      expect(leakedIdentifiers(), "identifiers in the DOM").toEqual([]);
    });
    // Behind the first-party repository's disclosure: its own unit is
    // named; the shared one and the one a cut-short foreign list may hide
    // are not.
    const own = expandRow(
      screen.getByTestId("coord-home.on-track"),
      FIRST_PARTY_REPO
    );
    expect(own).toHaveTextContent(FIRST_PARTY_UNIT_TITLE);
    expect(document.body.textContent).not.toContain(SHARED_UNIT_TITLE);
    expect(document.body.textContent).not.toContain(HIDDEN_UNIT_TITLE);
    expectPresentationSafe(view, {
      captions: HOME_CAPTIONS,
      forbidden: MUST_NOT_APPEAR,
    });
  });

  it("when coord could not read its blocks: each says so, and coord's error chain is never quoted", async () => {
    const view = await renderPresenting(unreadBlocksBody());
    // The page never quotes the needs block's error, in either mode.
    const needs = screen.getByTestId("coord-home.needs-you.not-read");
    expect(needs).toHaveTextContent(/could not read/);
    expect(needs.textContent).not.toMatch(/acme|error/i);
    for (const block of ["degrading", "on-track"]) {
      const notRead = screen.getByTestId(`coord-home.${block}.not-read`);
      expect(notRead).toHaveTextContent(/could not read/);
      expect(
        within(notRead).getByTestId(
          `coord-home.${block}.not-read.error-withheld`
        )
      ).toHaveTextContent(
        `Coord reported an error. ${FAILURE_SENTENCE_WITHHELD}`
      );
      // The operator's disclosure quoting the chain is not rendered at all.
      expect(
        within(notRead).queryByTestId(`coord-home.${block}.not-read.error`)
      ).toBeNull();
    }
    // The initiative's parse error is a descriptor.
    const initiative = screen.getByTestId("coord-home.on-track.initiative");
    expect(initiative).toHaveTextContent(/could not be parsed: Reason · /);
    checkBehindEveryDisclosure(() => {
      expectPresentationSafe(view, {
        captions: HOME_CAPTIONS,
        forbidden: MUST_NOT_APPEAR,
      });
      expect(leakedIdentifiers()).toEqual([]);
    });
  });

  it("when no initiative is live: coord's reason is a descriptor", async () => {
    const view = await renderPresenting(noLiveInitiativeBody());
    const initiative = screen.getByTestId("coord-home.on-track.initiative");
    expect(initiative).toHaveTextContent(
      /No live initiative — Reason · no live initiative · /
    );
    expectPresentationSafe(view, {
      captions: HOME_CAPTIONS,
      forbidden: MUST_NOT_APPEAR,
    });
    expect(leakedIdentifiers()).toEqual([]);
  });

  it("when coord counted decisions but served none: the way to them is text, not a link out of the lens", async () => {
    const view = await renderPresenting(unservedDecisionsBody());
    const unserved = screen.getByTestId("coord-home.needs-you.unserved");
    expect(unserved).toHaveTextContent(/Coord counted 2 decisions/);
    expect(within(unserved).queryByRole("link")).toBeNull();
    expectPresentationSafe(view, {
      captions: HOME_CAPTIONS,
      forbidden: MUST_NOT_APPEAR,
    });
  });

  it("before any read lands: every region is UNKNOWN, dated UNKNOWN", async () => {
    httpFetch.mockReturnValue(new Promise(() => {}));
    const view = renderInPresentationMode(<CoordHomePage />, { scope: SCOPE });
    await waitFor(() => expect(httpFetch).toHaveBeenCalled());
    for (const region of REGIONS) {
      const chips = regionChips(region);
      expect(chips, region).toHaveLength(1);
      expect(chips[0]).toHaveAttribute("data-provenance-known", "false");
      expect(chips[0]).toHaveTextContent("as of UNKNOWN");
      expect(chips[0]).toHaveClass(...UNKNOWN_AMBER.split(" "));
    }
    expectPresentationSafe(view, { captions: HOME_CAPTIONS });
  });

  it("when the first read fails: it says so in fixed words, never in the failure's own text", async () => {
    httpFetch.mockRejectedValue(new Error(REFRESH_FAILURE));
    const view = renderInPresentationMode(<CoordHomePage />, { scope: SCOPE });
    await waitFor(() =>
      expect(screen.getByTestId("coord-home.unread")).toHaveTextContent(
        `could not be read: ${FAILURE_REASON_WITHHELD}.`
      )
    );
    expect(document.body.textContent).not.toMatch(/globex|coord\.globex/i);
    expectPresentationSafe(view, {
      captions: HOME_CAPTIONS,
      forbidden: MUST_NOT_APPEAR,
    });
    expect(leakedIdentifiers()).toEqual([]);
  });
});

describe("/admin/coord/home?present=1 — each region: caption, provenance, redaction", () => {
  beforeEach(resetEnvironment);

  it("captions every region and dates its figures by coord's answer", async () => {
    const body = fullBody();
    const view = await renderPresenting(body);
    for (const region of REGIONS) {
      const caption = document.querySelector<HTMLElement>(
        `[data-presentation-section="coordination-overview.${region}"]`
      )!;
      // Title, one sentence and why it matters — before the region's data.
      expect(
        caption.querySelector('[data-caption-part="one-liner"]'),
        region
      ).not.toBeNull();
      expect(
        caption.querySelector('[data-caption-part="why-it-matters"]'),
        region
      ).not.toBeNull();
      const chips = regionChips(region);
      expect(chips, region).toHaveLength(1);
      expect(chips[0]).toHaveTextContent(`source: ${PROJECT_STATE_SOURCE}`);
      expect(chips[0]).toHaveAttribute("data-provenance-known", "true");
      expect(chips[0]).toHaveTextContent(/as of (under a minute|\d+m) ago/);
      // Dated by coord's answer, which the chip's title states.
      expect(chips[0].getAttribute("title")).toMatch(
        /^Source: coord's project state\. As of /
      );
    }
    // The caption leads its region: the strip's comes before the strip, the
    // others open their section.
    const stripCaption = screen.getByTestId("coord-home.strip.caption");
    expect(
      stripCaption.compareDocumentPosition(
        screen.getByTestId("coord-home.strip")
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    for (const region of REGIONS.slice(1)) {
      const section = screen.getByTestId(`coord-home.${region}`);
      expect(section.firstElementChild).toBe(
        screen.getByTestId(`coord-home.${region}.caption`)
      );
    }
    expectPresentationSafe(view, { captions: HOME_CAPTIONS });
  });

  it("strip: the tenant's name is withheld and its id is not even a title", async () => {
    const view = await renderPresenting(fullBody());
    const tenant = screen.getByTestId("coord-home.strip.tenant");
    expect(tenant).not.toHaveAttribute("title");
    // Its kind alone: a tenant has no area, status or age on this page.
    expect(tenant).toHaveTextContent(/^Tenant: Project$/);
    expect(tenant.querySelector('[data-redacted="true"]')).not.toBeNull();
    expect(tenant.textContent).not.toContain(TENANT_NAME);
    expectPresentationSafe(view, { forbidden: [TENANT_NAME, TENANT_ID] });
  });

  it("needs you: every text of a decision is its descriptor, its ids are gone, and answering it is not offered", async () => {
    const view = await renderPresenting(fullBody());
    const region = screen.getByTestId("coord-home.needs-you");
    // The decision kinds: coord's own bucket in the table's words; the two
    // kinds coord parsed out of question text — one naming a client, one
    // naming no one — folded into fixed words with their summed count.
    expect(
      screen.getByTestId("coord-home.needs-you.by-domain")
    ).toHaveTextContent(
      /^By kind of decision: operator approval gate 1 · kinds not named here 2$/
    );
    const [question, gate] = screen.getAllByTestId("coord-home.needs-you.row");
    expect(question).toHaveTextContent(/Question · area unknown · decide · /);
    expect(gate).toHaveTextContent(/Approval · area unknown · approval · /);
    // The collapsed reason, and its title, are the recommendation's descriptor.
    const reason = within(question!).getByTestId("row-reason");
    expect(reason.textContent).toMatch(/^Recommendation · /);
    expect(reason.getAttribute("title")).toMatch(/^Recommendation · /);
    const detail = expandRow(region, /Question · /);
    expect(detail).toHaveTextContent(/Recommended: Recommendation · /);
    expect(detail).toHaveTextContent(/If you overturn it: Consequence · /);
    expect(detail).toHaveTextContent(/Options: Options · /);
    // The blocked unit is a descriptor, and not a link (its URL is its slug);
    // a phase that is not a number is withheld.
    // The unit's own fact — it is blocked — not the question's status or
    // age, which are another referent's.
    expect(detail).toHaveTextContent(
      /Blocks: Work unit · area unknown · blocked · age unknown, phase withheld/
    );
    expect(within(detail).queryByRole("link")).toBeNull();
    expect(detail.querySelector("[data-lens-link]")).toBeNull();
    // Answering is the operator's: no link, no sentence about it.
    expect(screen.queryByTestId("coord-home.needs-you.answer")).toBeNull();
    expect(region.textContent).not.toMatch(/Answer it|served no page/);
    // R8's raw line (the question's id) is not rendered.
    expect(detail.querySelector("[data-console-raw]")).toBeNull();
    // A numeric phase reads as itself.
    expect(expandRow(region, /Approval · /)).toHaveTextContent(
      /Blocks: a piece of work, phase 3/
    );
    expectPresentationSafe(view, {
      forbidden: [QUESTION_ID, GATE_ID, "acme", "globex"],
    });
  });

  it("degrading: machines are aliases, a foreign headline is withheld, the first-party one shows", async () => {
    const view = await renderPresenting(fullBody());
    const region = screen.getByTestId("coord-home.degrading");
    const rows = within(region).getAllByTestId(
      "coord-home.degrading.degrading"
    );
    // The machine's row: its headline withheld, its subject an alias.
    const machine = rows.find((r) => /runner/.test(r.textContent ?? ""))!;
    expect(machine).toHaveTextContent(/Degradation · runner · degrading · /);
    expect(within(machine).getByTestId("row-reason")).toHaveTextContent(
      /^Machine A$/
    );
    // The drained machine is another letter, on its declared row.
    expect(
      within(screen.getByTestId("coord-home.degrading.declared")).getByTestId(
        "row-reason"
      )
    ).toHaveTextContent(/^Machine B$/);
    // A foreign repository's row: headline and subject both withheld.
    const foreign = rows.find((r) =>
      /Repository · /.test(r.textContent ?? "")
    )!;
    expect(foreign).toHaveTextContent(/Degradation · merge train · degrading/);
    // The first-party repository's row shows both.
    const own = rows.find((r) =>
      (r.textContent ?? "").includes(FIRST_PARTY_REPO)
    )!;
    expect(own).toHaveTextContent(FIRST_PARTY_HEADLINE);
    // A cloud resource and an alert key: descriptors.
    expect(region).toHaveTextContent(/Service · cloud service · degrading/);
    expect(region).toHaveTextContent(/Alert · credential · degrading/);
    // Both services — one of them NAMED like a first-party repository — are
    // services, not repositories: only coord's `repo` subject binds a
    // repository, so neither the headline nor the subject shows.
    const services = rows.filter((r) =>
      /^cloud serviceDegradation · cloud service · degrading/.test(
        r.textContent ?? ""
      )
    );
    expect(services).toHaveLength(2);
    for (const service of services) {
      expect(within(service).getByTestId("row-reason")).toHaveTextContent(
        /^Service · cloud service · degrading · /
      );
    }
    expect(region.textContent).not.toContain(FIRST_PARTY_SHAPED_SERVICE);
    // The gap sentence keeps its words and drops coord's reason (the title).
    const gap = screen.getByTestId("coord-home.degrading.incomplete");
    expect(gap).toHaveTextContent(/Incomplete view — /);
    expect(gap).not.toHaveAttribute("title");
    // Watcher names are not even a title.
    for (const li of screen
      .getByTestId("coord-home.degrading.planes")
      .querySelectorAll("li")) {
      expect(li).not.toHaveAttribute("title");
    }
    // The detail: no raw line, and the drill keeps the presentation.
    const detail = expandRow(region, /Degradation · runner · degrading/);
    expect(detail.querySelector("[data-console-raw]")).toBeNull();
    expect(
      within(detail).getByRole("link", { name: /Open devops/ })
    ).toHaveAttribute("href", "/admin/coord/devops?present=1");
    expectPresentationSafe(view, {
      forbidden: [HOST_BUILD, FIRST_PARTY_SHAPED_SERVICE, "acme", "globex"],
    });
  });

  it("on track: a repository and a unit show only when the scope clears every repository they belong to", async () => {
    const view = await renderPresenting(fullBody());
    const region = screen.getByTestId("coord-home.on-track");
    const groups = within(region).getAllByTestId("coord-home.on-track.group");
    const identities = groups.map(
      (g) => g.querySelector("[data-console-row] > span")?.textContent ?? ""
    );
    // The first-party repository is named; the foreign one and the bare one
    // (no owner to vouch for) are descriptors.
    expect(identities).toContain(FIRST_PARTY_REPO);
    // ...and the descriptor is the kind alone, short enough for the chip.
    expect(identities.filter((i) => i === "Repository")).toHaveLength(2);
    expect(identities).toContain("no repo named");
    // Its detail names it; the foreign group's says "this repository".
    const own = expandRow(region, FIRST_PARTY_REPO);
    expect(own).toHaveTextContent(`Work units that name ${FIRST_PARTY_REPO}.`);
    expect(own).toHaveTextContent(FIRST_PARTY_UNIT_TITLE);
    // A shared unit, and one a cut-short foreign list may hide: withheld, and
    // not linked.
    expect(own).not.toHaveTextContent(SHARED_UNIT_TITLE);
    expect(own).not.toHaveTextContent(HIDDEN_UNIT_TITLE);
    expect(own).toHaveTextContent(/Work unit · area unknown · waiting · /);
    expect(within(own).queryByRole("link")).toBeNull();
    // A withheld unit is never handed to a link at all — its URL carries the
    // slug its descriptor withholds — while the unit the scope clears is
    // (plain text today: its page is not presentation-ready yet).
    const unitNames = (redacted: "true" | "false") => [
      ...own.querySelectorAll(
        `[data-testid^="coord-home.on-track.named."] [data-redacted="${redacted}"]`
      ),
    ];
    expect(unitNames("true").length).toBeGreaterThanOrEqual(2);
    for (const name of unitNames("true")) {
      expect(name.closest("[data-lens-link]")).toBeNull();
    }
    expect(unitNames("false").map((n) => n.textContent)).toEqual([
      FIRST_PARTY_UNIT_TITLE,
    ]);
    expect(unitNames("false")[0]!.closest("[data-lens-link]")).not.toBeNull();
    const foreign = expandRow(region, /^Repository/);
    expect(foreign).toHaveTextContent("Work units that name this repository.");
    // The initiative: items and keys are descriptors, the end date (not a
    // date) is withheld, the start date (an ISO date) shows.
    const initiative = screen.getByTestId("coord-home.on-track.initiative");
    expect(initiative).toHaveTextContent(
      /Status live · from 2026-10-01 · ends withheld/
    );
    expect(
      within(initiative).getByTestId("coord-home.on-track.initiative.in-scope")
    ).toHaveTextContent(/Initiative item · in scope/);
    expect(
      screen.getByTestId("coord-home.on-track.initiative.unknown-key")
    ).toHaveTextContent(/\(Item keys · not listed\)/);
    expectPresentationSafe(view, { forbidden: MUST_NOT_APPEAR });
  });

  it("on track: an initiative status a person typed is worded live or not, never quoted", async () => {
    const body = fullBody();
    const view = await renderPresenting({
      ...body,
      on_track: {
        ...body.on_track,
        initiative: {
          ...body.on_track.initiative,
          status: "paused for the Globex audit",
          alignment: "unknown",
          reason: "no_declared_link",
        },
      },
    });
    expect(
      screen.getByTestId("coord-home.on-track.initiative")
    ).toHaveTextContent(/^Current initiativeStatus not live · from 2026-10-01/);
    expectPresentationSafe(view, { forbidden: MUST_NOT_APPEAR });
    expect(leakedIdentifiers()).toEqual([]);
  });

  it("correct: the row and its why; coord's reason token is not rendered", async () => {
    const view = await renderPresenting(fullBody());
    const region = screen.getByTestId("coord-home.correct");
    expect(region).toHaveTextContent(
      /Not measured — no trust-calibration source/
    );
    const detail = expandRow(region, /Not measured/);
    expect(detail).toHaveTextContent(/survives independent checking/);
    expect(detail.querySelector("[data-console-raw]")).toBeNull();
    expectPresentationSafe(view, {
      forbidden: ["verification_metrics_door_absent"],
    });
  });

  it("does not know: sources in words with no raw id, and coord's reasons as descriptors", async () => {
    const view = await renderPresenting(fullBody());
    const region = screen.getByTestId("coord-home.does-not-know");
    for (const label of region.querySelectorAll(
      "[data-console-row] span[title]"
    )) {
      // Only RowTime's time and the reason line carry a title; never a raw id.
      expect(label.getAttribute("title")).not.toMatch(
        /work_units|watcher:|fleet_health/
      );
    }
    expect(region).toHaveTextContent("Watcher feeding runner");
    const detail = expandRow(region, "Work units");
    expect(detail).toHaveTextContent(
      /Why excluded: Reason · excluded · /
    );
    expect(detail.querySelector("[data-console-raw]")).toBeNull();
    // A source coord reported an error for says so — and that it is withheld,
    // not that it is quoted on a line that is not there.
    const failed = expandRow(region, "Machines in the fleet");
    expect(failed).toHaveTextContent(
      `Coord reported an error. ${FAILURE_SENTENCE_WITHHELD}`
    );
    expect(failed).not.toHaveTextContent(/quoted on the last line/);
    expectPresentationSafe(view, { forbidden: MUST_NOT_APPEAR });
  });
});

describe("/admin/coord/home?present=1 — Correct? shows no write control", () => {
  beforeEach(resetEnvironment);

  it("offers only the disclosure of its own reading, registers no write action, and keeps its raw line off", async () => {
    const view = await renderPresenting(fullBody());
    const region = screen.getByTestId("coord-home.correct");
    expandRow(region, /Not measured/);
    // The only control in the region is the row's own disclosure.
    const controls = region.querySelectorAll(
      "button, a[href], input, select, textarea"
    );
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute("aria-expanded", "true");
    expect(writeControlsIn(region)).toEqual([]);
    // Nothing the region renders registers a write or destructive action.
    if (!("registry" in view.uiBridge)) throw new Error("registry not read");
    const inRegion = view.uiBridge.registry
      .getAllElements()
      .filter((e) => e.element && region.contains(e.element));
    for (const e of inRegion) {
      for (const action of Object.values(e.customActions ?? {})) {
        expect(action.effect, `${e.id}.${action.id}`).toBe("read");
      }
    }
    expect(region.querySelector("[data-console-raw]")).toBeNull();
    expectPresentationSafe(view, { captions: HOME_CAPTIONS });
  });
});

describe("/admin/coord/home?present=1 — a kept reading after a failed refresh", () => {
  beforeEach(resetEnvironment);

  async function failRefresh() {
    httpFetch.mockRejectedValueOnce(new Error(REFRESH_FAILURE));
    await act(async () => {
      fireEvent.click(screen.getByTestId(HOME_REFRESH_ID));
    });
    await waitFor(() =>
      expect(screen.getByTestId("coord-home.strip")).toHaveAttribute(
        "data-stale",
        "true"
      )
    );
  }

  it("leads with the failure in fixed words, names the reading as the last one, and dates it by its read", async () => {
    const body = fullBody();
    const view = await renderPresenting(body);
    expect(screen.queryByTestId("coord-home.kept-reading")).toBeNull();
    await failRefresh();

    // The failure leads, before the strip and every region.
    const notice = screen.getByTestId("coord-home.kept-reading");
    expect(notice).toHaveTextContent(
      `The latest read of coord's project state failed (${FAILURE_REASON_WITHHELD}). Everything below is its last reading, not a current one.`
    );
    expect(
      notice.compareDocumentPosition(screen.getByTestId("coord-home.strip")) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    // Dated by its read: the notice's chip and every region's chip name the
    // last read, and their time is the answer's, known — never now.
    const chips = [
      ...notice.querySelectorAll<HTMLElement>("[data-provenance]"),
      ...REGIONS.flatMap(regionChips),
    ];
    expect(chips).toHaveLength(REGIONS.length + 1);
    for (const chip of chips) {
      expect(chip).toHaveTextContent(`source: ${PROJECT_STATE_KEPT_SOURCE}`);
      expect(chip).toHaveAttribute("data-provenance-known", "true");
      expect(chip).toHaveTextContent(/as of \d+m ago/);
      expect(chip.textContent).not.toMatch(/under a minute/);
    }
    // Never headed live: the strip says the reading is the last good one, and
    // its failure is the fixed words too.
    const strip = screen.getByTestId("coord-home.strip");
    expect(strip).toHaveTextContent(/at the last good read/);
    expect(strip).toHaveTextContent(
      `Last failure: ${FAILURE_REASON_WITHHELD}.`
    );
    expect(document.body.textContent).not.toContain("coord.globex.internal");
    expectPresentationSafe(view, {
      captions: HOME_CAPTIONS,
      forbidden: MUST_NOT_APPEAR,
    });
    expect(leakedIdentifiers()).toEqual([]);
  });

  it("(control) the operator reads the same failure in its own words, with no notice and no chip", async () => {
    httpFetch.mockImplementation(async () => jsonResponse(fullBody()));
    render(
      <FixedPresentationMode presenting={false}>
        <CoordHomePage />
      </FixedPresentationMode>
    );
    await waitFor(() =>
      expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
    );
    await failRefresh();
    expect(screen.getByTestId("coord-home.strip")).toHaveTextContent(
      "coord.globex.internal"
    );
    expect(screen.queryByTestId("coord-home.kept-reading")).toBeNull();
    expect(document.querySelector("[data-provenance]")).toBeNull();
  });
});

describe("/admin/coord/home — an open row is the record that was opened", () => {
  beforeEach(resetEnvironment);

  /** The needs-you rows' clickable lines, top to bottom. */
  function needsRows(): Element[] {
    return [
      ...screen
        .getByTestId("coord-home.needs-you")
        .querySelectorAll("[data-console-row]"),
    ];
  }

  it.each([
    ["while presenting", true],
    ["for the operator (#1999's own behaviour)", false],
  ] as const)(
    "%s: a poll that removes the row above the open one never opens another record",
    async (_mode, presenting) => {
      httpFetch.mockImplementation(async () => jsonResponse(fullBody()));
      const view = presenting
        ? renderInPresentationMode(<CoordHomePage />, { scope: SCOPE })
        : render(
            <FixedPresentationMode presenting={false}>
              <CoordHomePage />
            </FixedPresentationMode>
          );
      await waitFor(() => expect(needsRows()).toHaveLength(3));
      // Open the approval, the second row.
      fireEvent.click(needsRows()[1]!);
      expect(needsRows()[1]).toHaveAttribute("aria-expanded", "true");

      // The next poll: the oldest question was answered, so the approval
      // moves up and the open question takes its place.
      httpFetch.mockImplementation(async () =>
        jsonResponse(firstDecisionAnsweredBody())
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId(HOME_REFRESH_ID));
      });
      await waitFor(() => expect(needsRows()).toHaveLength(2));
      const [approval, question] = needsRows();
      expect(approval).toHaveTextContent(
        presenting ? /Approval · / : /Approve the deploy/
      );
      // The question now in the open row's place is not shown as opened —
      // its detail would read as the approval the viewer opened.
      expect(question).not.toHaveAttribute("aria-expanded", "true");
      // Whatever stays open is the approval itself (for the operator, a key
      // carrying its position collapses it; presenting does the same).
      expect(
        needsRows().filter((r) => r.getAttribute("aria-expanded") === "true")
      ).toEqual(
        approval!.getAttribute("aria-expanded") === "true" ? [approval] : []
      );
      if ("uiBridge" in view) {
        expectPresentationSafe(view, { forbidden: MUST_NOT_APPEAR });
      }
    }
  );
});

describe("/admin/coord/home — the refresh is a read, registered where it renders", () => {
  beforeEach(resetEnvironment);

  it("registers the refresh button itself, its one action declared read, and pressing it re-reads", async () => {
    const view = await renderPresenting(fullBody());
    if (!("registry" in view.uiBridge)) throw new Error("registry not read");
    const button = screen.getByTestId(HOME_REFRESH_ID);
    expect(button).toHaveAttribute(NAVIGATION_ONLY_ATTRIBUTE);
    const element = view.uiBridge.registry
      .getAllElements()
      .find((e) => e.id === HOME_REFRESH_ID);
    expect(element, "the refresh registration").toBeDefined();
    expect(element!.element).toBe(button);
    expect(
      Object.values(element!.customActions ?? {}).map((a) => [a.id, a.effect])
    ).toEqual([[HOME_REFRESH_ACTION, "read"]]);
    // Every registration the page makes declares a read.
    for (const e of view.uiBridge.registry.getAllElements()) {
      for (const action of Object.values(e.customActions ?? {})) {
        expect(action.effect, `${e.id}.${action.id}`).toBe("read");
      }
    }
    // Firing the action re-reads, like the press.
    const calls = httpFetch.mock.calls.length;
    const action = (element!.customActions ?? {})[HOME_REFRESH_ACTION] as {
      handler: () => Promise<unknown>;
    };
    await act(async () => {
      await action.handler();
    });
    expect(httpFetch.mock.calls.length).toBe(calls + 1);
    expectPresentationSafe(view, { captions: HOME_CAPTIONS });
  });
});

describe("/admin/coord/home?present=1 — the console's page gate renders it", () => {
  beforeEach(resetEnvironment);

  it("is registered presentation-ready, so PresentationPage shows the page instead of withholding it", async () => {
    // The registration (`presentationReadiness.ts`) is what this file is the
    // proof of. Rendered bare, every test above would pass for a page the
    // console never shows: without the entry the layout's gate swaps it for
    // "Shown in the operator view only".
    expect(isPresentationReady("/admin/coord/home")).toBe(true);
    httpFetch.mockImplementation(async () => jsonResponse(fullBody()));
    renderInPresentationMode(
      <PresentationPage>
        <CoordHomePage />
      </PresentationPage>,
      { scope: SCOPE }
    );
    await waitFor(() =>
      expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
    );
    expect(screen.queryByTestId("presentation-withheld-page")).toBeNull();
    expect(screen.queryByText(WITHHELD_PAGE_TITLE)).toBeNull();
    expect(screen.getByTestId("coord-home-page")).toBeInTheDocument();
  });
});

describe("/admin/coord/home for the operator — the console is unchanged", () => {
  beforeEach(resetEnvironment);

  it("shows every carrier verbatim, the raw lines, the titles and the answer link; no captions, no chips", async () => {
    httpFetch.mockImplementation(async () => jsonResponse(fullBody()));
    render(
      <FixedPresentationMode presenting={false}>
        <CoordHomePage />
      </FixedPresentationMode>
    );
    await waitFor(() =>
      expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
    );
    expect(document.querySelector("[data-presentation-caption]")).toBeNull();
    expect(document.querySelector("[data-provenance]")).toBeNull();
    expect(document.querySelector('[data-redacted="true"]')).toBeNull();
    expect(screen.getByTestId("coord-home.strip.tenant")).toHaveTextContent(
      `Tenant: ${TENANT_NAME}`
    );
    expect(screen.getByTestId("coord-home.strip.tenant")).toHaveAttribute(
      "title",
      TENANT_ID
    );
    const needs = screen.getByTestId("coord-home.needs-you");
    expect(needs).toHaveTextContent(
      "Ship the Acme Corp pilot before the audit?"
    );
    expect(
      screen.getByTestId("coord-home.needs-you.by-domain")
    ).toHaveTextContent(
      `By kind of decision: ${CLIENT_DOMAIN} 1 · operator approval gate 1 · quarterly board pack 1`
    );
    const detail = expandRow(needs, "Ship the Acme Corp pilot");
    expect(
      within(detail).getByTestId("coord-home.needs-you.answer")
    ).toHaveAttribute("href", `/admin/coord/questions/${QUESTION_ID}`);
    expect(detail.querySelector("[data-console-raw]")).toHaveTextContent(
      QUESTION_ID
    );
    expect(detail).toHaveTextContent(
      "Blocks: 2026-10-01-acme-pilot-rollout, phase the Acme phase"
    );
    const degrading = screen.getByTestId("coord-home.degrading");
    expect(degrading).toHaveTextContent(HOST_BUILD);
    expect(degrading).toHaveTextContent(
      `A runner stopped answering on ${HOST_BUILD}`
    );
    expect(
      screen.getByTestId("coord-home.degrading.incomplete")
    ).toHaveAttribute("title");
    const onTrack = screen.getByTestId("coord-home.on-track");
    expect(onTrack).toHaveTextContent("acme-partner/secret-repo");
    expect(
      screen.getByTestId("coord-home.on-track.initiative")
    ).toHaveTextContent(
      "Status live · from 2026-10-01 · ends when Acme Corp signs"
    );
    // The operator's row keys are the page's own.
    expect(
      document.querySelector(`[data-row-key*="${QUESTION_ID}"]`)
    ).not.toBeNull();
  });
});
