/**
 * The sub-space drawer over EVERY state of the reads behind it, in both modes
 * (plan `2026-10-23-console-presentation-spaces` Phase 5; `ux-priorities`
 * `a-status-signal-must-observe-the-state-it-names`).
 *
 * Each review round found one more state in which a sentence in this drawer
 * named a state that did not hold. This file enumerates the states instead:
 *
 * - **Axis A — the page probe, for the row.** Answered, with each status the
 *   row's door can answer (implemented, partial with a coverage and with none
 *   to grade, blind, served, restricted, an error with a token, a 404 door,
 *   no cell for the row); the same answer HELD after the probe's refresh
 *   failed; no reading — a failed read, a degraded answer (coord unreachable,
 *   coord's catalog unreadable), a read react-query holds (offline, or online
 *   with none in flight), a failed refresh over a degraded answer; and in
 *   flight. Each answer is the body its door really sends. The envelope
 *   door's is coord's admin outbound body (`test-catalog.ts`
 *   `outboundEnvelope`). Its coverage is exactly 1 or 0, so it answers
 *   implemented or blind and never partial. It has no answer-level age: the
 *   backend serves its worst bucket's, which the drawer names as that
 *   bucket's. A backend that predates carrying it serves none, and so does
 *   an answer with no bucket; then its freshness is UNKNOWN. The frontend and
 *   the backend deploy separately, so both the dated and the undated answer
 *   are rows.
 * - **Axis B — the drawer's own raw read**, for a row on coord's twin door
 *   (`schema`, a verdict door; `worktree`, a report door): not made (online,
 *   offline), in flight, answered, FAILED with an earlier answer still held
 *   by react-query, failed with nothing held — and an answer, or a held one,
 *   whose body carries no reading or the OTHER kind of reading (coord out of
 *   shape). The envelope door (`outbound`) has no raw read: its reading is
 *   the probe's.
 * - **Coord's catalog**, held or unread. It gives the drawer one thing: the
 *   door shape of a row whose probe cell names none. Unread, such a door is
 *   unknown — the drawer reads it raw (the envelope door too, whose raw read
 *   never answers) and the body's own shape says verdict or report. Rows
 *   whose cell names its door read the same either way, so they are cells
 *   once.
 * - **Axis C — operator mode and presentation mode** (the page check runs on
 *   every presenting cell).
 *
 * Only combinations that cannot occur are left out, for three reasons:
 *
 * - One browser has one online state. So there is no probe held OFFLINE
 *   beside a drawer read held ONLINE, and no reverse of it.
 * - No drawer opens over an answer that refused EVERY reading (`resolve.ts`
 *   `allProbesRestricted`). Both views that open one replace themselves with
 *   the access notice then (`TwinAccessRestricted`), and the Twin map, which
 *   keeps its cards, opens no drawer: its parts say UNKNOWN naming the
 *   refusal (`probe-read.ts` `probeReadOf`, `TwinMap.test.tsx`). A refusal
 *   of the row alone is a row here (`restricted`).
 * - coord's twin door never serves the envelope door. `outbound` is outside
 *   its allow-set by design, so it answers 404 (`twin_routes.rs`,
 *   `twin_probe_door.rs`). So when the envelope door's shape is unknown and
 *   the drawer reads it raw, that read is only ever unmade, in flight or
 *   failed. It has no answered or retained arm (`UNANSWERED_OWN_ARMS`).
 *
 * Every other combination is a cell, and two rows the page does not probe
 * are checked under every kind of probe state.
 *
 * The expectations below are written out here, not imported from the
 * modules under test, so a sentence changed there is a sentence checked here.
 * What every cell checks, beyond its own expectations: no reading is aged by
 * its own staleness ("data is 30s stale"); a reading's freshness is what its
 * door reported, so the envelope door's is never "live"; "Live credibility
 * envelope" heads only a reading the latest read returned; "this drawer's own
 * read of it" appears only beside such a reading; "no current reading" never
 * beside one; a status is "Last answer: …" exactly when the probe's refresh
 * failed over it; and nothing points at a report the drawer does not show.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectPresentationSafe,
  renderInPresentationMode,
} from "@/test/presentation";
import type {
  CellStatus,
  DoorShape,
  RawVerdictResponse,
  SubspaceProbe,
  SubspacesProbeResponse,
  TwinCatalogResponse,
  VerdictMetrics,
} from "../_lib/types";

/** What the drawer's raw read (`useSubspaceRaw`) holds for one sub-space. */
interface RawRead {
  data?: RawVerdictResponse;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  dataUpdatedAt?: number;
  errorUpdatedAt?: number;
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
  catalog: undefined as TwinCatalogResponse | undefined,
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
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    ...(enabled && id ? state.raw[id] : undefined),
  }),
}));
vi.mock("@qontinui/ui-bridge/react", () => ({
  useUIElement: () => ({ ref: () => {} }),
}));

import { UNKNOWN_AMBER } from "@/components/console/statusRow";
import { STATUS_STYLES } from "../_lib/status-presentation";
import {
  MANIFEST_SNAPSHOT_IDS,
  catalogDeclaring,
  outboundEnvelope,
} from "../_lib/test-catalog";
import { CoverageMatrix } from "./CoverageMatrix";

// ---------------------------------------------------------------------------
// Times. Every age is read against the clock at render, so each is set well
// inside its minute: the probe answered 5 minutes ago, the drawer's own read
// 3 minutes ago, and the failed attempts 1 minute ago.

