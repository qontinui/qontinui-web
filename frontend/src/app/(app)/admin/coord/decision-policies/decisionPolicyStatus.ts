/**
 * decisionPolicyStatus — the derived state of one decision-domain policy row,
 * and R3's audited severity table for it.
 *
 * Same shape as `gate-clearance/clearanceRuleStatus.ts`: a pure, unit-tested
 * kind→presentation module beside the surface (R8), enrolled in
 * `components/console/attention.test.ts`'s `CONSOLE_PALETTES` so its palette is
 * audited beside every other console surface rather than only beside itself.
 *
 * ## The R3 reading, kind by kind
 *
 * The question this surface has to get right is which states are a DEFECT and
 * which are the intended, safe resting place. `always_escalate` is the loudest
 * temptation and the clearest "no": it is where coord PUTS every new row on
 * purpose, and painting the shipped-safe default red would train the eye to
 * ignore red on the one page whose whole point is that creating a row is safe.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
} from "@/components/console/statusRow";
import type { CoordPolicyRow } from "../_shared/coordPolicies";
import {
  DECISION_POLICY_MODES,
  parseAutonomyLevel,
  validateDecisionPayload,
  type DecisionPolicyMode,
} from "./decisionPolicies";

/** The vocabulary the ROW renders. */
export type DecisionPolicyKind =
  | "escalating"
  | "framing"
  | "acting"
  | "disabled"
  | "expired"
  | "misconfigured"
  | "unknown";

/**
 * The audited kind → attention table. TOTAL over {@link DecisionPolicyKind}:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `escalating` | `none` | `autonomy_level = always_escalate`. Coord's column default and the state every created row lands in. Consults escalate to a human, which is the *safe* arm, and the row's own existence is the only thing that changed. Nothing is owed. |
 * | `framing` | `none` | `guidance_only`. Coord serves the frame and does not act on it. Working as configured. |
 * | `acting` | `none` | `auto_decide`. Also working as configured — loud is wrong here: the operator chose it through a confirm, and R3's red is for "someone must act NOW", not "this is powerful". |
 * | `disabled` | `none` | `enabled = false` is a state the operator chose. An off switch that is off is not a defect. |
 * | `expired` | `none` | The expiry that lapsed is the one the operator set. |
 * | `misconfigured` | `author` | The payload carries a field coord's parser DROPS (`policies/decide.rs:5992` skips a malformed field rather than failing the write). The operator believes constraints or a rubric are governing and they are not — silently, with a 201 on the write and nothing anywhere to say otherwise. Nothing but a human clears that. |
 * | `unknown` | `waiting` | Coord served an `autonomy_level` or `mode` this build does not know. That is a statement of ignorance, and R3's floor for ignorance is amber, never the calm `none` — the `silent-empty-is-unknown` discipline applied to a badge. |
 */
export const DECISION_POLICY_ATTENTION_BY_KIND: Record<
  DecisionPolicyKind,
  Attention
> = {
  escalating: "none",
  framing: "none",
  acting: "none",
  disabled: "none",
  expired: "none",
  misconfigured: "author",
  unknown: "waiting",
};

export const DECISION_POLICY_CLASS: Record<DecisionPolicyKind, string> = {
  // Calm and explicitly provisional — the row exists, and it decides nothing.
  escalating: "bg-transparent text-muted-foreground border-border border-dashed",
  framing: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  acting: "bg-green-500/5 text-green-300 border-green-500/25",
  disabled: "bg-transparent text-muted-foreground border-border border-dashed",
  expired: INERT,
  misconfigured: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const DECISION_POLICY_AUTHOR_GLYPH_KINDS: ReadonlySet<DecisionPolicyKind> =
  new Set(
    (
      Object.keys(DECISION_POLICY_ATTENTION_BY_KIND) as DecisionPolicyKind[]
    ).filter((k) => DECISION_POLICY_ATTENTION_BY_KIND[k] === "author")
  );

export const DECISION_POLICY_PALETTE: StatusPalette<DecisionPolicyKind> = {
  badgeClass: DECISION_POLICY_CLASS,
  authorGlyphKinds: DECISION_POLICY_AUTHOR_GLYPH_KINDS,
  doneGlyphKinds: new Set<DecisionPolicyKind>(["acting"]),
};

const LABEL_BY_KIND: Record<DecisionPolicyKind, string> = {
  escalating: "escalates",
  framing: "frames",
  acting: "acts",
  disabled: "disabled",
  expired: "expired",
  misconfigured: "payload dropped",
  unknown: "unknown",
};

/** The row's `mode`, or `null` when coord served one this build cannot read. */
export function rowMode(row: CoordPolicyRow): DecisionPolicyMode | null {
  return (DECISION_POLICY_MODES as readonly string[]).includes(row.mode)
    ? (row.mode as DecisionPolicyMode)
    : null;
}

/**
 * The payload fields coord would silently drop for this row, or `null` when
 * the mode is unreadable (in which case we cannot say — UNKNOWN, not clean).
 */
export function rowPayloadWarnings(row: CoordPolicyRow): string[] | null {
  const mode = rowMode(row);
  if (mode === null) return null;
  const result = validateDecisionPayload(
    JSON.stringify(row.payload ?? {}),
    mode
  );
  // `ok: false` here means coord is storing something this form could not have
  // written (a non-object payload). That is a real defect, reported as one.
  if (!result.ok) return [result.error];
  return result.warnings.map((w) => `${w.path}: ${w.message}`);
}

function isExpired(row: CoordPolicyRow, now: number): boolean {
  if (row.expires_at === null) return false;
  const t = new Date(row.expires_at).getTime();
  return !Number.isNaN(t) && t <= now;
}

/**
 * The row's status. Order matters and is deliberate: a rule that is turned off
 * or lapsed decides nothing, so its payload defects are moot and reporting
 * them would spend `author` on a row nobody needs to touch.
 */
export function deriveDecisionPolicyStatus(
  row: CoordPolicyRow,
  now: number = Date.now()
): RowStatus<DecisionPolicyKind> {
  if (!row.enabled) return status("disabled");
  if (isExpired(row, now)) return status("expired");

  const warnings = rowPayloadWarnings(row);
  if (warnings === null) {
    return status(
      "unknown",
      `coord served mode \`${row.mode}\`, which this console does not know — what it serves for this domain is unknown.`
    );
  }
  if (warnings.length > 0) {
    return status(
      "misconfigured",
      `coord drops ${warnings.length} payload field${warnings.length === 1 ? "" : "s"} from this rule and serves the rest.`
    );
  }

  const level = parseAutonomyLevel(row.autonomy_level);
  if (level === null) {
    return status(
      "unknown",
      `coord served autonomy_level \`${row.autonomy_level}\`, which this console does not know.`
    );
  }
  if (level === "always_escalate") {
    return status(
      "escalating",
      "Inert by design: coord short-circuits every consult to Escalate regardless of mode."
    );
  }
  if (level === "guidance_only") {
    return status("framing", "Coord serves this frame but will not act on it.");
  }
  return status("acting", "Coord may act on this frame without asking you.");
}

function status(
  kind: DecisionPolicyKind,
  reason?: string
): RowStatus<DecisionPolicyKind> {
  return {
    kind,
    label: LABEL_BY_KIND[kind],
    reason,
    attention: DECISION_POLICY_ATTENTION_BY_KIND[kind],
  };
}
