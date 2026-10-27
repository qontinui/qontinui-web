/**
 * The Twin map's aspects — the environment, process and intent twins plus the
 * UI Bridge app twin — and each one's fidelity (plan
 * `2026-10-23-console-presentation-spaces` Phase 5).
 *
 * Fidelity is four figures per aspect, each from ONE named source so the
 * presentation lens can put that source and its age beside it (`Provenance`):
 *
 * | figure | environment / process / intent | UI Bridge app twin |
 * |---|---|---|
 * | observed | live probes answering, of those coord answers this workspace with a verdict (coord's live twin probe) | apps registered with the runner's UI Bridge |
 * | coverage | the answering probes' own average coverage | pages of the runner's own interface with a readable model |
 * | staleness | the oldest answering reading; UNKNOWN when one came with no age (the envelope door reports none) | UNKNOWN: the models carry no time |
 * | honesty | violations among the parts coord's twin self-check measures | UNKNOWN: the self-check does not cover interface models |
 *
 * Nothing here is ever a zero standing in for an unknown: a failed read, a
 * degraded probe answer (no probe made — the rule `probe-read.ts`
 * `probeUnread` gives every view of the probe), a refused one, a twin nothing probes
 * live, and a report with no per-part rows are each a labelled UNKNOWN naming
 * why (`verification-and-evidence` `unknown-must-not-render-as-a-default`). A measured zero — "no violations"
 * over parts the self-check judged — is a real zero and says what it covers.
 *
 * Pure functions (unit-tested in `twin-aspects.test.ts`).
 */

import type { CaptionKey } from "@/components/presentation";
import { statusSuffix } from "./failure-text";
import { coverageOf, gradedOf } from "./lifecycle";
import { probeUnread, type ProbeRead, type ProbeSilence } from "./probe-read";
import { formatRatio, readingAge } from "./status-presentation";
import {
  formatAge,
  readFidelity,
  reportComputedAt,
  reportSubspaces,
  type FidelityQueryState,
} from "./twin-fidelity";
import type { ResolvedSubspace, SubspaceManifestEntry } from "./types";
import {
  summarizeSpecGraph,
  type AppListResponse,
  type SpecGraphResponse,
} from "./ui-bridge-types";

// ---------------------------------------------------------------------------
// The aspects.
// ---------------------------------------------------------------------------

export type TwinAspectId = "environment" | "process" | "intent" | "ui-bridge";

export interface TwinAspect {
  readonly id: TwinAspectId;
  /** Its card's caption — title, one-liner and why it matters. */
  readonly captionKey: CaptionKey;
  /**
   * What a sentence calls it ("the plans moving the UI Bridge app twin"):
   * its own casing, never a lower-cased title, which would lower a proper
   * noun.
   */
  readonly noun: string;
  /** Whether a manifest row is one of this aspect's parts. */
  readonly includes: (
    row: Pick<SubspaceManifestEntry, "twin" | "layer">
  ) => boolean;
}

/**
 * The aspects, in display order. The first three are the manifest's three
 * coupled twins (`twin`), which partition its rows. The UI Bridge app twin is
 * a CUT across them, not a fourth plant: the rows the UI Bridge layer observes
 * (`layer: "ui-bridge"`), which also belong to the environment twin, plus the
 * runner's model of each app's interface.
 */
export const TWIN_ASPECTS: readonly TwinAspect[] = [
  {
    id: "environment",
    captionKey: "digital-twin.aspect-environment",
    noun: "environment twin",
    includes: (row) => row.twin === "environment",
  },
  {
    id: "process",
    captionKey: "digital-twin.aspect-process",
    noun: "process twin",
    includes: (row) => row.twin === "process",
  },
  {
    id: "intent",
    captionKey: "digital-twin.aspect-intent",
    noun: "intent twin",
    includes: (row) => row.twin === "intent",
  },
  {
    id: "ui-bridge",
    captionKey: "digital-twin.aspect-ui-bridge",
    noun: "UI Bridge app twin",
    includes: (row) => row.layer === "ui-bridge",
  },
];

/** An aspect by id; throws on an id outside {@link TWIN_ASPECTS}. */
export function twinAspect(id: TwinAspectId): TwinAspect {
  const aspect = TWIN_ASPECTS.find((a) => a.id === id);
  if (!aspect) throw new Error(`unknown twin aspect: ${id}`);
  return aspect;
}

/** A part's name in words: its sub-space id with spaces (`merge_train` → `merge train`). */
export function partName(id: string): string {
  return id.replace(/_/g, " ");
}

/** The rows that are this aspect's parts, in the order given. */
export function aspectRows<
  T extends Pick<SubspaceManifestEntry, "twin" | "layer">,