const PROBE_AGE_MS = 5.5 * 60_000;
const READ_AGE_MS = 3.5 * 60_000;
const FAIL_AGE_MS = 1.5 * 60_000;
const PROBE_AGE = "5m ago";
const READ_AGE = "3m ago";
const FAIL_AGE = "1m ago";

const PROBE_502 = new Error(
  "GET /api/v1/digital-twin/subspaces failed: 502 - upstream"
);
const rawFailure = (id: string) =>
  new Error(
    `GET /api/v1/digital-twin/subspace/${id}/raw failed: 502 - upstream`
  );

// ---------------------------------------------------------------------------
// The doors, and what each can answer.

type Door = "schema" | "worktree" | "outbound";

/** The door coord declares for each (`test-catalog.ts`). */
const DOOR_SHAPE: Record<Door, DoorShape> = {
  schema: "verdict_wrapper",
  worktree: "report",
  outbound: "envelope",
};

/** A status the probe answers with, and how the row's cell carries it. */
interface Answer {
  readonly name: string;
  /** The cell status it resolves to (its dot, while current). */
  readonly status: CellStatus;
  /** The Status label it reads as (before "Last answer: "). */
  readonly label: string;
  /**
   * What the probe found, as a predicate of it: a current answer's meaning
   * starts "Coord's live probe <predicate>", a held one's "… it <predicate>".
   */
  readonly predicate: string;
  /** The row's cell in the probe's answer; `null` = no cell for the row. */
  readonly cell: (id: string) => SubspaceProbe | null;
  /** It is not a reading of the observer: an error, or a refusal. */
  readonly notAReading: boolean;
  /** The envelope door's reading of this answer, in words; none without. */
  readonly envelopeProse?: string;
  /** What that reading's envelope says of its age. */
  readonly envelopeFreshness?: Freshness;
  /** The probe error token the row carries, if any. */
  readonly token?: string;
}

/**
 * The metrics the backend copies out of a twin-door DriftVerdict, from which
 * it grades the status (`_classify`). Only the coverage reaches the drawer:
 * a twin-door row's Summary is the drawer's own read.
 */
const verdictMetrics = (
  coverage: number | null,
  driftClass = "none"
): VerdictMetrics => ({
  coverage,
  credibility: 0.95,
  posterior: 0.9,
  staleness_seconds: null,
  provenance: "alembic_graph",
  drift_class: driftClass,
});

const graded = (
  status: "implemented" | "partial" | "blind",
  name: string,
  label: string,
  predicate: string,
  cellMetrics: VerdictMetrics,
  envelope?: { prose: string; freshness: Freshness }
): Answer => ({
  name,
  status,
  label,
  predicate,
  cell: (id) => ({
    id,
    status,
    metrics: cellMetrics,
    door_shape: DOOR_SHAPE[id as Door],
  }),
  notAReading: false,
  envelopeProse: envelope?.prose,
  envelopeFreshness: envelope?.freshness,
});

const FOUND_FULL =
  "found this observer answering with full coverage for this tenant.";
const FOUND_BLIND =
  "found this observer built but disabled or unconfigured for this tenant — not the same as unbuilt.";
/**
 * What a reading's envelope says of its age: the age its door served, or
 * UNKNOWN on the ignorance floor, with why, where none was served.
 */
type Freshness = { readonly reported: string } | { readonly unknown: string };

/** The envelope door's answer with no age served (an older backend, or no bucket). */
const NO_AGE =
  "from persisted_oplog; no age was served for this reading, so its freshness when read is UNKNOWN.";
const UNSERVED: Freshness = {
  unknown: "No age was served for this reading.",
};

/** The twin door's verdicts, which `schema` answers with. */
const IMPLEMENTED = graded(
  "implemented",
  "implemented",
  "Live",
  FOUND_FULL,
  verdictMetrics(1)
);
const PARTIAL = graded(
  "partial",
  "partial",
  "Partial",
  "found this observer answering, but with some dimensions unconfigured (coverage below 100%).",
  verdictMetrics(0.6)
);
/** The backend's partial for an answer that carried no coverage to grade. */
const PARTIAL_UNGRADED = graded(
  "partial",
  "partial (no coverage to grade)",
  "Partial",
  "found this observer answering, with no coverage in its answer to grade.",
  verdictMetrics(null)
);
const BLIND = graded(
  "blind",
  "blind",
  "Blind",
  FOUND_BLIND,
  verdictMetrics(0, "unknown")
);

/**
 * coord's admin outbound door, which `outbound` answers with: its real body
 * (`outboundEnvelope`). Buckets observed, worst one exhausted: implemented,
 * dated by that bucket's age (12 s when read) — or, from a backend that
 * predates carrying it, with no age. No bucket: coverage 0 and drift
 * `unknown`, so blind, with no age.
 */
