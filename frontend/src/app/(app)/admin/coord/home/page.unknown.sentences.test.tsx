/**
 * /admin/coord/home: what each UNKNOWN arm SAYS, in both modes.
 *
 * `page.unknown.test.tsx` proves a block that was not read is labelled. This
 * file covers the finer arms inside a block that WAS read: a list coord did not
 * serve, a count it did not state, a field a row came without. Each has a
 * sentence that says so, and each could turn into a calm or confident answer
 * ("none", "0 units", "Nothing is degrading") with the rest of the page still
 * green (served policy `verification-and-evidence` `silent-empty-is-unknown`).
 * So every arm pins its own words and names the answer it must never become.
 *
 * Every case takes {@link calmBody} and changes one thing, and none of these
 * words is the operator's alone unless the case says so: a presentation has to
 * say "unknown" as plainly as the console does.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FixedPresentationMode } from "@/components/presentation";
import { renderInPresentationMode } from "@/test/presentation";
import { UNIT_CLASSES } from "@/components/admin/coord/coordHomeStatus";

const httpFetch = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => httpFetch(...args) },
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({
    tenants: [{ id: TENANT_ID, name: "Qontinui" }],
    activeTenantId: TENANT_ID,
    loading: false,
    error: null,
  }),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/admin/coord/home",
}));

import CoordHomePage from "./page";

const SCOPE = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme"] },
} as const;

const CLASSES = Object.fromEntries(UNIT_CLASSES.map((c) => [c, 1]));
const NOW = () => new Date().toISOString();

type Body = Record<string, unknown>;

/** Every block read and calm. JSON drops an `undefined`, so a field set to one is absent. */
function calmBody(): Body {
  return {
    schema: 1,
    generated_at: NOW(),
    tenant_id: TENANT_ID,
    needs_me: {
      state: "read",
      total: 0,
      omitted: 0,
      items: [],
      retirement: "supported",
    },
    degradations: degradations({}),
    on_track: onTrack({}),
    correctness: { state: "read", reason: null },
    does_not_know: [{ source: "work_units", state: "read", as_of: NOW() }],
  };
}

function degradations(fields: Body): Body {
  return {
    state: "read",
    headline: "none",
    open: [],
    declared: [],
    recently_cleared: [],
    recently_cleared_window_secs: 86_400,
    planes: {},
    ...fields,
  };
}

function onTrack(fields: Body): Body {
  return {
    state: "read",
    totals: { row_count: 1, classes: CLASSES },
    groups: [],
    stall_window_secs: 1_209_600,
    history_not_recorded: 0,
    initiative: { state: "read", alignment: "no_live_initiative" },
    ...fields,
  };
}

function group(fields: Body): Body {
  return {
    key: "qontinui/qontinui-web",
    kind: "repo",
    row_count: 1,
    classes: CLASSES,
    named: {
      stalled: { units: [], omitted: 0 },
      waiting_on_gate: { units: [], omitted: 0 },
    },
    ...fields,
  };
}

const UNIT = {
  slug: "2026-09-05-overview-copy",
  title: "Overview copy pass",
  last_recorded_change_at: "2026-09-02T00:00:00Z",
  age_secs: 86_400,
  age_basis: "last_recorded_change",
};

/** A group whose stalled list names one unit, with `fields` on that list. */
function namedOne(fields: Body): Body {
  return group({
    named: {
      stalled: { units: [UNIT], ...fields },
      waiting_on_gate: { units: [], omitted: 0 },
    },
  });
}

function question(fields: Body): Body {
  return {
    source: "agent_question",
    id: "q-1",
    asked_at: NOW(),
    fork: "Which way?",
    options: [],
    recommendation: "This way",
    if_overturned: "That way",
    ...fields,
  };
}

function needsOne(fields: Body): Body {
  return {
    state: "read",
    total: 1,
    omitted: 0,
    items: [question(fields)],
    retirement: "supported",
  };
}

