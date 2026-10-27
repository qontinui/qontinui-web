/**
 * The Completeness matrix's two gauges say what kind of number each one is.
 * The live gauge counts probe answers, fills with the live green, and reads
 * "probing…" while the probe is in flight rather than a 0/N that looks like
 * silence. The built gauge counts manifest CLAIMS, so it is labelled a claim
 * and fills with the claim colour — never the live green.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type {
  RawVerdictResponse,
  SubspaceProbe,
  SubspacesProbeResponse,
  TwinCatalogResponse,
} from "../_lib/types";

/** What the drawer's raw read (`useSubspaceRaw`) holds for one sub-space. */
interface RawRead {
  data?: RawVerdictResponse;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}

const state = vi.hoisted(() => ({
  probe: {
    data: undefined as SubspacesProbeResponse | undefined,
    isLoading: false,
    isError: false,
    error: null as unknown,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
  },
  /** coord's served catalog; `undefined` = not read (the manifest stands in). */
  catalog: undefined as TwinCatalogResponse | undefined,
  /** The drawer's raw read per sub-space id; none made unless listed. */
  raw: {} as Record<string, RawRead>,
}));

vi.mock("../_hooks/useDigitalTwinSubspaces", () => ({
  useDigitalTwinSubspaces: () => state.probe,
}));
vi.mock("../_hooks/useTwinCatalog", () => ({
  useTwinCatalog: () => ({
    data: state.catalog,
    isLoading: false,
    isError: false,
    error: null,
  }),
}));
vi.mock("../_hooks/useSubspaceRaw", () => ({
  // As the real hook: nothing is read unless the drawer enables the read.
  useSubspaceRaw: (id: string | null, enabled: boolean) => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    ...(enabled && id ? state.raw[id] : undefined),
  }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));

import { manifest } from "../_lib/resolve";
import { COUNT_FILLS } from "../_lib/status-presentation";
import {
  MANIFEST_SNAPSHOT_IDS,
  catalogDeclaring,
  outboundEnvelope,
} from "../_lib/test-catalog";
import { CoverageMatrix } from "./CoverageMatrix";

const SNAPSHOT_IDS = manifest.subspaces
  .filter((s) => s.query_kind === "snapshot")
  .map((s) => s.id);

const CLAIMED_BUILT = manifest.subspaces.filter(
  (s) => s.research_status === "implemented" || s.research_status === "partial"
).length;

/** The fill bar inside the gauge with `testId`. */
function gaugeFill(testId: string): HTMLElement {
  const fill = screen
    .getByTestId(testId)
    .querySelector<HTMLElement>('[data-slot="gauge-fill"]');
  if (!fill) throw new Error(`${testId} renders no fill`);
  return fill;
}

function expectFilledWith(fill: HTMLElement, classes: string) {
  for (const c of classes.split(" ")) expect(fill).toHaveClass(c);
}

/** The sub-space drawer's Status field (its label and value). */
function statusOf(drawer: HTMLElement): HTMLElement {
  return within(drawer).getByText("Status").parentElement!;
}

beforeEach(() => {
  // Every snapshot probe answers except deps, which is blind.
  const subspaces: SubspaceProbe[] = SNAPSHOT_IDS.map((id) => ({
    id,
    status: id === "deps" ? "blind" : "implemented",
  }));
  state.probe = {
    data: { subspaces, probed: subspaces.length, restricted: false },
    isLoading: false,
    isError: false,
    error: null,
    // An answer has a read time; the drawer dates its Status by it.
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
  };
  state.catalog = undefined;
  state.raw = {};
});