const OUTBOUND_IMPLEMENTED = graded(
  "implemented",
  "implemented (worst bucket exhausted, its age served)",
  "Live",
  FOUND_FULL,
  outboundEnvelope({ drift: "exhausted", ageSeconds: 12 }),
  {
    prose:
      "Outbound is classified “exhausted”. Coverage 100%, credibility 95%; its worst bucket's data was 12s stale when read, from persisted_oplog.",
    freshness: { reported: "12s stale (worst bucket)" },
  }
);
const OUTBOUND_IMPLEMENTED_UNDATED = graded(
  "implemented",
  "implemented (worst bucket exhausted, no age served)",
  "Live",
  FOUND_FULL,
  outboundEnvelope({ drift: "exhausted", ageSeconds: null }),
  {
    prose: `Outbound is classified “exhausted”. Coverage 100%, credibility 95%, ${NO_AGE}`,
    freshness: UNSERVED,
  }
);
const OUTBOUND_BLIND = graded(
  "blind",
  "blind (no bucket observed)",
  "Blind",
  FOUND_BLIND,
  outboundEnvelope(null),
  {
    prose: `Outbound is unknown — the observer could not read this for your tenant. Coverage 0%, credibility 95%, ${NO_AGE}`,
    freshness: UNSERVED,
  }
);
const SERVED: Answer = {
  name: "served",
  status: "served",
  label: "Served",
  predicate:
    "was answered with coord's own report rather than a verdict — served, not graded: neither healthy nor broken.",
  cell: (id) => ({ id, status: "served", door_shape: "report" }),
  notAReading: false,
};
const RESTRICTED: Answer = {
  name: "restricted",
  status: "restricted",
  label: "Restricted",
  predicate:
    "was refused this sub-space, which is Qontinui-internal (readable only by Qontinui's own operators) or, for the outbound budget, admin-only; your other sub-spaces are unaffected.",
  cell: (id) => ({
    id,
    status: "restricted",
    door_shape: DOOR_SHAPE[id as Door],
  }),
  notAReading: true,
};
/**
 * A read the probe made that failed, as the backend's cell carries it: a
 * tool failure names the door shape, a timeout does not (coord's catalog
 * supplies it, when read).
 */
const errorWithToken = (
  token: "coord_tool_failed" | "coord_timeout",
  cause: string
): Answer => ({
  name: `error (${token})`,
  status: "error",
  label: "Error",
  predicate: `could not read this observer (${cause}) — an honest error, never a fabricated ok.`,
  cell: (id) =>
    token === "coord_tool_failed"
      ? {
          id,
          status: "error",
          error: token,
          http_status: 502,
          door_shape: DOOR_SHAPE[id as Door],
        }
      : { id, status: "error", error: token },
  notAReading: true,
  token,
});
const NO_READING =
  "returned no reading of this observer: coord's door for it did not answer, or the probe's answer had no result for it — an honest error, never a fabricated ok.";
const ERROR_404: Answer = {
  name: "error (a 404 door)",
  status: "error",
  label: "Error",
  predicate: NO_READING,
  cell: (id) => ({
    id,
    status: "no_snapshot_tool",
    door_shape: DOOR_SHAPE[id as Door],
  }),
  notAReading: true,
};
const ERROR_NO_CELL: Answer = {
  name: "error (no cell for the row)",
  status: "error",
  label: "Error",
  predicate: NO_READING,
  cell: () => null,
  notAReading: true,
};

const ANSWERS: Record<Door, readonly Answer[]> = {
  schema: [
    IMPLEMENTED,
    PARTIAL,
    PARTIAL_UNGRADED,
    BLIND,
    RESTRICTED,
    errorWithToken("coord_tool_failed", "coord's observer failed to answer"),
    ERROR_404,
    ERROR_NO_CELL,
  ],
  worktree: [
    SERVED,
    RESTRICTED,
    errorWithToken("coord_tool_failed", "coord's observer failed to answer"),
    ERROR_404,
    ERROR_NO_CELL,
  ],
  outbound: [
    OUTBOUND_IMPLEMENTED,
    OUTBOUND_IMPLEMENTED_UNDATED,
    OUTBOUND_BLIND,
    RESTRICTED,
    errorWithToken("coord_timeout", "the read timed out"),
    ERROR_404,
    ERROR_NO_CELL,
  ],
};

/** The probe's answer: every declared row implemented, `id`'s as `answer`. */
function probeAnswer(id: string, answer: Answer): SubspacesProbeResponse {
  const subspaces: SubspaceProbe[] = [];
  for (const other of MANIFEST_SNAPSHOT_IDS) {
    if (other !== id) {
      subspaces.push({ id: other, status: "implemented" });
      continue;
    }
    const cell = answer.cell(id);
    if (cell) subspaces.push(cell);
  }
  return { subspaces, probed: subspaces.length, restricted: false };
}

/** The backend's degraded answer: no probe made, a stand-in per id. */
function degradedAnswer(token: string): SubspacesProbeResponse {
  return {
    subspaces: MANIFEST_SNAPSHOT_IDS.map((id) => ({
      id,
      status: "error" as const,
      error: token,
    })),
    probed: 0,
    restricted: false,
    degraded: true,
  };
}

// ---------------------------------------------------------------------------
// Axis A — the probe.

type ProbeKind = "answered" | "held" | "unknown" | "probing";

interface ProbeArm {
  readonly name: string;
  readonly kind: ProbeKind;
  /** For an answered or held arm: what it answered. */
  readonly answer?: Answer;
  /** For an unknown arm: why, as the Status meaning starts it. */
  readonly reason?: string;
  /** The Status chip's age, or `null` for none; "UNKNOWN" when undated. */
  readonly statusAge: string | null;
  /** The browser's online state this arm needs, or `null` for either. */
  readonly online: boolean | null;
  readonly arrange: (id: string, now: number) => void;
}

function probeQuery(fields: Partial<typeof state.probe>) {
  state.probe = {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    ...fields,
  };
}