function openRow(fields: Body): Body {
  return {
    id: "alert:1",
    plane: "runner",
    subject: { kind: "service", name: "a-service", id: "a-service" },
    headline: "A service is down",
    onset_observed_at: NOW(),
    last_seen_at: NOW(),
    age_secs: 60,
    declared: false,
    ...fields,
  };
}

function initiative(fields: Body): Body {
  return onTrack({
    initiative: { state: "read", alignment: "read", in_scope: [], ...fields },
  });
}

interface Arm {
  arm: string;
  /** What changes from {@link calmBody}. */
  body: Body;
  /** The region's testid, read after `open`. */
  region: string;
  /** What to open first: the region's first record row, or the cleared panel. */
  open?: "row" | "cleared";
  says: (string | RegExp)[];
  /** The calm or confident answers this arm must never become. */
  never?: RegExp[];
  /** A sentence on a line the presentation does not render at all. */
  operatorOnly?: boolean;
}

const DEGRADING = "coord-home.degrading";
const ON_TRACK = "coord-home.on-track";
const NEEDS = "coord-home.needs-you";
const INITIATIVE = "coord-home.on-track.initiative";
const DOES_NOT_KNOW = "coord-home.does-not-know";
const TENANT = "coord-home.strip.tenant";

const ARMS: Arm[] = [
  // Degrading
  {
    arm: "a stale block with no rows",
    body: {
      degradations: degradations({ state: "stale", headline: "unknown" }),
    },
    region: DEGRADING,
    says: ["No open degradation was served, but coord cannot say none exist."],
    never: [/Nothing (is|was) degrading/],
  },
  {
    arm: "a stale block's empty cleared list",
    body: {
      degradations: degradations({ state: "stale", headline: "unknown" }),
    },
    region: DEGRADING,
    open: "cleared",
    says: [
      "None served; this view is incomplete, so there may be some.",
      /last 24 h –/,
    ],
    never: [/Nothing cleared/, /last 24 h 0/],
  },
  {
    arm: "no cleared list",
    body: { degradations: degradations({ recently_cleared: undefined }) },
    region: DEGRADING,
    open: "cleared",
    says: [
      "Coord served no list of recently cleared degradations — unknown.",
      /last 24 h –/,
    ],
    never: [/Nothing cleared/, /last 24 h 0/],
  },
  {
    arm: "no open list",
    body: { degradations: degradations({ open: undefined }) },
    region: DEGRADING,
    says: [
      "– open",
      "Coord served no list of open degradations, so this view cannot say whether any exist.",
    ],
    never: [/\b0 open/, /Nothing (is|was) degrading/],
  },
  {
    arm: "no cleared window",
    body: {
      degradations: degradations({ recently_cleared_window_secs: undefined }),
    },
    region: DEGRADING,
    open: "cleared",
    says: [/last window 0/, "Nothing cleared in the last window."],
    never: [/last \d+ ?[hd]/],
  },
  {
    arm: "a row with no plane",
    body: {
      degradations: degradations({
        headline: "degraded",
        open: [openRow({ plane: undefined })],
      }),
    },
    region: DEGRADING,
    says: ["unclassified"],
    never: [/runner/],
  },
  {
    arm: "a row with no headline",
    body: {
      degradations: degradations({
        headline: "degraded",
        open: [openRow({ headline: undefined })],
      }),
    },
    region: DEGRADING,
    says: ["(no headline)"],
  },

  // Needs you
  {
    arm: "a question with no text",
    body: { needs_me: needsOne({ fork: null }) },
    region: NEEDS,
    says: ["(no question text)"],
  },
  {
    arm: "a question with no recommendation, consequence or readable options",
    body: {
      needs_me: needsOne({
        recommendation: null,
        if_overturned: null,
        options: 7,
      }),
    },
    region: NEEDS,
    open: "row",
    says: [
      "Recommended: none given",
      "If you overturn it: not stated",
      "Options: not readable",
    ],
    never: [/If you overturn it: none/],
  },
  {
    arm: "a question with no source",
    body: { needs_me: needsOne({ source: undefined }) },
    region: NEEDS,
    open: "row",
    says: ["source unknown · q-1"],
    never: [/agent_question/],
    operatorOnly: true,
  },

  // The strip
  {
    arm: "coord naming no tenant",
    body: { tenant_id: undefined },
    region: TENANT,
    says: [/^Tenant: not stated by coord$/],
  },
  {
    arm: "a tenant outside the viewer's project list",
    body: { tenant_id: "22222222-2222-2222-2222-222222222222" },
    region: TENANT,
    says: [/^Tenant: not in your project list$/],
  },

  // On track
  {
    arm: "a group served no named lists",
    body: {
      on_track: onTrack({
        groups: [
          group({ named: { stalled: null, waiting_on_gate: undefined } }),
        ],
      }),
    },
    region: ON_TRACK,
    open: "row",
    says: [
      "No recorded change in 14 days: coord served no list — unknown.",
      "Waiting on a condition: coord served no list — unknown.",
    ],
    never: [/: none\./],
  },
  {
    arm: "a named list that does not say what it left out",
    body: { on_track: onTrack({ groups: [namedOne({ omitted: undefined })] }) },
    region: ON_TRACK,
    open: "row",
    says: ["Whether more exist is unknown."],
    never: [/more not named here/],
  },
  {
    arm: "a named list that left units out",
    body: { on_track: onTrack({ groups: [namedOne({ omitted: 3 })] }) },
    region: ON_TRACK,
    open: "row",
    says: ["and 3 more not named here."],
    never: [/Whether more exist/],
  },
  {
    arm: "a named list that left nothing out",
    body: { on_track: onTrack({ groups: [namedOne({ omitted: 0 })] }) },
    region: ON_TRACK,
    open: "row",
    says: [],
    never: [/Whether more exist/, /more not named here/],
  },
  {
    arm: "a group with no count",
    body: {
      on_track: onTrack({
        groups: [group({ row_count: undefined, classes: undefined })],
      }),
    },
    region: ON_TRACK,
    says: ["– units", "shipped –"],
    never: [/\b0 units/, /shipped 0/],
  },
  {
    arm: "no count of work units",
    body: { on_track: onTrack({ totals: { classes: CLASSES } }) },
    region: ON_TRACK,
    says: ["– work units"],
    never: [/\b0 work units/],
  },
  {
    arm: "units with no recorded history",
    body: { on_track: onTrack({ history_not_recorded: 2 }) },
    region: ON_TRACK,
    says: [
      "2 in-progress units have no recorded history, so they are counted in flight rather than judged.",
    ],
  },
  {
    arm: "one unit with no recorded history",
    body: { on_track: onTrack({ history_not_recorded: 1 }) },
    region: ON_TRACK,
    says: [
      "1 in-progress unit has no recorded history, so it is counted in flight rather than judged.",
    ],
  },
  {
    arm: "the unattributed group",
    body: {
      on_track: onTrack({
        groups: [group({ key: null, kind: "unattributed_repo" })],
      }),
    },
    region: ON_TRACK,
    open: "row",
    says: [
      "Work units that name no repository. They are counted here rather than dropped.",
    ],
  },

  // The initiative
  {
    arm: "an initiative with no status or dates",
    body: { on_track: initiative({}) },
    region: INITIATIVE,
    says: ["Status unknown · from unknown · ends unknown ·"],
    never: [/Status live/],
  },
  {
    arm: "an initiative whose status and dates are null",
    body: {
      on_track: initiative({ status: null, starts: null, ends: null }),
    },
    region: INITIATIVE,
    says: ["Status unknown · from unknown · ends unknown ·"],
    never: [/Status live/],
  },
  {
    arm: "an initiative whose status and dates are empty",
    body: { on_track: initiative({ status: "", starts: "", ends: "" }) },
    region: INITIATIVE,
    says: ["Status unknown · from unknown · ends unknown ·"],
    never: [/withheld/, /not live/],
  },
  {
    arm: "an initiative whose status and dates are blank",
    body: { on_track: initiative({ status: "  ", starts: "  ", ends: "\t" }) },
    region: INITIATIVE,
    says: ["Status unknown · from unknown · ends unknown ·"],
    never: [/withheld/, /not live/],
  },
  {
    arm: "an initiative with no in-scope list",
    body: { on_track: initiative({ in_scope: undefined }) },
    region: INITIATIVE,
    says: ["In scope: not served — unknown."],
    never: [/In scope: none/],
  },
  {
    arm: "an unparseable initiative with no reason",
    body: { on_track: onTrack({ initiative: { state: "unparseable" } }) },
    region: INITIATIVE,
    says: [
      "The current initiative document could not be parsed: no reason given.",
    ],
  },
  {
    arm: "an unparseable initiative with an empty reason",
    body: {
      on_track: onTrack({ initiative: { state: "unparseable", error: "" } }),
    },
    region: INITIATIVE,
    says: [
      "The current initiative document could not be parsed: no reason given.",
    ],
  },

  // What this view does not know
  {
    arm: "an empty list of sources",
    body: { does_not_know: [] },
    region: DOES_NOT_KNOW,
    says: ["Coord listed no sources — unknown."],
    never: [/Everything/],
  },
  {
    arm: "a read source with no time, bound or row counts",
    body: { does_not_know: [{ source: "work_units", state: "read" }] },
    region: DOES_NOT_KNOW,
    open: "row",
    says: [
      "Read at an unknown time.",
      "Freshness bound: not stated · Rows considered: not stated · Rows excluded: not stated",
    ],
    never: [/just now/, /Rows considered: 0/],
  },
];

