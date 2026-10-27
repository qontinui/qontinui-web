/**
 * /admin/coord/home: every read failure renders a labelled UNKNOWN.
 *
 * Plan
 * `2026-09-20-what-is-the-state-of-my-projects-and-what-needs-me-is-answerable-from-one-screen`
 * Phase 4. This page may land on a coord that serves the door's on-track and
 * degradation blocks but not yet `needs_me`, so that block is
 * `not_implemented`. It may also land on a deployment where the door, the
 * proxy or the body fails. Served policy `verification-and-evidence`
 * `silent-empty-is-unknown` covers every one of those cases. None may render
 * as a zero, an empty list or a calm state. Each must say it does not know,
 * and say why truthfully.
 *
 * Every case starts from {@link calmBody}. The control test shows that body
 * renders GREEN with "Nothing needs you". So an amber, labelled result below
 * comes from the one thing each case takes away, not from the fixture.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const httpGet = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => httpGet(...args) },
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

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { UNIT_CLASSES } from "@/components/admin/coord/coordHomeStatus";
import CoordHomePage from "./page";

const REGIONS = [
  "coord-home.strip",
  "coord-home.needs-you",
  "coord-home.degrading",
  "coord-home.on-track",
  "coord-home.correct",
  "coord-home.does-not-know",
];

/** Every calm state the page can print, in either tense. */
const CALM = [
  /Nothing need(s|ed) you/,
  /Nothing (is|was) degrading/,
  /^No work units\.$/,
];

const CLASSES = Object.fromEntries(
  UNIT_CLASSES.map((c) => [c, c === "stalled" ? 0 : 1])
);

/** Every block read and calm: the one body the page paints green. */
function calmBody(): Record<string, unknown> {
  return {
    schema: 1,
    generated_at: new Date().toISOString(),
    tenant_id: TENANT_ID,
    scope: "operator",
    on_track: {
      state: "read",
      totals: { row_count: UNIT_CLASSES.length - 1, classes: CLASSES },
      groups: [],
      stall_window_secs: 1_209_600,
      history_not_recorded: 0,
      initiative: {
        state: "read",
        alignment: "no_live_initiative",
        reason: null,
      },
    },
    correctness: { state: "read", reason: null, inputs: {} },
    needs_me: {
      state: "read",
      total: 0,
      omitted: 0,
      items: [],
      retirement: "supported",
    },
    degradations: {
      state: "read",
      headline: "none",
      open: [],
      declared: [],
      recently_cleared: [],
      planes: {},
    },
    does_not_know: [
      { source: "work_units", state: "read", as_of: new Date().toISOString() },
    ],
  };
}

/** `calmBody()` without `key`. */
function without(key: string): Record<string, unknown> {
  const body = calmBody();
  delete body[key];
  return body;
}

/** `calmBody()` with `key` replaced by `value`. */
function replaced(key: string, value: unknown): Record<string, unknown> {
  return { ...calmBody(), [key]: value };
}

/**
 * Render, and wait until the read delivered a view. Every region is on screen
 * before any read (as unknown), so an assertion made before this wait would
 * pass on the page's opening state rather than on the body under test.
 */
async function renderView(body: unknown) {
  httpGet.mockResolvedValue(body);
  render(<CoordHomePage />);
  await waitFor(() => expect(httpGet).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByTestId("coord-home.unread")).not.toBeInTheDocument()
  );
}

/** Render, and wait until the page says its read delivered nothing. */
async function renderUnread(answer: () => void) {
  answer();
  render(<CoordHomePage />);
  await waitFor(() => expect(httpGet).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByTestId("coord-home.unread")).toHaveTextContent(
      "Coord's project state could not be read:"
    )
  );
  return screen.getByTestId("coord-home.unread");
}

function strip() {
  return screen.getByTestId("coord-home.strip.health");
}

function expectNoNeedsYouCalm() {
  expect(screen.queryByText(/Nothing need(s|ed) you/)).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("coord-home.needs-you.empty")
  ).not.toBeInTheDocument();
}

function expectNoDegradingCalm() {
  expect(
    screen.queryByText(/Nothing (is|was) degrading/)
  ).not.toBeInTheDocument();
  expect(
    screen.queryByTestId("coord-home.degrading.empty")
  ).not.toBeInTheDocument();
}