>(aspect: TwinAspect, rows: readonly T[]): T[] {
  return rows.filter((row) => aspect.includes(row));
}

// ---------------------------------------------------------------------------
// Fidelity figures.
// ---------------------------------------------------------------------------

export type FidelityKey = "observed" | "coverage" | "staleness" | "honesty";

export const FIDELITY_KEYS: readonly FidelityKey[] = [
  "observed",
  "coverage",
  "staleness",
  "honesty",
];

export const FIDELITY_LABEL: Readonly<Record<FidelityKey, string>> = {
  observed: "Observed",
  coverage: "Coverage",
  staleness: "Staleness",
  honesty: "Honesty",
};

/** Where a figure comes from, in the reader's words (the provenance source). */
export const FIDELITY_SOURCE = {
  probe: "coord's live twin probe",
  selfCheck: "coord's twin self-check",
  appRegistry: "the runner's app registry",
  appModels: "the runner's interface models",
} as const;

export type FidelityFigure =
  | {
      readonly key: FidelityKey;
      readonly state: "known";
      readonly value: string;
      /** What the value covers, in one clause. */
      readonly detail: string;
      readonly source: string;
      readonly asOf: string | number | null;
    }
  | {
      readonly key: FidelityKey;
      readonly state: "unknown";
      /** Why there is no figure — always said, never a blank. */
      readonly reason: string;
      readonly source: string;
      /** When the attempt that established the UNKNOWN was made, if known. */
      readonly asOf: string | number | null;
    }
  | {
      readonly key: FidelityKey;
      readonly state: "loading";
      readonly source: string;
    };

/** The reason a whole twin's live readings are missing because coord refused them. */
export const RESTRICTED_REASON =
  "coord does not share the twin's live readings with this workspace";

/** The reason the self-check is missing for a workspace coord does not show it to (a 403). */
export const SELF_CHECK_INTERNAL_REASON =
  "coord shares its twin self-check only with Qontinui's own workspace";