function probeArms(door: Door): ProbeArm[] {
  const arms: ProbeArm[] = [];
  for (const answer of ANSWERS[door]) {
    arms.push({
      name: `answered ${answer.name}`,
      kind: "answered",
      answer,
      statusAge: PROBE_AGE,
      online: null,
      arrange: (id, now) =>
        probeQuery({
          data: probeAnswer(id, answer),
          dataUpdatedAt: now - PROBE_AGE_MS,
        }),
    });
    arms.push({
      name: `held ${answer.name} after a failed refresh`,
      kind: "held",
      answer,
      statusAge: PROBE_AGE,
      online: null,
      arrange: (id, now) =>
        probeQuery({
          data: probeAnswer(id, answer),
          dataUpdatedAt: now - PROBE_AGE_MS,
          isError: true,
          error: PROBE_502,
          errorUpdatedAt: now - FAIL_AGE_MS,
        }),
    });
  }
  arms.push(
    {
      name: "failed with nothing held",
      kind: "unknown",
      reason: "Coord's live probe could not be read (HTTP 502)",
      statusAge: FAIL_AGE,
      online: null,
      arrange: (_id, now) =>
        probeQuery({
          isError: true,
          error: PROBE_502,
          errorUpdatedAt: now - FAIL_AGE_MS,
        }),
    },
    {
      name: "degraded: coord unreachable",
      kind: "unknown",
      reason:
        "Coord's live probe could not be made: coord could not be reached",
      statusAge: FAIL_AGE,
      online: null,
      arrange: (_id, now) =>
        probeQuery({
          data: degradedAnswer("coord_unavailable"),
          dataUpdatedAt: now - FAIL_AGE_MS,
        }),
    },
    {
      name: "degraded: coord's catalog unreadable",
      kind: "unknown",
      reason:
        "Coord's live probe could not be made: coord's catalog of live probes could not be read",
      statusAge: FAIL_AGE,
      online: null,
      arrange: (_id, now) =>
        probeQuery({
          data: degradedAnswer("catalog_unavailable"),
          dataUpdatedAt: now - FAIL_AGE_MS,
        }),
    },
    {
      name: "held by react-query, offline",
      kind: "unknown",
      reason: "Coord's live probe has not answered: this browser is offline",
      statusAge: "UNKNOWN",
      online: false,
      arrange: () => probeQuery({}),
    },
    {
      name: "held by react-query, online",
      kind: "unknown",
      reason:
        "Coord's live probe has not answered, and no read of it is in flight",
      statusAge: "UNKNOWN",
      online: true,
      arrange: () => probeQuery({}),
    },
    {
      name: "a failed refresh over a degraded answer",
      kind: "unknown",
      reason:
        "Coord's live probe could not be made: coord could not be reached",
      statusAge: PROBE_AGE,
      online: null,
      arrange: (_id, now) =>
        probeQuery({
          data: degradedAnswer("coord_unavailable"),
          dataUpdatedAt: now - PROBE_AGE_MS,
          isError: true,
          error: PROBE_502,
          errorUpdatedAt: now - FAIL_AGE_MS,
        }),
    },
    {
      name: "in flight",
      kind: "probing",
      statusAge: null,
      online: null,
      arrange: () => probeQuery({ isLoading: true }),
    }
  );
  return arms;
}

// ---------------------------------------------------------------------------
// Axis B — the drawer's own raw read.

type OwnKind = "unmade" | "in-flight" | "answered" | "retained" | "failed";

/**
 * What a held body carries, relative to its door: the door's own kind of
 * reading (schema: a verdict, worktree: a report), the OTHER kind (coord
 * answering out of shape), or no reading at all.
 */
type BodyKind = "own" | "other" | "none";

interface OwnArm {
  readonly name: string;
  readonly kind: OwnKind;
  /** For an answered or retained arm: the body it holds. */
  readonly body?: BodyKind;
  readonly online: boolean | null;
  readonly read: (id: string, now: number) => RawRead;
}

type RawDoor = "schema" | "worktree";

const TOOL: Record<RawDoor, string> = {
  schema: "coord_query_migration_state",
  worktree: "coord_list_worktrees",
};

const VERDICT = {
  coverage: 1,
  credibility: 0.95,
  posterior: 0.9,
  staleness_seconds: 30,
  provenance: "alembic_graph",
  drift_class: "none",
};
const REPORT = { worktrees: 3 };

/** What a body of `body` kind is, for a door: a verdict, a report, or none. */
function bodyShape(door: RawDoor, body: BodyKind): "verdict" | "report" | null {
  if (body === "none") return null;
  const own = door === "schema" ? "verdict" : "report";
  if (body === "own") return own;
  return own === "verdict" ? "report" : "verdict";
}

function rawBody(id: string, body: BodyKind): RawVerdictResponse {
  const door = id as RawDoor;
  const shape = bodyShape(door, body);
  return (
    shape === null
      ? { subspace: id, tool: TOOL[door] }
      : {
          subspace: id,
          tool: TOOL[door],
          verdict: shape === "verdict" ? VERDICT : REPORT,
        }
  ) as RawVerdictResponse;
}

const answeredArm = (name: string, body: BodyKind): OwnArm => ({
  name,
  kind: "answered",
  body,
  online: null,
  read: (id, now) => ({
    data: rawBody(id, body),
    dataUpdatedAt: now - READ_AGE_MS,
  }),
});
const retainedArm = (name: string, body: BodyKind): OwnArm => ({
  name,
  kind: "retained",
  body,
  online: null,
  read: (id, now) => ({
    data: rawBody(id, body),
    dataUpdatedAt: now - READ_AGE_MS,
    isError: true,
    error: rawFailure(id),
    errorUpdatedAt: now - FAIL_AGE_MS,
  }),
});

