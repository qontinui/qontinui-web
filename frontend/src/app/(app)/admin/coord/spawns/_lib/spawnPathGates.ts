/**
 * spawnPathGates — the model of one SWITCH that governs a spawn path, as the
 * matrix shows it: where it is set, at what scope, whether it is enforced,
 * and what coord says its value is. The gates themselves are built per
 * source, each in its own module and each pure (every arm is unit-tested in
 * `spawnPathMatrix.test.ts`):
 *
 * | gates | module |
 * |---|---|
 * | a path's agent-registry row, and another row mirrored onto it | `registryGates.ts` |
 * | the next-step autonomy level and fleet flag | `nextStepGates.ts` |
 * | the merge-settings dial and knobs | `mergeSettingsGates.ts` |
 * | the post-merge follow-up scope, and the runner-local switches | `followupGates.ts` |
 *
 * ## The effective state is coord's, never this page's
 *
 * Each gate shows the value ONE served read gives it — the registry row's
 * tenant default (what coord enforces for the paths it starts), the next-step
 * settings' own `effective_state`, the merge settings' resolved dial, the
 * follow-up scope read. A path governed by several switches lists every one
 * this console can read, each with its own value, and the page never folds
 * them into one verdict: coord's authorization fold (strictest of the path's
 * own row and its class row) is coord's, and a second copy here could drift
 * from it (served policy `production-and-cost` `agent-spawn-authorization`;
 * the drift is how the 2026-08-03 outage looked).
 *
 * ## After a write, the read-back — never the value asked for
 *
 * A gate's value is always the latest READ. A write records what was asked
 * (`SwitchWrite`); the gate then compares the read that follows with it and
 * says whether coord reads back what was asked, or contradicts it
 * ({@link withWrite}). A write whose outcome coord could not confirm, or whose
 * read-back failed, makes the gate UNKNOWN, whatever was retained, until a read
 * answers. The mark belongs to the read that settled the write
 * (`SwitchWrite.settledState`): a later read that differs is a later change,
 * said as one, never a read-back that contradicts the write.
 *
 * ## UNKNOWN names its source
 *
 * Every value a read could not supply renders UNKNOWN with the read named and
 * why; a stale value (the latest refresh failed, the last answer kept) says
 * it is stale. In presentation mode each gate says it in its own fixed words
 * (every sentence has a presenting arm): a failure text can quote a URL or
 * coord's words, and a presented sentence names "the coordination service".
 */

import type { AutonomyLevel } from "@/lib/api/operations/coordSettings";
import type { EffectiveProfile } from "@/lib/api/operations/prMerge";
import type {
  AutoFixPrChoice,
  AutoFixPrState,
} from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import type { RepoDialReading } from "@/app/(app)/admin/coord/agent-registry/_lib/repoFollowupStatus";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One read the matrix depends on, as its hook holds it. */
export interface ReadPart<T> {
  /** The last good answer, or `null` before one. */
  data: T | null;
  /** The latest read's failure; `null` after a success. With `data`: stale. */
  error: string | null;
  /** When `data` was true (the answer's arrival); `null` before one. */
  asOfMs: number | null;
  /** No read has settled yet. */
  loading: boolean;
}

/**
 * The merge settings as `useAutoFixPrSetting` holds them: the PR fixer dial,
 * and the tenant-level profile it was read from (whose other knobs the matrix
 * shows too).
 */
export interface MergeSettingsRead {
  loading: boolean;
  /** The latest read's failure: the dial and the profile are then UNKNOWN. */
  error: string | null;
  /** `null` when loaded but this coord does not serve the dial. */
  dial: AutoFixPrState | null;
  /** `null` before an answer, and after a failed read. */
  profile: EffectiveProfile | null;
}

/** The per-repo follow-up scopes as `useRepoFollowupDials` holds them. */
export interface FollowupRead {
  loading: boolean;
  repos: string[] | null;
  reposError: string | null;
  readings: Readonly<Record<string, RepoDialReading>>;
}