function expectNoCalmState() {
  for (const calm of CALM)
    expect(screen.queryByText(calm)).not.toBeInTheDocument();
  expectNoNeedsYouCalm();
  expectNoDegradingCalm();
}

describe("/admin/coord/home renders every read failure as a labelled UNKNOWN", () => {
  beforeEach(() => {
    httpGet.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("paints the calm body green, with both calm sentences (the control)", async () => {
    await renderView(calmBody());
    expect(strip()).toHaveAttribute("data-health-level", "green");
    expect(strip()).toHaveTextContent(
      "Nothing needs you and nothing is degrading"
    );
    expect(screen.getByTestId("coord-home.needs-you.empty")).toHaveTextContent(
      /^Nothing needs you$/
    );
    expect(screen.getByTestId("coord-home.degrading.empty")).toHaveTextContent(
      /^Nothing is degrading$/
    );
  });

  describe("needs_me absent from the body, or unreadable", () => {
    // The door's contract always includes the key. These pin what the page
    // does with a body that arrives without it: no answer is never "no
    // decisions".
    it.each([
      ["absent", without("needs_me")],
      ["null", replaced("needs_me", null)],
      ["a bare string", replaced("needs_me", "not_implemented")],
      ["an array", replaced("needs_me", [])],
      [
        "an object with no state",
        replaced("needs_me", { total: 0, items: [] }),
      ],
    ])(
      "renders needs_me %s as a labelled unknown, never 'Nothing needs you'",
      async (_shape, body) => {
        await renderView(body);
        const needs = screen.getByTestId("coord-home.needs-you");
        expect(needs).toHaveAttribute("data-block-state", "unknown");
        expect(
          screen.getByTestId("coord-home.needs-you.count")
        ).toHaveTextContent(/^unknown$/);
        // The reason is true for an absent block. It does not say coord
        // answered with something the page failed to recognise.
        expect(
          screen.getByTestId("coord-home.needs-you.not-read")
        ).toHaveTextContent(
          "Not known — coord gave no reading of the decisions waiting on you."
        );
        expect(
          screen.getByTestId("coord-home.strip.needs-you")
        ).toHaveTextContent(/^needs you –$/);
        expect(strip()).toHaveAttribute("data-health-level", "amber");
        expect(strip()).toHaveTextContent(
          "Cannot tell — part of this view is not read"
        );
        expect(strip()).toHaveTextContent("Not read: needs you unknown.");
        expectNoNeedsYouCalm();
      }
    );

    it("renders coord's Phase 1–2 needs_me (not_implemented) as not built yet, never a zero", async () => {
      // What coord serves until the needs_me phase lands. The does_not_know
      // row is the one coord adds beside it.
      const body = replaced("needs_me", { state: "not_implemented" });
      body.does_not_know = [
        ...(body.does_not_know as unknown[]),
        {
          source:
            "needs_me (agent_questions operator audience + operator gates)",
          state: "not_implemented",
          exclusion_reason: "plan Phase 3",
        },
      ];
      await renderView(body);
      const needs = screen.getByTestId("coord-home.needs-you");
      expect(needs).toHaveAttribute("data-block-state", "not_implemented");
      expect(
        screen.getByTestId("coord-home.needs-you.count")
      ).toHaveTextContent(/^not built yet$/);
      expect(
        screen.getByTestId("coord-home.needs-you.not-read")
      ).toHaveTextContent(
        "Not known — coord does not serve the decisions waiting on you on this view yet."
      );
      expect(
        screen.getByTestId("coord-home.strip.needs-you")
      ).toHaveTextContent(/^needs you –$/);
      expect(strip()).toHaveAttribute("data-health-level", "amber");
      expect(strip()).toHaveTextContent(
        "Cannot tell — part of this view is not read"
      );
      expect(strip()).toHaveTextContent("Not read: needs you not built yet.");
      expect(strip()).toHaveTextContent("1 source not read");
      expectNoNeedsYouCalm();
    });
  });

  describe("another block absent from the body", () => {
    it("renders an absent on_track as unknown, with a dash for every count", async () => {
      await renderView(without("on_track"));
      const onTrack = screen.getByTestId("coord-home.on-track");
      expect(onTrack).toHaveAttribute("data-block-state", "unknown");
      for (const cls of UNIT_CLASSES) {
        const stat = screen.getByTestId(`coord-home.on-track.total.${cls}`);
        expect(stat.textContent).toMatch(/–$/);
        expect(stat.textContent).not.toMatch(/\d$/);
      }
      expect(
        screen.getByTestId("coord-home.on-track.not-read")
      ).toHaveTextContent(
        "Not known — coord gave no reading of work-unit progress."
      );
      expect(
        screen.getByTestId("coord-home.on-track.initiative")
      ).toHaveTextContent("Coord served no initiative reading — unknown.");
      expect(
        screen.getByTestId("coord-home.strip.no-change")
      ).toHaveTextContent(/–$/);
      expect(strip()).toHaveAttribute("data-health-level", "amber");
      expect(strip()).toHaveTextContent("Not read: on track unknown.");
      expect(screen.queryByText(/^No work units\.$/)).not.toBeInTheDocument();
    });

    it("renders absent degradations as unknown, never 'Nothing is degrading'", async () => {
      await renderView(without("degradations"));
      const deg = screen.getByTestId("coord-home.degrading");
      expect(deg).toHaveAttribute("data-block-state", "unknown");
      expect(
        screen.getByTestId("coord-home.degrading.not-read")
      ).toHaveTextContent(
        "Not known — coord gave no reading of infrastructure degradations."
      );
      expect(
        screen.getByTestId("coord-home.degrading.planes")
      ).toHaveTextContent("Watcher freshness per area: not served — unknown.");
      expect(screen.getByTestId("coord-home.strip.degraded")).toHaveTextContent(
        /^degraded –$/
      );
      expect(strip()).toHaveAttribute("data-health-level", "amber");
      expect(strip()).toHaveTextContent(
        "Cannot tell — part of this view is not read"
      );
      expect(strip()).toHaveTextContent("Not read: degrading unknown.");
      expectNoDegradingCalm();
    });

    it("renders an absent correctness block as not read, in amber, never as 'no source'", async () => {
      // An absent block says nothing about whether a source exists: only
      // coord's own `verification_metrics_door_absent` reason does.
      await renderView(without("correctness"));
      const correct = screen.getByTestId("coord-home.correct");
      expect(correct).toHaveAttribute("data-block-state", "unknown");
      const row = screen.getByTestId("coord-home.correct.row");
      expect(row).toHaveTextContent(
        "Not known — coord gave no reading of trust calibration."
      );
      expect(correct).not.toHaveTextContent(/no trust-calibration source/);
      expect(
        row.querySelector('[data-status-kind="source_not_read"]')
      ).toHaveTextContent(/^unknown$/);
      expect(strip()).toHaveAttribute("data-health-level", "amber");
      expect(strip()).toHaveTextContent("Not read: correct? unknown.");
    });

    it.each([
      [
        "could_not_read",
        "Not known — coord could not read trust calibration this time; nothing here is a zero.",
        /^could not be read$/,
      ],
      [
        "stale",
        "Incomplete — coord could only partly read trust calibration.",
        /^incomplete or stale$/,
      ],
    ])(
      "renders a %s correctness block as not read, never as 'no source'",
      async (state, sentence, badge) => {
        await renderView(
          replaced("correctness", {
            state,
            reason: "timeout",
            inputs: null,
          })
        );
        const correct = screen.getByTestId("coord-home.correct");
        const row = screen.getByTestId("coord-home.correct.row");
        expect(row).toHaveTextContent(sentence);
        expect(
          row.querySelector('[data-status-kind="source_not_read"]')
        ).toHaveTextContent(badge);
        expect(correct).not.toHaveTextContent(/no trust-calibration source/);
        expect(correct).not.toHaveTextContent(/No source measures it yet/);
        expect(strip()).toHaveAttribute("data-health-level", "amber");
      }
    );

    it("keeps 'no trust-calibration source' for coord's own no-source reason", async () => {
      await renderView(
        replaced("correctness", {
          state: "unknown",
          reason: "verification_metrics_door_absent",
          inputs: null,
        })
      );
      expect(screen.getByTestId("coord-home.correct.row")).toHaveTextContent(
        "Not measured — no trust-calibration source"
      );
    });

    it("renders an absent does_not_know as unknown, not as nothing unknown", async () => {
      await renderView(without("does_not_know"));
      const dnk = screen.getByTestId("coord-home.does-not-know");
      expect(dnk).toHaveTextContent(
        "Coord served no list of the sources it read, so what this view does not know is itself unknown."
      );
      expect(
        screen.getByTestId("coord-home.strip.unknown-sources")
      ).toHaveTextContent(/^unknown sources –$/);
      expect(strip()).toHaveAttribute("data-health-level", "amber");
      expect(strip()).toHaveTextContent(
        "Coord served no list of what it could not read."
      );
    });
  });

  describe("a read that delivered no project state at all", () => {
    /** Every region present, every count a dash, nothing calm. */
    function expectNothingRead() {
      for (const id of REGIONS)
        expect(screen.getByTestId(id)).toBeInTheDocument();
      expect(strip()).toHaveAttribute("data-health-level", "amber");
      for (const id of [
        "coord-home.strip.needs-you",
        "coord-home.strip.degraded",
        "coord-home.strip.no-change",
        "coord-home.strip.unknown-sources",
      ])
        expect(screen.getByTestId(id).textContent).toMatch(/–$/);
      for (const id of [
        "coord-home.needs-you.not-read",
        "coord-home.degrading.not-read",
        "coord-home.on-track.not-read",
      ])
        expect(screen.getByTestId(id)).toHaveTextContent(/^Not known — /);
      expectNoCalmState();
    }

    it.each([
      ["null", null],
      ["an array", []],
      ["a string", "Not Found"],
      ["a number", 0],
      ["a boolean", true],
    ])(
      "says a body that is %s is not a project state, and paints nothing as read",
      async (_shape, body) => {
        const unread = await renderUnread(() =>
          httpGet.mockResolvedValue(body)
        );
        expect(unread).toHaveTextContent(
          "Coord's project state could not be read: coord answered with a body that is not a project state."
        );
        expect(unread).toHaveTextContent(
          "Every count on this page is a dash, not a zero."
        );
        // coord DID answer, so the strip must not say it has not.
        expect(strip()).toHaveTextContent(
          "Cannot tell — coord's project state has not been read"
        );
        expect(strip()).not.toHaveTextContent(/has not answered/);
        expectNothingRead();
      }
    );

    it.each([
      [
        "the proxy relays a coord 500",
        new Error(
          'GET /api/v1/operations/project-state failed: 500 - {"error":"INTERNAL","message":"coord: internal"}'
        ),
        "500",
      ],
      [
        "the proxy cannot reach coord",
        new Error(
          'GET /api/v1/operations/project-state failed: 502 - {"error":"BAD_GATEWAY","message":"coord unreachable"}'
        ),
        "502",
      ],
      [
        "the viewer may not read it",
        new Error(
          'GET /api/v1/operations/project-state failed: 403 - {"error":"FORBIDDEN","message":"not a member"}'
        ),
        "403",
      ],
      [
        "the network failed",
        new TypeError("Failed to fetch"),
        "Failed to fetch",
      ],
      [
        "coord's read deadline passed",
        new Error(
          'GET /api/v1/operations/project-state failed: 503 - {"error":"deadline","budget_ms":8000}'
        ),
        "coord read deadline (8000 ms) exceeded — unknown",
      ],
      [
        "the request timed out",
        new Error(
          "Request timeout - backend may be starting up. Please try again."
        ),
        "Request timeout",
      ],
    ])(
      "names the failure when %s, and paints nothing as read",
      async (_case, err, reason) => {
        const unread = await renderUnread(() => httpGet.mockRejectedValue(err));
        expect(unread).toHaveTextContent(reason);
        expect(unread).toHaveTextContent(
          "Every count on this page is a dash, not a zero."
        );
        expect(strip()).toHaveTextContent(
          "Cannot tell — coord's project state has not been read"
        );
        expectNothingRead();
      }
    );
  });
});