const OWN_ARMS: readonly OwnArm[] = [
  { name: "not made, online", kind: "unmade", online: true, read: () => ({}) },
  {
    name: "not made, offline",
    kind: "unmade",
    online: false,
    read: () => ({}),
  },
  {
    name: "in flight",
    kind: "in-flight",
    online: null,
    read: () => ({ isLoading: true }),
  },
  answeredArm("answered", "own"),
  answeredArm("answered with no reading", "none"),
  answeredArm("answered with the other kind of reading", "other"),
  retainedArm("failed with an earlier answer held", "own"),
  retainedArm("failed with an earlier answer held that had no reading", "none"),
  retainedArm("failed with an earlier answer of the other kind held", "other"),
  {
    name: "failed with nothing held",
    kind: "failed",
    online: null,
    read: (id, now) => ({
      isError: true,
      error: rawFailure(id),
      errorUpdatedAt: now - FAIL_AGE_MS,
    }),
  },
];

// ---------------------------------------------------------------------------
// The cells.

type Mode = "operator" | "presenting";

/**
 * Whether coord's catalog is held. It contributes one thing to the drawer:
 * the door shape of a row whose probe cell names none. Unread, such a row's
 * door is unknown, so the drawer reads it raw — even the envelope door.
 */
type Catalog = "held" | "unread";

interface Cell {
  readonly door: Door;
  readonly catalog: Catalog;
  /** The door shape the drawer sees for the row, or `null` when unknown. */
  readonly shape: DoorShape | null;
  readonly probe: ProbeArm;
  /** `null` for an envelope door, which has no raw read. */
  readonly own: OwnArm | null;
  readonly mode: Mode;
}

function cellName(cell: Cell): string {
  const door =
    cell.catalog === "unread" ? `${cell.door} (catalog unread)` : cell.door;
  const own = cell.own ? ` · own read ${cell.own.name}` : "";
  return `${door} · probe ${cell.probe.name}${own} · ${cell.mode}`;
}

/** The door shape the drawer sees: coord's catalog, else the probe's cell. */
function seenShape(door: Door, catalog: Catalog, probe: ProbeArm) {
  if (catalog === "held") return DOOR_SHAPE[door];
  const answer = probe.answer;
  return (answer && answer.cell(door)?.door_shape) ?? null;
}

/**
 * A raw read of a door whose shape is unknown, for the envelope door: coord's
 * twin door does not serve it, so it never answers — the arms that read
 * nothing.
 */