describe("CoverageMatrix gauges", () => {
  it("labels the built gauge a manifest claim and fills it with the claim colour", () => {
    render(<CoverageMatrix />);
    const built = screen.getByTestId("digital-twin-gauge-built");
    expect(built).toHaveTextContent("sub-spaces built (manifest claim)");
    expect(built).toHaveTextContent(
      `${CLAIMED_BUILT}/${manifest.subspaces.length}`
    );
    const fill = gaugeFill("digital-twin-gauge-built");
    expectFilledWith(fill, COUNT_FILLS.claim);
    expect(fill).not.toHaveClass(COUNT_FILLS.live);
  });

  it("counts the answering probes on the live gauge and fills it with the live colour", () => {
    render(<CoverageMatrix />);
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${SNAPSHOT_IDS.length - 1}/${SNAPSHOT_IDS.length}`
    );
    expectFilledWith(gaugeFill("digital-twin-gauge-live"), COUNT_FILLS.live);
  });

  it("says probing… on the live gauge while the probe is in flight, never 0/N", () => {
    state.probe = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
    };
    render(<CoverageMatrix />);
    const live = screen.getByTestId("digital-twin-gauge-live");
    expect(live).toHaveTextContent("probing…");
    expect(live.textContent).not.toMatch(/\d\/\d/);
    expect(gaugeFill("digital-twin-gauge-live").style.width).toBe("0%");
    // The built gauge is a static claim; it does not wait for the probe.
    expect(screen.getByTestId("digital-twin-gauge-built")).toHaveTextContent(
      `${CLAIMED_BUILT}/${manifest.subspaces.length}`
    );
  });
});

/** A probe response: every id answers `implemented` unless overridden. */
function probesFor(
  ids: readonly string[],
  overrides: Record<string, SubspaceProbe> = {},
  restricted = false
): SubspacesProbeResponse {
  const subspaces: SubspaceProbe[] = ids.map(
    (id) => overrides[id] ?? { id, status: "implemented" }
  );
  return { subspaces, probed: subspaces.length, restricted };
}

/** The probe answered `data`, read just now (an answer has a read time). */
function setProbe(data: SubspacesProbeResponse) {
  state.probe = {
    data,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: Date.now(),
    errorUpdatedAt: 0,
  };
}

describe("CoverageMatrix per-cell access", () => {
  it("renders one refused sub-space as its own Restricted cell, never the access notice", () => {
    setProbe(
      probesFor(SNAPSHOT_IDS, {
        release: { id: "release", status: "restricted" },
      })
    );
    render(<CoverageMatrix />);
    expect(screen.queryByText("Access restricted")).toBeNull();
    const release = screen.getByTestId("digital-twin-cell-release");
    expect(release).toHaveTextContent("Restricted");
    expect(release).not.toHaveTextContent("Error");
    expect(release.getAttribute("title")).toContain("Qontinui-internal");
    // A refused sub-space is not an observer that failed to respond.
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${SNAPSHOT_IDS.length - 1}/${SNAPSHOT_IDS.length - 1}`
    );
    expect(screen.getByTestId("digital-twin-gauge-notes")).toHaveTextContent(
      "1 restricted (not yours to read)"
    );
    // The operator's other cells stay live beside it.
    expect(screen.getByTestId("digital-twin-cell-memory")).toHaveTextContent(
      "Live"
    );
  });

  it("shows the whole-view access notice only when every probe was refused", () => {
    const all = Object.fromEntries(
      SNAPSHOT_IDS.map((id) => [id, { id, status: "restricted" as const }])
    );
    setProbe(probesFor(SNAPSHOT_IDS, all, true));
    render(<CoverageMatrix />);
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
  });

  it("keeps answered cells visible even when the matrix is flagged restricted", () => {
    setProbe(
      probesFor(
        SNAPSHOT_IDS,
        { release: { id: "release", status: "restricted" } },
        true
      )
    );
    render(<CoverageMatrix />);
    expect(screen.queryByText("Access restricted")).toBeNull();
    expect(screen.getByTestId("digital-twin-cell-schema")).toHaveTextContent(
      "Live"
    );
  });
});