/** A write the operator made from the matrix, keyed by the gate it targets. */
export interface SwitchWrite {
  /** What was asked, in the gate's own vocabulary (`on` / `off`, a level, a choice). */
  asked: string;
  /**
   * `writing` — the request is in flight.
   * `unconfirmed` — it ended without coord saying whether it landed, and a
   *   re-read is in flight: the value is UNKNOWN until that read settles.
   * `written` — a read made after the write settled (see `readbackError`).
   * `refused` — coord refused it: nothing changed as far as coord said.
   */
  phase: "writing" | "unconfirmed" | "written" | "refused";
  /** `refused`: coord's reason. `unconfirmed`: why the outcome is unknown. */
  error: string | null;
  /** `written`: the read made after the write failed — the value is UNKNOWN. */
  readbackError: string | null;
  /** `written`: the write's own outcome was unknown; the value is a later read's. */
  outcomeUnknown?: boolean;
  /**
   * The value, in the gate's vocabulary, of the read this write settled on:
   * `written` — the read-back; `refused` — what coord held when it refused.
   * `null` or absent when no value was read. A cell that differs from it is
   * showing a LATER read, and says nothing about this write.
   */
  settledState?: string | null;
}

/**
 * How a finished write ended, for a caller that cannot see the matrix (a UI
 * Bridge action): the same read-back the cell shows, never the request.
 *
 * - `read_back` — coord read back what was asked.
 * - `contradicted` — coord read back something else.
 * - `refused` — coord refused it.
 * - `unknown` — no read says what coord holds now.
 */
export type SwitchWriteOutcome =
  | "read_back"
  | "contradicted"
  | "refused"
  | "unknown";

export interface SwitchWriteResult {
  outcome: SwitchWriteOutcome;
  asked: string;
  /** What the settling read gave, in the gate's vocabulary. */
  readBack: string | null;
  /** Why it is not `read_back`, in the operator's words. */
  message: string | null;
}