const UNANSWERED_OWN_ARMS = OWN_ARMS.filter((arm) =>
  ["unmade", "in-flight", "failed"].includes(arm.kind)
);

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const door of ["schema", "worktree", "outbound"] as const) {
    for (const catalog of ["held", "unread"] as const) {
      for (const probe of probeArms(door)) {
        const shape = seenShape(door, catalog, probe);
        // A cell that names its door shape reads the same with or without
        // the catalog: those are the "held" cells.
        if (catalog === "unread" && shape !== null) continue;
        const owns: (OwnArm | null)[] =
          shape === "envelope"
            ? [null]
            : door === "outbound"
              ? UNANSWERED_OWN_ARMS
              : [...OWN_ARMS];
        for (const own of owns) {
          // One browser has one online state.
          if (
            own &&
            probe.online !== null &&
            own.online !== null &&
            probe.online !== own.online
          ) {
            continue;
          }
          for (const mode of ["operator", "presenting"] as const) {
            out.push({ door, catalog, shape, probe, own, mode });
          }
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The oracle.

const POINTER = "The Summary above is this drawer's own read of it.";
const LIVE_HEADING = "Live credibility envelope";
const RETAINED_HEADING = "Credibility envelope, as last read";
const RETAINED_LEAD = "As last read, before that failure:";

/**
 * The reading the drawer must find in its own read's body, or `null`: the
 * door's declared shape decides (a report door's answer is a report, and a
 * verdict door's answer that is no verdict is no reading); with the shape
 * unknown, the body's own shape does.
 */
function ownReading(cell: Cell): "verdict" | "report" | null {
  const own = cell.own;
  if (!own || (own.kind !== "answered" && own.kind !== "retained")) {
    return null;
  }
  const body = bodyShape(cell.door as RawDoor, own.body!);
  if (body === null) return null;
  if (cell.shape === "report") return "report";
  if (cell.shape === "verdict_wrapper") return body === "verdict" ? body : null;
  return body;
}

/** The drawer's own LATEST read answered with a reading. */
function ownAnswered(cell: Cell): boolean {
  return cell.own?.kind === "answered" && ownReading(cell) !== null;
}

function expectStatus(drawer: HTMLElement, cell: Cell) {
  const d = within(drawer);
  const field = d.getByText("Status").parentElement!;
  const meaning = d.getByTestId(
    "digital-twin-drawer-status-meaning"
  ).textContent!;
  const { probe } = cell;

  if (probe.kind === "answered" || probe.kind === "held") {
    const answer = probe.answer!;
    const pointer = ownAnswered(cell) && answer.notAReading;
    const finding =
      probe.kind === "answered"
        ? `Coord's live probe ${answer.predicate}`
        : `Coord's live probe's latest read failed (HTTP 502), so this is its last answer, not a current status: it ${answer.predicate}`;
    expect(field.textContent, "label").toBe(
      probe.kind === "answered"
        ? `Status${answer.label}`
        : `StatusLast answer: ${answer.label}`
    );
    expect(meaning).toBe(pointer ? `${finding} ${POINTER}` : finding);
  } else if (probe.kind === "unknown") {
    expect(field.textContent, "label").toBe("StatusUNKNOWN");
    expect(meaning).toBe(
      ownAnswered(cell)
        ? `${probe.reason}, so this page has no status for this observer; the Summary above is this drawer's own read of it.`
        : `${probe.reason}, so there is no current reading of this observer — its status is unknown, not a failure of the observer.`
    );
  } else {
    expect(field.textContent, "label").toBe("StatusProbing…");
    expect(meaning).toBe("Live probe in flight.");
  }

  // The dot says what is true now: a last answer's is the ignorance floor.
  const dot =
    probe.kind === "answered"
      ? STATUS_STYLES[probe.answer!.status].dot
      : probe.kind === "probing"
        ? STATUS_STYLES.probing.dot
        : STATUS_STYLES.unknown.dot;
  expect(d.getByTestId("digital-twin-drawer-status-dot").className).toBe(
    `size-2.5 rounded-full ${dot}`
  );

  const chip = d.queryByTestId("digital-twin-drawer-status-provenance");
  // An envelope door's Summary is the probe's answer, dated by the probe.
  const summaryDatesIt =
    cell.shape === "envelope" &&
    (probe.kind === "answered" || probe.kind === "held") &&
    probe.answer!.envelopeProse !== undefined;
  if (probe.statusAge === null || summaryDatesIt) {
    expect(chip, "status chip").toBeNull();
  } else {
    expect(chip?.textContent, "status chip").toBe(
      `source: coord's live twin probe · as of ${probe.statusAge}`
    );
  }
}


/**
 * The lines the Summary must say, in order, the reading it must show, and its
 * envelope's heading and freshness.
 */
interface SummaryExpectation {
  readonly lines: readonly [testId: string, text: string][];
  readonly reading: { prose: string; source: string; age: string } | null;
  readonly heading: string | null;
  readonly freshness: Freshness | null;
}

function expectedSummary(cell: Cell): SummaryExpectation | null {
  const presenting = cell.mode === "presenting";
  if (cell.shape === "envelope") {
    const { probe } = cell;
    if (probe.kind !== "answered" && probe.kind !== "held") return null;
    const held = probe.kind === "held";
    const lines: [string, string][] = held
      ? [
          [
            "digital-twin-drawer-probe-held",
            "Coord's live probe's latest read failed (HTTP 502).",
          ],
        ]
      : [];
    const prose = probe.answer!.envelopeProse;
    if (prose === undefined) {
      lines.push([
        "digital-twin-drawer-no-envelope",
        held
          ? "Its last answer carried no credibility envelope."
          : "The probe returned no credibility envelope.",
      ]);
      return { lines, reading: null, heading: null, freshness: null };
    }
    if (held) lines.push(["digital-twin-drawer-read-retained", RETAINED_LEAD]);
    return {
      lines,
      reading: { prose, source: "coord's live twin probe", age: PROBE_AGE },
      heading: held ? RETAINED_HEADING : LIVE_HEADING,
      freshness: probe.answer!.envelopeFreshness!,
    };
  }

  const own = cell.own!;
  // What a failure calls it: the door's word, or neither guess.
  const noun =
    cell.shape === "report"
      ? "report"
      : cell.shape === "verdict_wrapper"
        ? "verdict"
        : "verdict or report";
  // Named as the drawer's own read, never left to guess beside the Status.
  const failure: [string, string] = [
    "digital-twin-drawer-read-error",
    presenting
      ? `This drawer's own read of the live ${noun} failed (HTTP 502).`
      : `This drawer's own read of the live ${noun} failed: GET /api/v1/digital-twin/subspace/${cell.door}/raw failed: 502 - upstream.`,
  ];
  const kind = ownReading(cell);
  const name = cell.door.charAt(0).toUpperCase() + cell.door.slice(1);
  const reading =
    kind === null
      ? null
      : {
          prose:
            kind === "report"
              ? `coord answers this sub-space with its own report, not a verdict — served, not graded.${presenting ? "" : " The raw data below is the report."}`
              : `${name} is in sync — declared matches actual. Coverage 100%, credibility 95%; its data was 30s stale when read, from alembic_graph.`,
          source: "this drawer's own read of coord",
          age: READ_AGE,
        };
  // The twin door's verdict reported its age: 30s, as its body says.
  const freshness: Freshness | null =
    kind === "verdict" ? { reported: "30s stale" } : null;
  const none = { reading: null, heading: null, freshness: null };
  switch (own.kind) {
    case "unmade":
      return {
        lines: [
          [
            "digital-twin-drawer-read-held",
            own.online
              ? "This drawer's own read of the observer has not answered, and none is in flight."
              : "This drawer's own read of the observer has not been made: this browser is offline.",
          ],
        ],
        ...none,
      };
    case "in-flight":
      return {
        lines: [
          [
            "digital-twin-drawer-read-in-flight",
            "This drawer's own read of the observer is in flight…",
          ],
        ],
        ...none,
      };
    case "answered":
      return reading === null
        ? {
            lines: [
              [
                "digital-twin-drawer-read-empty",
                `This drawer's own read of the observer answered with no ${noun}.`,
              ],
            ],
            ...none,
          }
        : {
            lines: [],
            reading,
            heading: kind === "verdict" ? LIVE_HEADING : null,
            freshness,
          };
    case "retained":
      return reading === null
        ? { lines: [failure], ...none }
        : {
            lines: [
              failure,
              ["digital-twin-drawer-read-retained", RETAINED_LEAD],
            ],
            reading,
            heading: kind === "verdict" ? RETAINED_HEADING : null,
            freshness,
          };
    case "failed":
      return { lines: [failure], ...none };
  }
}

const LINE_IDS = [
  "digital-twin-drawer-read-held",
  "digital-twin-drawer-read-in-flight",
  "digital-twin-drawer-read-error",
  "digital-twin-drawer-read-empty",
  "digital-twin-drawer-read-retained",
  "digital-twin-drawer-probe-held",
  "digital-twin-drawer-no-envelope",
];

function expectSummary(drawer: HTMLElement, cell: Cell) {
  const d = within(drawer);
  const expected = expectedSummary(cell);
  const box = d.queryByTestId("digital-twin-drawer-summary");
  if (expected === null) {
    expect(box, "no Summary").toBeNull();
    expect(
      d.queryByTestId("digital-twin-drawer-envelope-heading"),
      "no envelope"
    ).toBeNull();
    return;
  }
  expect(box, "a Summary").not.toBeNull();
  // Every line it says about its read, in the order it says them.
  const lines = [...box!.querySelectorAll("[data-testid]")]
    .filter((el) => LINE_IDS.includes(el.getAttribute("data-testid") ?? ""))
    .map((el) => [el.getAttribute("data-testid"), el.textContent]);
  expect(lines, "the Summary's lines").toEqual(expected.lines);

  const reading = d.queryByTestId("digital-twin-drawer-reading");
  const chip = d.queryByTestId("digital-twin-drawer-reading-provenance");
  if (expected.reading === null) {
    expect(reading, "no reading").toBeNull();
    expect(chip, "no reading chip").toBeNull();
  } else {
    expect(reading?.textContent, "reading").toBe(expected.reading.prose);
    expect(chip?.textContent, "reading chip").toBe(
      `source: ${expected.reading.source} · as of ${expected.reading.age}`
    );
  }

  const heading = d.queryByTestId("digital-twin-drawer-envelope-heading");
  if (expected.heading === null) {
    expect(heading, "no envelope heading").toBeNull();
    expect(d.queryByText("Freshness when read"), "no freshness").toBeNull();
  } else {
    expect(heading?.textContent, "envelope heading").toBe(expected.heading);
    expect(d.queryByText("Freshness")).toBeNull();
    const field = d.getByText("Freshness when read").parentElement!;
    const freshness = expected.freshness!;
    if ("reported" in freshness) {
      expect(field.textContent, "freshness").toBe(
        `Freshness when read${freshness.reported}`
      );
    } else {
      // UNKNOWN on the ignorance floor, saying why — never a plain value.
      expect(field.textContent, "freshness").toBe("Freshness when readUNKNOWN");
      const badge = within(field).getByText("UNKNOWN");
      expect(badge.getAttribute("title"), "why UNKNOWN").toBe(
        freshness.unknown
      );
      for (const token of UNKNOWN_AMBER.split(" ")) {
        expect(badge.classList.contains(token), `floor ${token}`).toBe(true);
      }
    }
  }
}

function expectRawAndTokens(drawer: HTMLElement, cell: Cell) {
  const d = within(drawer);
  const text = drawer.textContent ?? "";
  const token =
    cell.probe.kind === "answered" || cell.probe.kind === "held"
      ? cell.probe.answer!.token
      : undefined;
  if (cell.mode === "presenting") {
    expect(text).not.toMatch(/Raw (verdict|report)|raw data below/i);
    expect(
      d.queryByText("Probe error"),
      "no token while presenting"
    ).toBeNull();
    return;
  }
  // Operator mode: the raw JSON of a reading the drawer read, said as it is.
  const kind = ownReading(cell);
  if (kind !== null) {
    expect(
      d.getByText(kind === "report" ? "Raw report" : "Raw verdict")
    ).toBeInTheDocument();
    const tool = TOOL[cell.door as RawDoor];
    expect(d.getByTestId("digital-twin-drawer-raw-caption").textContent).toBe(
      cell.own?.kind === "retained"
        ? `The exact JSON an AI agent received from ${tool}, at this drawer's last read.`
        : `The exact JSON an AI agent receives from ${tool}.`
    );
  } else {
    expect(text).not.toMatch(/Raw (verdict|report)/);
  }
  if (token) {
    expect(d.getByText("Probe error").parentElement?.textContent).toBe(
      `Probe error${token}`
    );
  } else {
    expect(d.queryByText("Probe error")).toBeNull();
  }
}

/** What no sentence in any cell may say. */
function expectNoFalseSentence(drawer: HTMLElement, cell: Cell) {
  const text = drawer.textContent ?? "";
  // A reading is never aged by its own staleness.
  expect(text).not.toMatch(/data is \d/);
  // An age the envelope door did not report is never called live: coord
  // means a missing staleness as live only of a DriftVerdict. And an age it
  // did serve dates its worst bucket, never the whole reading.
  if (cell.shape === "envelope") {
    expect(text, "envelope age").not.toMatch(
      /live when read|Freshness when read\s*live|its data was/
    );
  }
  // An age that is UNKNOWN never blames coord: coord dates every bucket.
  expect(text, "no blame").not.toMatch(/coord reported no age/i);
  // Nothing points at a report the drawer may not show.
  expect(text).not.toMatch(/open the drawer/i);
  const liveHeadings = text.split(LIVE_HEADING).length - 1;
  const currentReading =
    (cell.own?.kind === "answered" && ownReading(cell) === "verdict") ||
    (cell.shape === "envelope" &&
      cell.probe.kind === "answered" &&
      cell.probe.answer!.envelopeProse !== undefined);
  expect(liveHeadings, "Live heading").toBe(currentReading ? 1 : 0);
  const pointer = text.includes("this drawer's own read of it");
  expect(pointer, "pointer").toBe(
    ownAnswered(cell) &&
      (cell.probe.kind === "unknown" ||
        ((cell.probe.kind === "answered" || cell.probe.kind === "held") &&
          cell.probe.answer!.notAReading))
  );
  if (ownAnswered(cell)) expect(text).not.toMatch(/no current reading/);
  expect(text.includes("Last answer:"), "last answer").toBe(
    cell.probe.kind === "held"
  );
}

/**
 * Rows the page does not probe: a manifest claim, whatever the probe holds.
 * Their drawer reads no probe answer, so no probe state may reach it.
 */
const CLAIMS = [
  {
    id: "gates",
    label: "Built · ask it",
    meaning:
      "Built — a coord tool answers it; ask it in Ask the Twin (Completeness tab). Not probed on this page.",
  },
  {
    id: "flow",
    label: "Not built",
    meaning: "Enumerated in the taxonomy but no observer exists yet.",
  },
] as const;

/** The probe states a claim row is checked under: one of each kind. */
const CLAIM_PROBE_ARMS = probeArms("schema").filter((arm) =>
  [
    "answered implemented",
    "held implemented after a failed refresh",
    "failed with nothing held",
    "degraded: coord unreachable",
    "held by react-query, offline",
    "in flight",
  ].includes(arm.name)
);

const UNOBSERVED = {
  unobservable:
    "SubspaceDetail.matrix.test.tsx mocks @qontinui/ui-bridge/react",
} as const;

beforeEach(() => {
  state.catalog = catalogDeclaring(MANIFEST_SNAPSHOT_IDS);
  state.raw = {};
});

afterEach(() => {
  onlineManager.setOnline(true);
});

describe("the drawer of a row the page does not probe, in every state of the probe", () => {
  for (const claim of CLAIMS) {
    for (const probe of CLAIM_PROBE_ARMS) {
      for (const mode of ["operator", "presenting"] as const) {
        it(`${claim.id} · probe ${probe.name} · ${mode}`, () => {
          probe.arrange("schema", Date.now());
          onlineManager.setOnline(probe.online ?? true);
          const view =
            mode === "presenting"
              ? renderInPresentationMode(<CoverageMatrix />, {
                  uiBridge: UNOBSERVED,
                })
              : render(<CoverageMatrix />);
          fireEvent.click(screen.getByTestId(`digital-twin-cell-${claim.id}`));
          const drawer = screen.getByRole("dialog");
          const d = within(drawer);
          expect(d.getByText("Status").parentElement?.textContent).toBe(
            `Status${claim.label}`
          );
          expect(
            d.getByTestId("digital-twin-drawer-status-meaning").textContent
          ).toBe(claim.meaning);
          // A claim has no reading to date, and nothing read to summarize.
          expect(
            d.queryByTestId("digital-twin-drawer-status-provenance")
          ).toBeNull();
          expect(d.queryByTestId("digital-twin-drawer-summary")).toBeNull();
          expect(
            d.queryByTestId("digital-twin-drawer-envelope-heading")
          ).toBeNull();
          expect(drawer.textContent).not.toMatch(
            /Last answer|no current reading|drawer's own read|Probe error|Raw (verdict|report)/
          );
          if (mode === "presenting") {
            expectPresentationSafe(
              view as ReturnType<typeof renderInPresentationMode>
            );
          }
        });
      }
    }
  }
});

describe("the sub-space drawer in every state of the reads behind it", () => {
  for (const cell of cells()) {
    it(cellName(cell), () => {
      const now = Date.now();
      state.catalog =
        cell.catalog === "held"
          ? catalogDeclaring(MANIFEST_SNAPSHOT_IDS)
          : { entries: [], total: 0, coord_error: "coord unreachable" };
      cell.probe.arrange(cell.door, now);
      if (cell.own) state.raw = { [cell.door]: cell.own.read(cell.door, now) };
      const online = cell.probe.online ?? cell.own?.online ?? true;
      onlineManager.setOnline(online);

      const view =
        cell.mode === "presenting"
          ? renderInPresentationMode(<CoverageMatrix />, {
              uiBridge: UNOBSERVED,
            })
          : render(<CoverageMatrix />);
      fireEvent.click(screen.getByTestId(`digital-twin-cell-${cell.door}`));
      const drawer = screen.getByRole("dialog");

      expectStatus(drawer, cell);
      expectSummary(drawer, cell);
      expectRawAndTokens(drawer, cell);
      expectNoFalseSentence(drawer, cell);
      if (cell.mode === "presenting") {
        expectPresentationSafe(
          view as ReturnType<typeof renderInPresentationMode>
        );
      }
    });
  }
});