describe("CoverageMatrix joined to coord's catalog", () => {
  it("renders the envelope door and a report door as live cells", () => {
    state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
    setProbe(
      probesFor(MANIFEST_SNAPSHOT_IDS, {
        // coord's admin outbound door as it really answers: buckets
        // observed, and no age reported.
        outbound: {
          id: "outbound",
          status: "implemented",
          door_shape: "envelope",
          metrics: outboundEnvelope("burning"),
        },
        // A twin-door verdict that omits its staleness: computed live.
        schema: {
          id: "schema",
          status: "implemented",
          door_shape: "verdict_wrapper",
          metrics: {
            coverage: 1,
            credibility: 0.95,
            posterior: 0.9,
            staleness_seconds: null,
            provenance: "alembic_graph",
            drift_class: "none",
          },
        },
        // A twin-door verdict that reports its staleness: 45s when read.
        release: {
          id: "release",
          status: "implemented",
          door_shape: "verdict_wrapper",
          metrics: {
            coverage: 1,
            credibility: 0.9,
            posterior: 0.9,
            staleness_seconds: 45,
            provenance: "ecs_describe_tasks",
            drift_class: "none",
          },
        },
        worktree: { id: "worktree", status: "served", door_shape: "report" },
      })
    );
    render(<CoverageMatrix />);
    const outbound = screen.getByTestId("digital-twin-cell-outbound");
    expect(outbound).toHaveTextContent("Live");
    expect(outbound).toHaveTextContent("cov 100%");
    // The same missing staleness reads two ways, by the door it came from:
    // the envelope door reported no age (UNKNOWN, on the floor), while the
    // twin door's verdict was computed live.
    const age = (id: string) =>
      screen.getByTestId(`digital-twin-cell-${id}-age`).textContent;
    expect(age("outbound")).toBe("age UNKNOWN");
    expect(screen.getByTestId("digital-twin-cell-outbound-age")).toContainElement(
      within(outbound).getByText("UNKNOWN")
    );
    // An age the cell shows is the reading's when it was read, never an age
    // now: the cell shows the probe's answer some time after that read.
    expect(age("schema")).toBe("live when read");
    expect(age("release")).toBe("45s stale when read");
    const worktree = screen.getByTestId("digital-twin-cell-worktree");
    expect(worktree).toHaveTextContent("Served");
    expect(worktree).not.toHaveTextContent("Partial");
    // The report door is probed, but it is not counted as an observer that
    // is not responding: it leaves the live gauge's denominator.
    const graded = MANIFEST_SNAPSHOT_IDS.length - 1;
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${graded}/${graded}`
    );
    expect(screen.getByTestId("digital-twin-gauge-notes")).toHaveTextContent(
      "1 served (a report, not graded)"
    );
    // The outbound drawer shows the envelope the probe carried: there is no
    // twin-door raw read for an admin door. Its age is UNKNOWN there too.
    fireEvent.click(outbound);
    const drawer = within(screen.getByRole("dialog"));
    expect(drawer.getByTestId("digital-twin-drawer-summary")).toHaveTextContent(
      "Coverage 100%, credibility 95%, from persisted_oplog; coord reported no age for this data, so its freshness when read is UNKNOWN."
    );
    expect(drawer.getByText("Live credibility envelope")).toBeInTheDocument();
    expect(
      drawer.getByText("Freshness when read").parentElement
    ).toHaveTextContent(/^Freshness when readUNKNOWN$/);
  });

  it("names a probe coord declares that the manifest has no row for", () => {
    const catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
    catalog.entries.push({
      ...catalog.entries[0]!,
      id: "zz_new",
      subspace: "zz_new",
    });
    state.catalog = catalog;
    setProbe(probesFor([...MANIFEST_SNAPSHOT_IDS, "zz_new"]));
    render(<CoverageMatrix />);
    expect(
      screen.getByTestId("digital-twin-unlisted-probes")
    ).toHaveTextContent(
      "Declared by coord, not in this page's taxonomy: zz_new"
    );
  });

  it("says Not served by coord for a snapshot row coord does not declare", () => {
    const declared = MANIFEST_SNAPSHOT_IDS.filter((id) => id !== "schema");
    state.catalog = catalogDeclaring(declared);
    setProbe(probesFor(declared));
    render(<CoverageMatrix />);
    const schema = screen.getByTestId("digital-twin-cell-schema");
    expect(schema).toHaveTextContent("Not served by coord");
    expect(schema).not.toHaveTextContent("Error");
    // The live gauge counts only what coord declares.
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${declared.length}/${declared.length}`
    );
  });
});

