/**
 * The taste inbox's derivations — pure, no JSX (style guide R8).
 *
 * Plan `2026-10-13-image-generation-and-visual-judgment` Phase 23. Every
 * server enum reaches the screen through a table here, typed over the
 * generated union, so a value the backend adds is a type error until it is
 * worded; the keyboard map and the health strip's verdict live here too, so
 * both are tested exhaustively rather than inferred from a rendered page.
 */

import type {
  TasteInbox,
  TasteLabel,
  TastePair,
  TasteReason,
  TasteSource,
} from "@/lib/api/taste";
import type { HealthBadge, HealthStripLevel } from "@/components/console";

/** What each reason chip says. Order is the server's vocabulary order. */
export const REASON_LABEL: Record<TasteReason, string> = {
  on_style: "On style",
  off_style: "Off style",
  off_palette: "Off palette",
  composition: "Composition",
  cropping: "Cropping",
  wrong_subject: "Wrong subject",
  too_busy: "Too busy",
  text_in_image: "Text in image",
  artifacts: "Artifacts",
  low_quality: "Low quality",
};

/** A recorded answer, in words. */
export const LABEL_TEXT: Record<TasteLabel, string> = {
  a: "A is better",
  b: "B is better",
  both_bad: "Both bad",
};

/** The short identity chip of a recorded answer. */
export const LABEL_CHIP: Record<TasteLabel, string> = {
  a: "A",
  b: "B",
  both_bad: "both bad",
};

/** Where a question came from, in words. */
export const SOURCE_LABEL: Record<TasteSource, string> = {
  calibration: "Calibration",
  active_learning: "Judges disagreed",
  post_hoc: "Spot check of a shipped image",
};

/** The number key that toggles the reason at `index` (1-9, then 0). */
export function reasonKey(index: number): string | null {
  if (index < 0 || index > 9) return null;
  return index === 9 ? "0" : String(index + 1);
}

export type InboxAction =
  | { kind: "choose"; choice: TasteLabel }
  | { kind: "skip" }
  | { kind: "toggleReason"; reason: TasteReason }
  | { kind: "focusComment" }
  | { kind: "focusEdit" }
  | { kind: "undo" }
  | { kind: "leaveField" };

export interface KeyInput {
  key: string;
  /** The event came from a text field (comment / edit / budget). */
  inTextField: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/**
 * The inbox's keyboard map. Inside a text field only Escape acts (it leaves
 * the field), so typing a comment can never label a pair; with a modifier
 * held nothing acts, so browser shortcuts keep working.
 */
export function resolveKey(
  input: KeyInput,
  vocabulary: readonly TasteReason[]
): InboxAction | null {
  if (input.ctrlKey || input.metaKey || input.altKey) return null;
  if (input.inTextField) {
    return input.key === "Escape" ? { kind: "leaveField" } : null;
  }
  switch (input.key) {
    case "a":
    case "A":
    case "ArrowLeft":
      return { kind: "choose", choice: "a" };
    case "b":
    case "B":
    case "ArrowRight":
      return { kind: "choose", choice: "b" };
    case "x":
    case "X":
      return { kind: "choose", choice: "both_bad" };
    case "s":
    case "S":
    case "ArrowDown":
      return { kind: "skip" };
    case "c":
    case "C":
      return { kind: "focusComment" };
    case "e":
    case "E":
      return { kind: "focusEdit" };
    case "u":
    case "U":
      return { kind: "undo" };
  }
  const reason = vocabulary.find((_r, i) => reasonKey(i) === input.key);
  return reason === undefined ? null : { kind: "toggleReason", reason };
}

/** "repo · slot", or the calibration context a slot-less pair stands for. */
export function pairContext(pair: TastePair): string {
  if (pair.repo && pair.slot_id) return `${pair.repo} · ${pair.slot_id}`;
  return "No slot — a general taste question";
}

/**
 * Why a card shows the bare images, or null when it shows them in situ. The
 * in-situ capture (plan Phase 18) has not landed, so today every pair says
 * this — and says it, rather than presenting a bare image as the page.
 */
export function bareNote(pair: TastePair): string | null {
  if (pair.in_situ) return null;
  return "Shown bare: there is no capture of these images on their page yet, so judge them as images.";
}

export interface TasteHealth {
  level: HealthStripLevel;
  headline: string;
  detail?: string;
  badges: HealthBadge[];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The health strip's verdict (R1), derived from the one read the page
 * already holds — never a second fetch. Amber means a label is waiting on
 * the operator; nothing here is ever red, because nothing waits on a label
 * (decision D3): an unread inbox is UNKNOWN (amber), not a fault.
 */
export function deriveTasteHealth(
  inbox: TasteInbox | null,
  readError: string | null
): TasteHealth {
  if (inbox === null) {
    return readError
      ? {
          level: "amber",
          headline: "The taste inbox could not be read — its queue is unknown.",
          detail: readError,
          badges: [],
        }
      : { level: "amber", headline: "Reading the taste inbox…", badges: [] };
  }
  const { budget, pending_total: pending } = inbox;
  const badges: HealthBadge[] = [
    {
      key: "queue",
      label: `queue ${pending}`,
      tone: pending > 0 ? "waiting" : "muted",
      "data-testid": "taste-health-queue",
    },
    {
      key: "week",
      label: `this week ${budget.labelled_this_week}/${budget.weekly_budget}`,
      title:
        budget.source === "default"
          ? "The default weekly budget — no budget has been set for this project."
          : "The weekly budget set for this project.",
      "data-testid": "taste-health-week",
    },
    {
      key: "labelled",
      label: `labelled ${inbox.labelled_total}`,
      tone: "muted",
    },
  ];
  const stale = readError
    ? ` (last read; the latest read failed: ${readError})`
    : "";
  if (pending === 0) {
    return {
      level: "green",
      headline: `Nothing is waiting for a label.${stale}`,
      detail:
        inbox.labelled_total === 0
          ? "Build a calibration batch from this project's images to start."
          : undefined,
      badges,
    };
  }
  if (budget.remaining === 0) {
    return {
      level: "green",
      headline: `This week's ${plural(budget.weekly_budget, "label is", "labels are")} given — ${plural(pending, "pair waits", "pairs wait")}, and nothing blocks on them.${stale}`,
      badges,
    };
  }
  return {
    level: "amber",
    headline: `${plural(pending, "pair is", "pairs are")} waiting for a label — ${budget.remaining} left in this week's budget.${stale}`,
    badges,
  };
}