/** The twin-fidelity report query, with its timestamps. */
export interface ReportRead extends FidelityQueryState {
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function isAnswering(row: ResolvedSubspace): boolean {
  return (
    row.liveProbed &&
    (row.cellStatus === "implemented" || row.cellStatus === "partial")
  );
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * The reason the probe says nothing about `rows`, or `null` when it does.
 * Shared by the three probe-sourced figures, so they cannot disagree; and it
 * starts from `probeUnread`, the rule the Completeness and Lifecycle views
 * apply too, so no view of the probe counts what another calls UNKNOWN.
 */
function probeSilence(
  rows: readonly ResolvedSubspace[],
  probe: ProbeRead
): ProbeSilence | "probing" | null {
  const unread = probeUnread(probe);
  if (unread) return unread;
  if (probe.restricted) return { reason: RESTRICTED_REASON, asOf: probe.asOf };
  const counts = coverageOf(rows);
  if (counts.probed === 0) {
    return {
      reason:
        "nothing in this twin is probed live yet; its parts answer only when asked",
      asOf: probe.asOf,
    };
  }
  if (counts.pending > 0) return "probing";
  if (gradedOf(counts) === 0) {
    return {
      reason:
        counts.served > 0
          ? "coord answered this twin's probes with reports rather than verdicts"
          : "coord does not share this twin's live readings with this workspace",
      asOf: probe.asOf,
    };
  }
  return null;
}

function observedFigure(
  rows: readonly ResolvedSubspace[],
  probe: ProbeRead
): FidelityFigure {
  const source = FIDELITY_SOURCE.probe;
  const silence = probeSilence(rows, probe);
  if (silence === "probing")
    return { key: "observed", state: "loading", source };
  if (silence) return { key: "observed", state: "unknown", source, ...silence };
  const counts = coverageOf(rows);
  return {
    key: "observed",
    state: "known",
    value: `${counts.live} of ${gradedOf(counts)}`,
    detail: `live probes answering; ${counts.probed} of ${plural(counts.total, "part")} probed live`,
    source,
    asOf: probe.asOf,
  };
}

function coverageFigure(
  rows: readonly ResolvedSubspace[],
  probe: ProbeRead
): FidelityFigure {
  const source = FIDELITY_SOURCE.probe;
  const silence = probeSilence(rows, probe);
  if (silence === "probing")
    return { key: "coverage", state: "loading", source };
  if (silence) return { key: "coverage", state: "unknown", source, ...silence };
  const answering = rows.filter(isAnswering);
  if (answering.length === 0) {
    return {
      key: "coverage",
      state: "unknown",
      reason: "no live probe in this twin is answering",
      source,
      asOf: probe.asOf,
    };
  }
  const values = answering.map((r) => r.metrics?.coverage).filter(finite);
  if (values.length === 0) {
    return {
      key: "coverage",
      state: "unknown",
      reason: "the answering probes report no coverage",
      source,
      asOf: probe.asOf,
    };
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    key: "coverage",
    state: "known",
    value: formatRatio(mean),
    detail: `average over ${plural(values.length, "answering probe")}`,
    source,
    asOf: probe.asOf,
  };
}

function stalenessFigure(
  rows: readonly ResolvedSubspace[],
  probe: ProbeRead
): FidelityFigure {
  const source = FIDELITY_SOURCE.probe;
  const silence = probeSilence(rows, probe);
  if (silence === "probing")
    return { key: "staleness", state: "loading", source };
  if (silence)
    return { key: "staleness", state: "unknown", source, ...silence };
  const answering = rows.filter(isAnswering);
  if (answering.length === 0) {
    return {
      key: "staleness",
      state: "unknown",
      reason: "no live probe in this twin is answering",
      source,
      asOf: probe.asOf,
    };
  }
  // Each reading's age as its door reports it: coord omits a DriftVerdict's
  // `staleness_seconds` on an answer it computed live, but an envelope door
  // reports no age at all, so its reading's age is UNKNOWN (`readingAge`).
  const ages = answering.map((row) => ({
    row,
    age: readingAge(row.metrics?.staleness_seconds, row.doorShape),
  }));
  const undated = ages.filter((a) => a.age === null).map((a) => a.row);
  const dated = ages.flatMap((a) => (typeof a.age === "number" ? [a.age] : []));
  if (undated.length > 0) {
    // Any reading of unknown age may be the oldest, so the oldest is unknown.
    return {
      key: "staleness",
      state: "unknown",
      reason: undatedReason(undated, answering.length, dated),
      source,
      asOf: probe.asOf,
    };
  }
  if (dated.length === 0) {
    return {
      key: "staleness",
      state: "known",
      value: "read live",
      detail: `all ${plural(answering.length, "answering probe")} read live`,
      source,
      asOf: probe.asOf,
    };
  }
  return {
    key: "staleness",
    state: "known",
    value: formatAge(Math.max(...dated)),
    detail: `the oldest of ${plural(answering.length, "answering reading")}`,
    source,
    asOf: probe.asOf,
  };
}

/**
 * Why a twin's oldest reading is UNKNOWN: which answering readings came with
 * no age, and what the others say.
 */
function undatedReason(
  undated: readonly ResolvedSubspace[],
  answering: number,
  dated: readonly number[]
): string {
  const names = undated.map((row) => partName(row.id));
  const whose =
    names.length === 1
      ? `${names[0]}'s reading`
      : `the readings of ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const others = answering - undated.length;
  const oldest = dated.length === 0 ? null : formatAge(Math.max(...dated));
  let rest = "";
  if (others === 1) {
    rest =
      oldest === null
        ? "; the other answering probe read live"
        : `; the other answering reading is ${oldest}`;
  } else if (others > 1) {
    rest =
      oldest === null
        ? `; the other ${others} answering probes read live`
        : `; the oldest of the other ${others} answering readings is ${oldest}`;
  }
  return `coord reported no age for ${whose}${rest}`;
}

function honestyFigure(
  rows: readonly ResolvedSubspace[],
  report: ReportRead,
  now: number
): FidelityFigure {
  const source = FIDELITY_SOURCE.selfCheck;
  const read = readFidelity(report, now);
  const failedAt = report.errorUpdatedAt > 0 ? report.errorUpdatedAt : null;
  if (read.kind === "loading")
    return { key: "honesty", state: "loading", source };
  if (read.kind === "internal") {
    return {
      key: "honesty",
      state: "unknown",
      reason: SELF_CHECK_INTERNAL_REASON,
      source,
      asOf: failedAt,
    };
  }
  if (read.kind === "unknown") {
    return {
      key: "honesty",
      state: "unknown",
      reason: read.reason,
      source,
      asOf: failedAt,
    };
  }
  const asOf = reportComputedAt(report.data, now);
  const parts = reportSubspaces(report.data);
  if (!parts) {
    return {
      key: "honesty",
      state: "unknown",
      reason:
        "the self-check gives no per-part breakdown, so it cannot be split by twin",
      source,
      asOf,
    };
  }
  const measured = rows.flatMap((row) => {
    const part = parts.get(row.id);
    return part ? [part] : [];
  });
  if (measured.length === 0) {
    return {
      key: "honesty",
      state: "unknown",
      reason: "coord's twin self-check does not measure this twin yet",
      source,
      asOf,
    };
  }
  const judged = measured.filter((part) => part.honest !== null);
  if (judged.length === 0) {
    return {
      key: "honesty",
      state: "unknown",
      reason: "the self-check could not judge any of this twin's parts",
      source,
      asOf,
    };
  }
  const violations = judged.filter((part) => part.honest === false).length;
  const unjudged = measured.length - judged.length;
  return {
    key: "honesty",
    state: "known",
    value: violations === 0 ? "no violations" : plural(violations, "violation"),
    detail:
      `over ${plural(judged.length, "part")} the self-check judged` +
      (unjudged > 0 ? `; ${unjudged} more it could not judge` : ""),
    source,
    asOf,
  };
}

/** The four figures of the environment, process or intent twin. */
export function plantFidelity(
  rows: readonly ResolvedSubspace[],
  probe: ProbeRead,
  report: ReportRead,
  now: number
): FidelityFigure[] {
  return [
    observedFigure(rows, probe),
    coverageFigure(rows, probe),
    stalenessFigure(rows, probe),
    honestyFigure(rows, report, now),
  ];
}

// ---------------------------------------------------------------------------
// The UI Bridge app twin.
// ---------------------------------------------------------------------------

/** A relay read, as react-query reports it. */
export interface RelayRead<T> {
  readonly data: T | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly dataUpdatedAt: number;
  readonly errorUpdatedAt: number;
}

export interface AppTwinRead {
  /** The runner the page targets, or `null` when none is connected. */
  readonly deviceId: string | null;
  /** The runner's app registry (`GET /apps`). */
  readonly apps: RelayRead<AppListResponse>;
  /** The state graph of the runner's own interface (`apps/qontinui-runner/spec/graph`). */
  readonly graph: RelayRead<SpecGraphResponse>;
}

export const NO_RUNNER_REASON =
  "no runner is connected, so the app twin cannot be read";

const at = (ms: number): number | null => (ms > 0 ? ms : null);

function appsFigure(read: AppTwinRead): FidelityFigure {
  const source = FIDELITY_SOURCE.appRegistry;
  if (!read.deviceId) {
    return {
      key: "observed",
      state: "unknown",
      reason: NO_RUNNER_REASON,
      source,
      asOf: null,
    };
  }
  const { apps } = read;
  if (apps.isLoading) return { key: "observed", state: "loading", source };
  if (!apps.data) {
    return {
      key: "observed",
      state: "unknown",
      reason: `the runner's app registry could not be read${statusSuffix(apps.error)}`,
      source,
      asOf: at(apps.errorUpdatedAt),
    };
  }
  if (!Array.isArray(apps.data.apps)) {
    return {
      key: "observed",
      state: "unknown",
      reason: "the runner answered without listing its apps",
      source,
      asOf: at(apps.dataUpdatedAt),
    };
  }
  return {
    key: "observed",
    state: "known",
    value: plural(apps.data.apps.length, "app"),
    detail: "registered with the runner's UI Bridge",
    source,
    asOf: at(apps.dataUpdatedAt),
  };
}