describe("CoverageMatrix while the probe holds no reading — UNKNOWN, never 0/N", () => {
  const AT = Date.parse("2026-10-23T12:00:00Z");
  const HTTP_502 = new Error(
    "GET /api/v1/digital-twin/subspaces failed: 502 - upstream"
  );
  /** The reason, as a cell's title starts its sentence. */
  const DEGRADED_WORDS =
    "Coord's live probe could not be made: coord could not be reached";

  /** The request failed and no earlier answer is held. */
  function failedRead() {
    state.probe = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: HTTP_502,
      dataUpdatedAt: 0,
      errorUpdatedAt: AT,
    };
  }

  /**
   * HTTP 200 with no probe made: a stand-in error per declared id, each
   * carrying the backend's token for why (`digital_twin.py`
   * `_degraded_matrix`).
   */
  function degradedAnswer(token = "coord_unavailable") {
    state.probe = {
      data: {
        subspaces: SNAPSHOT_IDS.map((id) => ({
          id,
          status: "error",
          error: token,
        })),
        probed: 0,
        restricted: false,
        degraded: true,
      },
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: AT,
      errorUpdatedAt: 0,
    };
  }

  const ARMS = [
    {
      name: "a failed read",
      arrange: failedRead,
      reason: "Coord's live probe could not be read (HTTP 502).",
    },
    {
      name: "a degraded answer",
      arrange: () => degradedAnswer(),
      reason:
        "Coord's live probe could not be made: coord could not be reached.",
    },
  ];

  for (const arm of ARMS) {
    it(`shows the live gauge as UNKNOWN with why after ${arm.name}, with no count and no bar`, () => {
      arm.arrange();
      render(<CoverageMatrix />);
      const live = screen.getByTestId("digital-twin-gauge-live");
      expect(live).toHaveAttribute("data-reading", "unknown");
      expect(live).toHaveTextContent("UNKNOWN");
      expect(live).toHaveTextContent(arm.reason);
      expect(live.textContent).not.toMatch(/\d+\/\d+/);
      // An empty bar would read as a measured zero.
      expect(live.querySelector('[data-slot="gauge-fill"]')).toBeNull();
      // The built gauge is the manifest's claim: no probe stands behind it.
      expect(screen.getByTestId("digital-twin-gauge-built")).toHaveTextContent(
        `${CLAIMED_BUILT}/${manifest.subspaces.length}`
      );
    });

    it(`puts the notice above the gauges after ${arm.name}, so its "below" covers the counts`, () => {
      arm.arrange();
      render(<CoverageMatrix />);
      const banner = screen.getByTestId("digital-twin-coord-unreachable");
      const gauges = screen.getByTestId("digital-twin-gauges");
      expect(
        banner.compareDocumentPosition(gauges) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });
  }

  it("renders every probed cell UNKNOWN with why — never the red Error of a probe that ran", () => {
    degradedAnswer();
    render(<CoverageMatrix />);
    expect(screen.queryAllByText("Error")).toHaveLength(0);
    for (const id of SNAPSHOT_IDS) {
      const cell = screen.getByTestId(`digital-twin-cell-${id}`);
      expect(cell, id).toHaveTextContent("UNKNOWN");
      expect(cell.getAttribute("title"), id).toContain(DEGRADED_WORDS);
      expect(cell.getAttribute("title"), id).not.toContain("was probed");
    }
    // The drawer says the same, and shows no stand-in error token.
    fireEvent.click(screen.getByTestId("digital-twin-cell-schema"));
    const drawer = within(screen.getByRole("dialog"));
    expect(drawer.getByText("UNKNOWN")).toBeInTheDocument();
    expect(drawer.queryByText("coord_unavailable")).toBeNull();
  });

  /**
   * `outbound` is coord's admin `envelope` door: the drawer has no raw read of
   * it, so everything it says about the row comes from the probe's answer
   * for it. Coord's catalog is still held here — it is cached for five
   * minutes while the probe refetches every minute, the shape of an outage
   * that starts mid-session — so the row keeps its envelope door while the
   * probe has no answer for it. No sentence in its drawer may then describe an
   * answer, in either mode.
   */
  describe("the outbound envelope row's drawer, with coord's catalog still held", () => {
    /** What only an answer from the probe could make true. */
    const ANSWER_CLAIMS: readonly RegExp[] = [
      /The probe returned/,
      /credibility envelope/i,
      /was probed/,
      /\bError\b/,
      /coord_unavailable/,
    ];

    const UNOBSERVED = {
      unobservable: "CoverageMatrix.test.tsx mocks @qontinui/ui-bridge/react",
    } as const;

    /** Open the outbound row's drawer; its dialog element. */
    function openOutbound(): HTMLElement {
      fireEvent.click(screen.getByTestId("digital-twin-cell-outbound"));
      return screen.getByRole("dialog");
    }

    function expectNoAnswerClaimed(drawer: HTMLElement) {
      for (const claim of ANSWER_CLAIMS) {
        expect(drawer.textContent, String(claim)).not.toMatch(claim);
      }
      // Its Summary would describe the probe's answer; with none, it is shut.
      expect(
        within(drawer).queryByTestId("digital-twin-drawer-summary")
      ).toBeNull();
    }

    for (const arm of ARMS) {
      // The reason as the drawer's meaning starts its sentence (no full stop).
      const cause = arm.reason.replace(/\.$/, "");

      it(`reads UNKNOWN with why after ${arm.name}, and claims no probe answer — operator mode`, () => {
        state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
        arm.arrange();
        render(<CoverageMatrix />);
        const drawer = openOutbound();
        expect(statusOf(drawer)).toHaveTextContent("UNKNOWN");
        expect(drawer).toHaveTextContent(cause);
        expectNoAnswerClaimed(drawer);
      });

      it(`reads UNKNOWN with why after ${arm.name}, and claims no probe answer — while presenting`, () => {
        state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
        arm.arrange();
        const view = renderInPresentationMode(<CoverageMatrix />, {
          uiBridge: UNOBSERVED,
        });
        const drawer = openOutbound();
        expect(statusOf(drawer)).toHaveTextContent("UNKNOWN");
        expect(drawer).toHaveTextContent(cause);
        expectNoAnswerClaimed(drawer);
        expectPresentationSafe(view);
      });
    }

    it("claims no probe answer while the probe is still in flight, either", () => {
      state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
      state.probe = {
        data: undefined,
        isLoading: true,
        isError: false,
        error: null,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
      };
      render(<CoverageMatrix />);
      const drawer = openOutbound();
      expect(statusOf(drawer)).toHaveTextContent("Probing…");
      expectNoAnswerClaimed(drawer);
    });

    it("still says the probe returned no envelope when it answered the row without one", () => {
      state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
      setProbe(
        probesFor(MANIFEST_SNAPSHOT_IDS, {
          // The backend's cell for a door that failed (`_probe_subspace`).
          outbound: {
            id: "outbound",
            status: "error",
            error: "coord_tool_failed",
            http_status: 500,
            door_shape: "envelope",
          },
        })
      );
      render(<CoverageMatrix />);
      const drawer = openOutbound();
      expect(statusOf(drawer)).toHaveTextContent("Error");
      expect(
        within(drawer).getByTestId("digital-twin-drawer-summary")
      ).toHaveTextContent("The probe returned no credibility envelope.");
    });
  });

  /**
   * `schema` is on coord's twin door, so its drawer makes its own raw read of
   * the observer, apart from the probe — and that door can answer while the
   * probe holds no reading: the backend's `catalog_unavailable` answer is a
   * coord whose catalog route is down while its twin door still answers. The
   * drawer's Summary is then a reading of the observer, and its Status, still
   * UNKNOWN like the cell, must not say there is none.
   */
  describe("the schema row's drawer, when its own raw read answers and the probe holds none", () => {
    const RAW_SCHEMA: RawVerdictResponse = {
      subspace: "schema",
      tool: "coord_query_schema",
      verdict: {
        coverage: 1,
        credibility: 0.95,
        posterior: 0.9,
        staleness_seconds: 30,
        provenance: "alembic_graph",
        drift_class: "none",
      },
    };

    const SILENT_ARMS = [
      ...ARMS,
      {
        name: "a degraded answer from a coord whose catalog is down",
        arrange: () => degradedAnswer("catalog_unavailable"),
        reason:
          "Coord's live probe could not be made: coord's catalog of live probes could not be read.",
      },
    ];

    const UNOBSERVED = {
      unobservable: "CoverageMatrix.test.tsx mocks @qontinui/ui-bridge/react",
    } as const;

    function openSchema(): HTMLElement {
      fireEvent.click(screen.getByTestId("digital-twin-cell-schema"));
      return screen.getByRole("dialog");
    }

    /** The drawer shows its own read, and says the PAGE has no status. */
    function expectOwnReadNamed(drawer: HTMLElement, cause: string) {
      const d = within(drawer);
      expect(d.getByTestId("digital-twin-drawer-summary")).toHaveTextContent(
        "Coverage 100%, credibility 95%"
      );
      expect(d.getByText("Live credibility envelope")).toBeInTheDocument();
      expect(statusOf(drawer)).toHaveTextContent("UNKNOWN");
      expect(drawer.textContent).not.toMatch(/no current reading/);
      expect(drawer).toHaveTextContent(
        `${cause}, so this page has no status for this observer; the Summary above is this drawer's own read of it.`
      );
    }

    for (const arm of SILENT_ARMS) {
      // The reason as the drawer's meaning starts its sentence (no full stop).
      const cause = arm.reason.replace(/\.$/, "");

      it(`says the page has no status, not that there is no reading, after ${arm.name} — operator mode`, () => {
        state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
        arm.arrange();
        state.raw = { schema: { data: RAW_SCHEMA } };
        render(<CoverageMatrix />);
        // The cell has no reading of its own: it stays UNKNOWN.
        expect(
          screen.getByTestId("digital-twin-cell-schema")
        ).toHaveTextContent("UNKNOWN");
        expectOwnReadNamed(openSchema(), cause);
      });

      it(`says the page has no status, not that there is no reading, after ${arm.name} — while presenting`, () => {
        state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
        arm.arrange();
        state.raw = { schema: { data: RAW_SCHEMA } };
        const view = renderInPresentationMode(<CoverageMatrix />, {
          uiBridge: UNOBSERVED,
        });
        expectOwnReadNamed(openSchema(), cause);
        expectPresentationSafe(view);
      });
    }

    it("still says there is no current reading while its own read is in flight", () => {
      state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
      failedRead();
      state.raw = { schema: { isLoading: true } };
      render(<CoverageMatrix />);
      const drawer = openSchema();
      // The Summary names whose read is in flight: the drawer's, not the
      // probe's the Status speaks for.
      expect(
        within(drawer).getByTestId("digital-twin-drawer-summary")
      ).toHaveTextContent(
        "This drawer's own read of the observer is in flight…"
      );
      expect(drawer).toHaveTextContent(
        "Coord's live probe could not be read (HTTP 502), so there is no current reading of this observer"
      );
      // The Status points at no reading the drawer does not have.
      expect(drawer.textContent).not.toMatch(/this drawer's own read of it/i);
    });

    it("still says there is no current reading when its own read failed too", () => {
      state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
      failedRead();
      state.raw = {
        schema: {
          isError: true,
          error: new Error(
            "GET /api/v1/digital-twin/subspace/schema/raw failed: 502 - upstream"
          ),
        },
      };
      render(<CoverageMatrix />);
      const drawer = openSchema();
      // Two failed reads, and each sentence says which one it is about.
      expect(
        within(drawer).getByTestId("digital-twin-drawer-read-error")
      ).toHaveTextContent(
        "This drawer's own read of the live verdict failed: GET /api/v1/digital-twin/subspace/schema/raw failed: 502 - upstream."
      );
      expect(drawer).toHaveTextContent(
        "Coord's live probe could not be read (HTTP 502), so there is no current reading of this observer"
      );
      expect(drawer.textContent).not.toMatch(/this drawer's own read of it/i);
      expect(
        within(drawer).queryByText("Live credibility envelope")
      ).toBeNull();
    });

    /** The probe failed; `worktree`'s report door answered the drawer. */
    function reportDoorAnswered() {
      state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
      failedRead();
      state.raw = {
        worktree: {
          data: {
            subspace: "worktree",
            tool: "coord_query_worktree",
            verdict: { worktrees: 3 },
          },
        },
      };
    }

    function openWorktree(): HTMLElement {
      fireEvent.click(screen.getByTestId("digital-twin-cell-worktree"));
      return screen.getByRole("dialog");
    }

    function expectReportNamed(drawer: HTMLElement) {
      expect(
        within(drawer).getByTestId("digital-twin-drawer-summary")
      ).toHaveTextContent("coord answers this sub-space with its own report");
      expect(statusOf(drawer)).toHaveTextContent("UNKNOWN");
      expect(drawer.textContent).not.toMatch(/no current reading/);
      expect(drawer).toHaveTextContent(
        "the Summary above is this drawer's own read of it."
      );
    }

    it("names a report door's own read the same way, and points the operator at the raw report", () => {
      reportDoorAnswered();
      render(<CoverageMatrix />);
      const drawer = openWorktree();
      expectReportNamed(drawer);
      expect(drawer).toHaveTextContent("The raw data below is the report.");
      // A report door's raw data is a report, and its heading says so.
      expect(within(drawer).getByText("Raw report")).toBeInTheDocument();
      expect(within(drawer).queryByText("Raw verdict")).toBeNull();
    });

    it("never points at a raw report while presenting, where the raw view is not shown", () => {
      reportDoorAnswered();
      const view = renderInPresentationMode(<CoverageMatrix />, {
        uiBridge: UNOBSERVED,
      });
      const drawer = openWorktree();
      expectReportNamed(drawer);
      expect(within(drawer).queryByText(/^Raw (verdict|report)$/)).toBeNull();
      expect(drawer.textContent).not.toMatch(/raw data below/i);
      expectPresentationSafe(view);
    });
  });

  it("keeps the last answer's count after a failed refresh — a reading, dated — under the notice", () => {
    setProbe(probesFor(SNAPSHOT_IDS));
    state.probe = {
      ...state.probe,
      isError: true,
      error: HTTP_502,
      dataUpdatedAt: AT - 120_000,
      errorUpdatedAt: AT,
    };
    render(<CoverageMatrix />);
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      `${SNAPSHOT_IDS.length}/${SNAPSHOT_IDS.length}`
    );
    expect(
      screen.getByTestId("digital-twin-coord-unreachable")
    ).toHaveTextContent("Live cells fall back to their last status");
  });

  it("dates the UNKNOWN gauge's chip by the failed attempt while presenting", () => {
    failedRead();
    const view = renderInPresentationMode(<CoverageMatrix />, {
      uiBridge: {
        unobservable: "CoverageMatrix.test.tsx mocks @qontinui/ui-bridge/react",
      },
    });
    const chip = screen
      .getByTestId("digital-twin-gauges")
      .querySelector("[data-provenance]");
    // No answer was ever read: only the failed attempt can date it.
    expect(chip).toHaveAttribute("data-provenance-known", "true");
    expect(chip).toHaveTextContent("source: coord's live twin probe");
    expect(screen.getByTestId("digital-twin-gauge-live")).toHaveTextContent(
      "UNKNOWN"
    );
    expectPresentationSafe(view);
  });
});

/**
 * The drawer shows the probe's current row for the sub-space it was opened
 * on, not the row as it was clicked: the probe refetches every minute, and a
 * drawer left open across an answer must say what that answer says.
 */
describe("CoverageMatrix's open drawer follows the probe", () => {
  /** The outbound envelope door's answer, as coord really sends it. */
  const OUTBOUND_ANSWER: SubspaceProbe = {
    id: "outbound",
    status: "implemented",
    door_shape: "envelope",
    metrics: outboundEnvelope("nominal"),
  };

  it("moves from Probing… to the answer when the probe answers while it is open", () => {
    state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
    state.probe = {
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
    };
    const view = render(<CoverageMatrix />);
    fireEvent.click(screen.getByTestId("digital-twin-cell-outbound"));
    const before = screen.getByRole("dialog");
    expect(statusOf(before)).toHaveTextContent("Probing…");
    expect(
      within(before).queryByTestId("digital-twin-drawer-summary")
    ).toBeNull();

    setProbe(probesFor(MANIFEST_SNAPSHOT_IDS, { outbound: OUTBOUND_ANSWER }));
    view.rerender(<CoverageMatrix />);

    // Still open, and saying what the cell beneath it now says.
    expect(screen.getByTestId("digital-twin-cell-outbound")).toHaveTextContent(
      "Live"
    );
    const after = screen.getByRole("dialog");
    expect(statusOf(after)).toHaveTextContent("Live");
    expect(statusOf(after)).not.toHaveTextContent("Probing…");
    expect(
      within(after).getByTestId("digital-twin-drawer-summary")
    ).toHaveTextContent("Coverage 100%, credibility 95%");
    expect(
      within(after).getByText("Live credibility envelope")
    ).toBeInTheDocument();
  });

  it("moves from UNKNOWN to the answer when coord recovers while it is open", () => {
    state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
    state.probe = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error(
        "GET /api/v1/digital-twin/subspaces failed: 502 - upstream"
      ),
      dataUpdatedAt: 0,
      errorUpdatedAt: Date.parse("2026-10-23T12:00:00Z"),
    };
    const view = render(<CoverageMatrix />);
    fireEvent.click(screen.getByTestId("digital-twin-cell-schema"));
    expect(statusOf(screen.getByRole("dialog"))).toHaveTextContent("UNKNOWN");

    setProbe(probesFor(MANIFEST_SNAPSHOT_IDS));
    view.rerender(<CoverageMatrix />);

    const drawer = screen.getByRole("dialog");
    expect(statusOf(drawer)).toHaveTextContent("Live");
    expect(drawer.textContent).not.toMatch(/UNKNOWN|no current reading/);
  });

  it("closes, and opens on whichever cell is pressed next", () => {
    render(<CoverageMatrix />);
    fireEvent.click(screen.getByTestId("digital-twin-cell-schema"));
    expect(
      within(screen.getByRole("dialog")).getByRole("heading")
    ).toHaveTextContent("schema");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByTestId("digital-twin-cell-memory"));
    expect(
      within(screen.getByRole("dialog")).getByRole("heading")
    ).toHaveTextContent("memory");
  });
});

