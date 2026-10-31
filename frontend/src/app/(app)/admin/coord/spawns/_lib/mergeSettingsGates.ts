/**
 * mergeSettingsGates — the tenant merge-settings switches that gate a fixer
 * path besides its registry row, all read from ONE read of
 * `GET /pr-merge/settings` (`useAutoFixPrSetting`, the settings page's hook):
 *
 * | gate | path | read | write |
 * |---|---|---|---|
 * | the `auto_fix_pr` dial | PR fixer | `auto_fix_pr_tenant` / `auto_fix_pr` / `auto_fix_pr_source` | `PATCH {auto_fix_pr}` (the hook's `setChoice`) |
 * | the `auto_fix_red_main` knob | red-main fixer | `profile.auto_fix_red_main` | `PATCH {auto_fix_red_main}` |
 * | the `auto_fix_admission_stall` knob | stalled-train responder | `profile.rulebook_overrides.auto_fix_admission_stall` | none here |
 *
 * Coord names the two knobs as conjuncts of exactly those paths: "the
 * per-(tenant, repo) `auto_fix_red_main` knob checked at gate 3" and "the
 * per-TENANT `auto_fix_admission_stall` knob" (`next_step_settings.rs`). With
 * either off, coord does not even consult the path's fixer.
 *
 * The admission-stall knob has no column of its own: it is one key of the
 * tenant's `rulebook_overrides` jsonb, which the settings PATCH replaces
 * WHOLE. A one-key write from here would have to re-send every other key it
 * read, and could erase one written meanwhile, so the matrix does not write
 * it. And when the key is absent the read serves no value at all — coord
 * resolves its own default in its place, which only
 * `coord_fixer_arm_readiness` reports — so the gate is UNKNOWN, naming the
 * missing read, rather than this page's copy of coord's default.
 */

import {
  autoFixPrAbsence,
  dialChoice,
  tenantSummary,
  type AutoFixPrChoice,
  type AutoFixPrSource,
} from "@/app/(app)/settings/coordination/_hooks/auto-fix-pr";
import {
  ON_OFF_TEXT,
  unknownCell,
  withWrite,
  type GateCell,
  type MatrixGate,
  type MergeSettingsRead,
  type SwitchWrite,
} from "./spawnPathGates";

/** The merge settings' own unread arms, or `null` when the read answered. */
function mergeSettingsUnread(
  read: MergeSettingsRead,
  presenting: boolean
): GateCell | null {
  if (read.error !== null) {
    return unknownCell(
      "UNKNOWN",
      presenting
        ? "The project's merge settings could not be read."
        : `The merge settings could not be read: ${read.error}.`
    );
  }
  if (read.profile === null && read.dial === null) {
    // "Still being read" only while a read is out: an answered read with no
    // profile is a different fact, in either mode.
    const title = read.loading
      ? presenting
        ? "The project's merge settings are still being read."
        : "The merge settings are still being read."
      : presenting
        ? "The project's merge settings answered with no settings."
        : "The merge settings answered with no profile.";
    return unknownCell("UNKNOWN", title);
  }
  return null;
}

// ---------------------------------------------------------------------------
// The PR fixer dial
// ---------------------------------------------------------------------------

const DIAL_CHOICE_TEXT: Record<AutoFixPrChoice, string> = {
  default: "follow the default",
  on: "on",
  off: "off",
};

/** Where the dial's value came from, in an outsider's words. */
const PRESENTED_DIAL_SOURCE: Record<AutoFixPrSource, string> = {
  default: "From the project's default.",
  tenant: "From the project's own setting.",
  repo: "From one of the project's repositories.",
  unknown: "The project's setting could not be read.",
};