function modelsFigure(read: AppTwinRead): FidelityFigure {
  const source = FIDELITY_SOURCE.appModels;
  if (!read.deviceId) {
    return {
      key: "coverage",
      state: "unknown",
      reason: NO_RUNNER_REASON,
      source,
      asOf: null,
    };
  }
  const { graph } = read;
  if (graph.isLoading) return { key: "coverage", state: "loading", source };
  if (!graph.data) {
    return {
      key: "coverage",
      state: "unknown",
      reason: `the runner's model of its own interface could not be read${statusSuffix(graph.error)}`,
      source,
      asOf: at(graph.errorUpdatedAt),
    };
  }
  const summary = summarizeSpecGraph(graph.data);
  if (summary.pages === 0) {
    return {
      key: "coverage",
      state: "unknown",
      reason: "the runner has no interface pages modelled yet",
      source,
      asOf: at(graph.dataUpdatedAt),
    };
  }
  return {
    key: "coverage",
    state: "known",
    value: `${summary.pages - summary.unreadablePages} of ${summary.pages}`,
    detail: "pages of the runner's own interface with a readable model",
    source,
    asOf: at(graph.dataUpdatedAt),
  };
}

/** The four figures of the UI Bridge app twin. */
export function appTwinFidelity(read: AppTwinRead): FidelityFigure[] {
  return [
    appsFigure(read),
    modelsFigure(read),
    {
      key: "staleness",
      state: "unknown",
      reason: read.deviceId
        ? "the runner's interface models carry no time they were made"
        : NO_RUNNER_REASON,
      source: FIDELITY_SOURCE.appModels,
      asOf: null,
    },
    {
      key: "honesty",
      state: "unknown",
      reason: "coord's twin self-check does not cover interface models yet",
      source: FIDELITY_SOURCE.selfCheck,
      asOf: null,
    },
  ];
}