/** A finished write's outcome, from what it recorded. */
export function switchWriteResult(write: SwitchWrite): SwitchWriteResult {
  const { asked } = write;
  const readBack = write.settledState ?? null;
  if (write.phase === "refused") {
    return {
      outcome: "refused",
      asked,
      readBack: null,
      message: `coord refused the change to ${asked}: ${write.error ?? "no reason given"}`,
    };
  }
  if (write.phase !== "written") {
    return {
      outcome: "unknown",
      asked,
      readBack: null,
      message: `the change to ${asked} has not settled`,
    };
  }
  if (write.readbackError !== null) {
    return {
      outcome: "unknown",
      asked,
      readBack: null,
      message: `reading back the change to ${asked} failed: ${write.readbackError}`,
    };
  }
  if (readBack === null) {
    return {
      outcome: "unknown",
      asked,
      readBack: null,
      message: `the read made after the change to ${asked} serves no value for this switch`,
    };
  }
  if (readBack !== asked) {
    return {
      outcome: "contradicted",
      asked,
      readBack,
      message: `asked for ${asked}; coord reads back ${readBack}`,
    };
  }
  return { outcome: "read_back", asked, readBack, message: null };
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type CellTone = "known" | "unknown" | "contradiction";

/** One value in the matrix. */
export interface GateCell {
  /** Machine-readable value (`on`, `off`, a level, `unknown`, …). */
  state: string;
  /** The words shown. */
  text: string;
  /** More, on hover. */
  title?: string;
  tone: CellTone;
  /** The value is the last good read: the latest refresh failed. */
  stale: boolean;
  /** After a write: what was asked, and whether coord reads it back. */
  readBack?: { asked: string; askedText: string; matches: boolean };
  /** A write's own outcome, shown beside the value. */
  writeNote?: string;
}

export type GateScope = "tenant" | "repo" | "device" | "environment variable";

export type EnforcedKind =
  | "enforce"
  | "shadow"
  | "off"
  | "env-only"
  | "runner-only"
  | "unknown";

export interface GateEnforcement {
  kind: EnforcedKind;
  text: string;
  title: string;
}

/** What a gate's control writes, when it has one. */
export type GateWrite =
  | {
      door: "registry";
      agentName: string;
      /** The tenant default coord reads now. */
      current: boolean;
    }
  | {
      door: "next_step";
      domain: string;
      level: AutonomyLevel;
      /**
       * The level is coord's built-in default, with no policy row behind it
       * (`autonomy_level_source: code_fallback`): choosing that same level
       * still writes something, the row that makes it take effect.
       */
      builtInDefault: boolean;
    }
  | {
      door: "auto_fix_pr";
      choice: AutoFixPrChoice;
    }
  | {
      door: "auto_fix_red_main";
      /** The tenant-level value coord reads now. */
      current: boolean;
    };

/** One switch that governs a path. */
export interface MatrixGate {
  /** Stable key — also the write's key (`registry:<name>`, `autonomy:<domain>` …). */
  key: string;
  /** The switch, named. */
  title: string;
  /** Where it is set. */
  where: string;
  scope: GateScope;
  /** A second scope that can override it, in words. */
  scopeNote?: string;
  enforced: GateEnforcement;
  /** Coord's value for it. */
  effective: GateCell;
  /**
   * Operator mode only: the signed-in member's OWN preference row, when one
   * is recorded — never the path's state (coord's enforcement of the paths it
   * starts reads the tenant default), and never built while presenting.
   */
  preference?: GateCell;
  /** The control, or `null` when this gate is read-only here. */
  write: GateWrite | null;
  /** Why there is no control, when there is none — in the reader's words. */
  readOnly?: string;
  /** A link to where it IS set, when that is another console page. */
  setOn?: { href: string; label: string };
  /** This gate is another row's switch, shown here read-only. */
  mirrorOf?: string;
}

// ---------------------------------------------------------------------------
// Shared words
// ---------------------------------------------------------------------------

export function unknownCell(text: string, title?: string): GateCell {
  return { state: "unknown", text, title, tone: "unknown", stale: false };
}

/** The UNKNOWN a write leaves when what coord resolves after it is not known. */
function unknownAfterWrite(
  operatorTitle: string,
  writeNote: string,
  presenting: boolean
): GateCell {
  return {
    state: "unknown",
    text: "UNKNOWN",
    title: presenting
      ? "What the coordination service reads for this switch is unknown until its next read."
      : operatorTitle,
    tone: "unknown",
    stale: false,
    writeNote: presenting ? undefined : writeNote,
  };
}

/** The cell is showing a read later than the one the write settled on. */
function changedSince(cell: GateCell, write: SwitchWrite): boolean {
  return (
    write.settledState !== undefined &&
    write.settledState !== null &&
    cell.state !== write.settledState
  );
}

/**
 * Stamp a write's outcome onto the cell its read produced. While presenting
 * the value is coord's alone — no note about an operator's request — but an
 * outcome that leaves the value unknown is UNKNOWN in both modes.
 *
 * The mark is about the read that settled the write, and lasts while later
 * reads give the same value. Once one differs the value has moved since: a
 * refusal's note goes, and a read-back's mark becomes a note saying so, in the
 * cell's own tone. Nothing about that later value contradicts this write.
 */
export function withWrite(
  cell: GateCell,
  write: SwitchWrite | undefined,
  askedText: (asked: string) => string,
  presenting: boolean
): GateCell {
  if (!write) return cell;
  const asked = askedText(write.asked);
  switch (write.phase) {
    case "writing":
      return presenting ? cell : { ...cell, writeNote: `Writing ${asked}…` };
    case "unconfirmed":
      return unknownAfterWrite(
        `Coord could not confirm whether your change to ${asked} landed (${write.error ?? "no reason given"}); re-reading what it serves.`,
        "Outcome unknown — re-reading what coord serves.",
        presenting
      );
    case "refused":
      return presenting || changedSince(cell, write)
        ? cell
        : {
            ...cell,
            writeNote: `Your change to ${asked} was refused: ${write.error ?? "no reason given"}. The value shown is what coord reads.`,
          };
    case "written":
      break;
  }
  // Until a read answers. The read that failed left its source stale or
  // unknown; once a later read succeeds, that read is what is compared.
  if (write.readbackError !== null && (cell.stale || cell.tone === "unknown")) {
    return unknownAfterWrite(
      `Written (${asked}), but reading it back failed: ${write.readbackError}. What coord resolves is unknown until the next read.`,
      "Written, but reading it back failed — UNKNOWN until the next read.",
      presenting
    );
  }
  if (cell.tone === "unknown" || presenting) return cell;
  if (changedSince(cell, write)) {
    return {
      ...cell,
      writeNote: `Changed since your write: coord read back ${askedText(write.settledState as string)} after it, and a later read differs.`,
    };
  }
  const matches = cell.state === write.asked;
  return {
    ...cell,
    tone: matches ? cell.tone : "contradiction",
    readBack: { asked: write.asked, askedText: asked, matches },
    writeNote:
      write.outcomeUnknown || write.readbackError !== null
        ? "Coord could not confirm the write itself; this is a read made after it."
        : cell.writeNote,
  };
}

export const ON_OFF_TEXT = (asked: string): string =>
  asked === "on" ? "on" : "off";