export function fixerDialGate(
  read: MergeSettingsRead,
  write: SwitchWrite | undefined,
  presenting: boolean
): MatrixGate {
  const askedText = (asked: string) =>
    DIAL_CHOICE_TEXT[asked as AutoFixPrChoice] ?? asked;
  let effective: GateCell;
  const unread = mergeSettingsUnread(read, presenting);
  if (unread !== null) {
    effective =
      read.error !== null && !presenting
        ? {
            ...unread,
            title: `${unread.title} Whether coord starts PR fixers right now is unknown.`,
          }
        : unread;
  } else if (read.dial === null) {
    const malformed = autoFixPrAbsence(read.profile) === "malformed";
    effective = unknownCell(
      "UNKNOWN",
      presenting
        ? malformed
          ? "The project's setting could not be read."
          : "The coordination service does not offer this setting yet."
        : malformed
          ? "This coord's answer for the auto_fix_pr dial is not one this page can read, so it is not settable here."
          : "This coord does not serve the auto_fix_pr dial yet, so it is not settable here."
    );
  } else {
    const summary = tenantSummary(read.dial);
    effective = {
      state: dialChoice(read.dial) ?? "unknown",
      text: summary.value,
      title: presenting
        ? PRESENTED_DIAL_SOURCE[read.dial.source]
        : `${summary.detail.charAt(0).toUpperCase()}${summary.detail.slice(1)}.`,
      tone: summary.tone === "unknown" ? "unknown" : "known",
      stale: false,
    };
  }
  const shown = withWrite(effective, write, askedText, presenting);
  return {
    key: "dial:auto_fix_pr",
    title: "Fixer dial for stuck PRs",
    where: presenting
      ? "A project setting: whether fixers start for stuck pull requests."
      : "Merge settings: Spawn fixer sessions for stuck PRs (auto_fix_pr) — PATCH /pr-merge/settings.",
    scope: "tenant",
    scopeNote: presenting
      ? "A repository can also switch it off."
      : "A repository can also switch it off in its committed .qontinui/config.yml (merge.auto_fix_pr: false); an explicit off at any scope wins.",
    enforced: {
      kind: "enforce",
      text: "enforce",
      title: presenting
        ? "No fixer starts for a stuck pull request while it resolves off."
        : "Coord starts no PR fixer while the dial resolves off.",
    },
    effective: shown,
    // Still settable while the value is unknown, with no position selected:
    // what a write left unknown is not the position the last read held.
    write:
      read.dial === null || read.error !== null
        ? null
        : {
            door: "auto_fix_pr",
            choice: shown.state === "unknown" ? null : dialChoice(read.dial),
          },
    readOnly:
      read.dial === null || read.error !== null
        ? presenting
          ? "The setting could not be read."
          : "The dial could not be read, so it is not offered."
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// The red-main fixer knob
// ---------------------------------------------------------------------------

export function redMainKnobGate(
  read: MergeSettingsRead,
  write: SwitchWrite | undefined,
  presenting: boolean
): MatrixGate {
  const raw = read.profile?.auto_fix_red_main;
  const known = read.error === null && typeof raw === "boolean";
  let value: GateCell;
  const unread = mergeSettingsUnread(read, presenting);
  if (unread !== null) {
    value = unread;
  } else if (typeof raw !== "boolean") {
    value = unknownCell(
      "UNKNOWN",
      presenting
        ? "The coordination service does not report this setting."
        : "This coord's merge settings carry no auto_fix_red_main value, so the knob is unknown — not on."
    );
  } else {
    value = {
      state: raw ? "on" : "off",
      text: raw ? "On" : "Off",
      title: presenting
        ? "The project's setting."
        : "Coord's tenant-level value: the tenant's own setting over its built-in default. A repository's own override is not part of this read.",
      tone: "known",
      stale: false,
    };
  }
  return {
    key: "knob:auto_fix_red_main",
    title: "Fixer knob for failing main branches",
    where: presenting
      ? "A project setting: whether a failing main branch is handed to a fixer."
      : "Merge settings: auto_fix_red_main for the tenant — PATCH /pr-merge/settings.",
    scope: "tenant",
    scopeNote: presenting
      ? "A repository can override it."
      : "A repository's merge profile can override it (its own auto_fix_red_main); a repository with no override follows this value.",
    enforced: {
      kind: "enforce",
      text: "enforce",
      title: presenting
        ? "While it is off, a failing main branch is not handed to a fixer."
        : "Coord checks it before it consults the red-main fixer at all (gate 3): with it off for a repository, a failing main gets no fixer.",
    },
    effective: withWrite(value, write, ON_OFF_TEXT, presenting),
    write: known
      ? { door: "auto_fix_red_main", current: raw as boolean }
      : null,
    readOnly: known
      ? undefined
      : presenting
        ? "The setting could not be read."
        : "The knob could not be read, so it is not offered.",
  };
}

// ---------------------------------------------------------------------------
// The stalled-train responder knob (read-only here)
// ---------------------------------------------------------------------------

/** The recorded knob, read the way coord reads it (`true` / `false`, any case). */
function recordedStallKnob(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return v === "true" ? true : v === "false" ? false : null;
}

export function admissionStallKnobGate(
  read: MergeSettingsRead,
  presenting: boolean
): MatrixGate {
  const overrides = read.profile?.rulebook_overrides ?? null;
  const raw =
    overrides !== null && typeof overrides === "object"
      ? (overrides as Record<string, unknown>).auto_fix_admission_stall
      : undefined;
  const recorded = recordedStallKnob(raw);
  let effective: GateCell;
  const unread = mergeSettingsUnread(read, presenting);
  if (unread !== null) {
    effective = unread;
  } else if (recorded !== null) {
    effective = {
      state: recorded ? "on" : "off",
      text: recorded ? "On" : "Off",
      title: presenting
        ? "The project's setting."
        : "Recorded in the tenant's merge settings (rulebook_overrides).",
      tone: "known",
      stale: false,
    };
  } else {
    effective = unknownCell(
      "UNKNOWN",
      presenting
        ? "This setting's value is not offered to this page."
        : raw === undefined || raw === null
          ? "The tenant's merge settings record no auto_fix_admission_stall value, and no read this console makes serves the value coord resolves in its place (coord_fixer_arm_readiness reports it as conjuncts.repo_knob; no web door reads that), so it is unknown here."
          : `The recorded auto_fix_admission_stall value (${JSON.stringify(raw)}) is not one coord recognises, so coord resolves its own default in its place — a value no read this console makes serves.`
    );
  }
  return {
    key: "knob:auto_fix_admission_stall",
    title: "Responder knob for a stalled merge queue",
    where: presenting
      ? "A project setting: whether a stalled merge queue gets a responder."
      : "Merge settings: rulebook_overrides → auto_fix_admission_stall (tenant only; no repository tier).",
    scope: "tenant",
    enforced: {
      kind: "enforce",
      text: "enforce",
      title: presenting
        ? "While it is off, a stalled merge queue gets no responder."
        : "Coord checks it before it consults the stalled-train responder at all (gate 3): with it off, a stalled merge queue gets no responder.",
    },
    effective,
    write: null,
    readOnly: presenting
      ? "Changed by the operator outside this page."
      : "No console control writes it: the merge settings PATCH replaces the whole rulebook_overrides object, so a one-key write from here could erase the tenant's other overrides.",
  };
}