/**
 * React-query makes no read while this browser is offline (the app's default
 * `online` network mode): a probe that has not answered yet is then pending
 * but not fetching — no data, not loading, no error. No probe ran, so no cell
 * may read as the Error of one that did, and no drawer may describe an
 * answer.
 */
describe("CoverageMatrix while react-query holds the probe's read — UNKNOWN, never Error", () => {
  const OFFLINE =
    "Coord's live probe has not answered: this browser is offline";

  const UNOBSERVED = {
    unobservable: "CoverageMatrix.test.tsx mocks @qontinui/ui-bridge/react",
  } as const;

  /** No answer, no failure, no read in flight; coord's catalog held. */
  function heldRead() {
    state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
    state.probe = {
      data: undefined,
      isLoading: false,
      isError: false,
      error: null,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
    };
  }

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("renders every probed cell and the live gauge UNKNOWN, naming the browser offline", () => {
    heldRead();
    onlineManager.setOnline(false);
    render(<CoverageMatrix />);
    expect(screen.queryAllByText("Error")).toHaveLength(0);
    for (const id of MANIFEST_SNAPSHOT_IDS) {
      const cell = screen.getByTestId(`digital-twin-cell-${id}`);
      expect(cell, id).toHaveTextContent("UNKNOWN");
      expect(cell.getAttribute("title"), id).toContain(OFFLINE);
      expect(cell.getAttribute("title"), id).not.toContain("was probed");
    }
    const live = screen.getByTestId("digital-twin-gauge-live");
    expect(live).toHaveAttribute("data-reading", "unknown");
    expect(live).toHaveTextContent(`${OFFLINE}.`);
    expect(
      screen.getByTestId("digital-twin-coord-unreachable")
    ).toHaveTextContent(OFFLINE);
  });

  /** Open the outbound drawer: UNKNOWN with why, and no probe answer claimed. */
  function expectHeldOutboundDrawer() {
    fireEvent.click(screen.getByTestId("digital-twin-cell-outbound"));
    const drawer = screen.getByRole("dialog");
    expect(statusOf(drawer)).toHaveTextContent("UNKNOWN");
    expect(drawer).toHaveTextContent(OFFLINE);
    expect(drawer.textContent).not.toMatch(
      /The probe returned|was probed|credibility envelope/i
    );
    expect(
      within(drawer).queryByTestId("digital-twin-drawer-summary")
    ).toBeNull();
  }

  it("opens the outbound drawer on UNKNOWN with why, claiming no probe answer — operator mode", () => {
    heldRead();
    onlineManager.setOnline(false);
    render(<CoverageMatrix />);
    expectHeldOutboundDrawer();
  });

  it("opens the outbound drawer on UNKNOWN with why, claiming no probe answer — while presenting", () => {
    heldRead();
    onlineManager.setOnline(false);
    const view = renderInPresentationMode(<CoverageMatrix />, {
      uiBridge: UNOBSERVED,
    });
    expectHeldOutboundDrawer();
    expectPresentationSafe(view);
  });

  it("says why a raw door's own read is missing rather than leaving its Summary empty", () => {
    heldRead();
    onlineManager.setOnline(false);
    render(<CoverageMatrix />);
    fireEvent.click(screen.getByTestId("digital-twin-cell-schema"));
    const drawer = screen.getByRole("dialog");
    expect(
      within(drawer).getByTestId("digital-twin-drawer-read-held")
    ).toHaveTextContent(
      "This drawer's own read of the observer has not been made: this browser is offline."
    );
    expect(within(drawer).queryByText("Live credibility envelope")).toBeNull();
  });

  it("names no cause it cannot see when the read is held with the browser online", () => {
    heldRead();
    render(<CoverageMatrix />);
    const cell = screen.getByTestId("digital-twin-cell-schema");
    expect(cell).toHaveTextContent("UNKNOWN");
    expect(cell.getAttribute("title")).toContain(
      "Coord's live probe has not answered, and no read of it is in flight"
    );
    fireEvent.click(cell);
    expect(
      within(screen.getByRole("dialog")).getByTestId(
        "digital-twin-drawer-read-held"
      )
    ).toHaveTextContent(
      "This drawer's own read of the observer has not answered, and none is in flight."
    );
    expect(document.body.textContent).not.toMatch(/offline/);
  });
});