/** Open what the arm reads: the region's first record row, or the cleared panel. */
function openDisclosure(region: string, open: Arm["open"]) {
  if (open === "cleared") {
    fireEvent.click(screen.getByRole("button", { name: /Recently cleared/ }));
  } else if (open === "row") {
    const row = screen.getByTestId(region).querySelector("[data-console-row]");
    if (!row) throw new Error(`no row to open in ${region}`);
    fireEvent.click(row);
  }
}

describe.each([
  ["for the operator", false],
  ["while presenting", true],
] as const)(
  "/admin/coord/home %s: an UNKNOWN arm says so",
  (_mode, presenting) => {
    beforeEach(() => {
      httpFetch.mockReset();
      window.localStorage.clear();
      window.sessionStorage.clear();
    });

    const arms = ARMS.filter((a) => !presenting || !a.operatorOnly);

    it.each(arms.map((a) => [a.arm, a] as const))("%s", async (_name, arm) => {
      const body = { ...calmBody(), ...arm.body };
      httpFetch.mockImplementation(
        async () => new Response(JSON.stringify(body))
      );
      if (presenting) {
        renderInPresentationMode(<CoordHomePage />, { scope: SCOPE });
      } else {
        render(
          <FixedPresentationMode presenting={false}>
            <CoordHomePage />
          </FixedPresentationMode>
        );
      }
      await waitFor(() =>
        expect(
          screen.queryByTestId("coord-home.unread")
        ).not.toBeInTheDocument()
      );
      openDisclosure(arm.region, arm.open);
      const region = screen.getByTestId(arm.region);
      for (const words of arm.says) {
        // jest-dom's own matcher folds whitespace, in a string and for a regex.
        expect(region).toHaveTextContent(words);
      }
      for (const calm of arm.never ?? []) {
        expect(region).not.toHaveTextContent(calm);
      }
    });
  }
);

describe("/admin/coord/home while presenting: a line the operator alone reads", () => {
  it("has no raw line to say a question's source is unknown on", async () => {
    httpFetch.mockReset();
    const body = {
      ...calmBody(),
      needs_me: needsOne({ source: undefined }),
    };
    httpFetch.mockImplementation(
      async () => new Response(JSON.stringify(body))
    );
    renderInPresentationMode(<CoordHomePage />, { scope: SCOPE });
    await waitFor(() =>
      expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
    );
    openDisclosure(NEEDS, "row");
    expect(screen.getByTestId(NEEDS)).not.toHaveTextContent("source unknown");
    expect(screen.getByTestId(NEEDS)).not.toHaveTextContent("q-1");
  });
});
