/**
 * Occlusion — whether anything on the runner's screen covers anything else.
 *
 * ## Where a verdict comes from
 *
 * The ONLY producer of an occlusion verdict is the occlusion sweep
 * (`POST /ui-bridge/control/visibility`, `relayReads.ts`
 * `fetchRunnerVisibility`), which the page runs together with page health.
 * Page health's report has no occlusion field: its keys are `summary`,
 * `findings`, `heatmap`, `element_count` and `visible_count` (qontinui-runner
 * `ui_bridge/screenshots.rs` `ui_bridge_page_health_handler`), and
 * `occlusionDataObserved` is emitted by `build_visibility_report` alone. So
 * page health's body is never consulted for occlusion: a runner that puts
 * `occlusionDataObserved` in its page-health report changes nothing here.
 *
 * The runner relays the sweep since qontinui-runner `d4c64ad06` (rustfmt
 * follow-up `827745bd3`; coord finding `99796499-8e46-4d69-94ba-a2ac9fe3ea22`).
 * A runner built before that refuses it with a 403, and a project whose
 * terminal-stream egress is off has it withheld (409 `egress_off`); both are
 * read failures, rendered as a labelled UNKNOWN for their own reason
 * (`relaySource.ts`), and never reach this module as a report.
 *
 * ## Reading the sweep
 *
 * The sweep's report (qontinui-runner `ui_bridge/screenshots.rs`
 * `build_visibility_report`, unwrapped from its `{ success, data }` envelope),
 * as a RELAYED read receives it (`disclose_occlusion_text`):
 *
 *     { verdict: "clear" | "occlusions_found" | "unknown_empty_registry",
 *       occlusionDataObserved: boolean,
 *       occlusions: [{ ratio, hidesText, isExpectedOverlay, source }],
 *       occlusionText: "withheld",
 *       elementCount, expectedOverlayDetection: "modal-stack" | "unavailable",
 *       expectedOverlaysFiltered, minRatio, includeExpected }
 *
 * A local read's entries also carry `element`, `occludedBy`, `label` and
 * `text`, and say `occlusionText: "included"`. This module reads none of those
 * four fields whichever it is handed — only the verdict, the observed flag,
 * the entry count and each entry's `hidesText` — so no webview text reaches
 * the page from here. {@link readOcclusionTextDisclosure} reads the
 * disclosure, so the row can say that WHICH element is covered was not sent.
 *
 * **THE RULE** (served policy `ux-priorities`
 * `the-runner-serves-the-occlusion-sweep-and-it-is-currently-vacuous`):
 * `verdict: "clear"` with `occlusionDataObserved: false` is UNKNOWN, not a
 * pass. "Clear" only means no occlusion was OBSERVED; when no element carried
 * any occlusion field there was nothing to observe, and `occlusionDataObserved`
 * is the only field that says so. So `clear` is a verdict here only when the
 * report says `occlusionDataObserved: true` — a report that omits the field
 * (a build that predates it) proves nothing either, and reads UNKNOWN too.
 *
 * The other arms: `unknown_empty_registry` is UNKNOWN (an empty registry
 * observed nothing); `occlusions_found` is a real finding — an occlusion is
 * only reported from an element that carried the data — and splits on whether
 * any of them hides TEXT, because covering identifying text is the defect
 * served policy `ux-priorities` `no-widget-may-hide-identifying-text` names
 * (red, a human must move the overlay), while an overlap that hides no text is
 * a calm finding stated in words.
 *
 * A read that never answered is UNKNOWN for its own reason (`relaySource.ts`)
 * and never reaches this module as a report.
 */

import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  type AttentionMap,
  type StatusPalette,
} from "@/components/console";

export type OcclusionKind = "clear" | "hides-text" | "overlaps" | "unknown";

/**
 * Who must act on an occlusion reading. `clear`, `overlaps` — none.
 * `hides-text` — AUTHOR: identifying text is covered and nothing but moving
 * the overlay fixes it. `unknown` — WAITING, the ignorance floor.
 */
export const OCCLUSION_ATTENTION_BY_KIND = {
  clear: "none",
  "hides-text": "author",
  overlaps: "none",
  unknown: "waiting",
} satisfies AttentionMap<OcclusionKind>;

export const OCCLUSION_BADGE_CLASS: Record<OcclusionKind, string> = {
  clear: INERT,
  "hides-text": AUTHOR_RED,
  overlaps: `${INERT} border-dashed`,
  unknown: UNKNOWN_AMBER,
};

export const OCCLUSION_AUTHOR_GLYPH_KINDS: ReadonlySet<OcclusionKind> =
  new Set<OcclusionKind>(["hides-text"]);

export const OCCLUSION_PALETTE: StatusPalette<OcclusionKind> = {
  badgeClass: OCCLUSION_BADGE_CLASS,
  authorGlyphKinds: OCCLUSION_AUTHOR_GLYPH_KINDS,
};

export const OCCLUSION_LABEL: Record<OcclusionKind, string> = {
  clear: "clear",
  "hides-text": "text hidden",
  overlaps: "overlaps",
  unknown: "UNKNOWN",
};

export interface OcclusionReading {
  readonly kind: OcclusionKind;
  /** Why the reading is UNKNOWN, in words; null for a real verdict. */
  readonly unknownReason: string | null;
  /** Occlusions reported; null when the reading is UNKNOWN. */
  readonly occlusions: number | null;
  /** Of those, how many hide text; null when the reading is UNKNOWN. */
  readonly hidingText: number | null;
  /** Elements the sweep looked at, or null when it did not say. */
  readonly elementCount: number | null;
  /**
   * Whether tracked modal overlays could be told apart: `false` when the
   * runner had no modal stack to consult (nothing was filtered, so a modal
   * over the page counts as an occlusion), null when the report did not say.
   */
  readonly overlaysClassified: boolean | null;
  /**
   * Whether the entries name what they cover — the report's own
   * `occlusionText` ({@link readOcclusionTextDisclosure}).
   */
  readonly textDisclosure: OcclusionTextDisclosure;
}

/**
 * Whether the sweep's occlusion entries carry the fields that name or quote
 * the webview (`element`, `occludedBy`, `label`, `text`), as the runner reports
 * it in `data.occlusionText` (qontinui-runner `disclose_occlusion_text`):
 *
 * - `withheld` — dropped: the report says how much is covered and whether
 *   text is hidden, but not which element. What every relayed read says, and
 *   so what this page expects;
 * - `included` — kept: a local read's report, which names each element;
 * - `unknown` — the reply did not say, or said something else. Never read as
 *   either of the two, and `reason` says which, in words that quote nothing the
 *   reply sent.
 */
export type OcclusionTextDisclosure =
  | { readonly kind: "withheld" }
  | { readonly kind: "included" }
  | { readonly kind: "unknown"; readonly reason: string };

/**
 * The disclosure in a sweep payload. Exactly the runner's two words are
 * answers: an absent field (a build that predates the disclosure) and any
 * other value — a different case, a boolean, `null` — are UNKNOWN. A guess in
 * either direction is a claim about what the entries hold that nothing
 * observed.
 */
export function readOcclusionTextDisclosure(
  payload: unknown
): OcclusionTextDisclosure {
  if (!isRecord(payload)) {
    return { kind: "unknown", reason: "the sweep sent no report" };
  }
  const said = payload.occlusionText;
  if (said === "withheld") return { kind: "withheld" };
  if (said === "included") return { kind: "included" };
  return {
    kind: "unknown",
    reason:
      said === undefined
        ? "this runner's reply does not say (an older runner build does not)"
        : "this runner's reply gave an answer this page does not know",
  };
}

/** The disclosure as one sentence — what the panel prints beside the row. */
export function occlusionTextDisclosureText(
  disclosure: OcclusionTextDisclosure
): string {
  switch (disclosure.kind) {
    case "withheld":
      return "Which element is covered, and by what, is not sent over the relay — the sweep reports only how much is covered and whether text is hidden. A local UI Bridge read on the runner names them.";
    case "included":
      return "The runner's report names each covered element and what covers it; this page shows only the counts.";
    case "unknown":
      return `Whether the sweep's report names the covered elements is unknown: ${disclosure.reason}.`;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function unknown(
  reason: string,
  elementCount: number | null,
  overlaysClassified: boolean | null,
  textDisclosure: OcclusionTextDisclosure
): OcclusionReading {
  return {
    kind: "unknown",
    unknownReason: reason,
    occlusions: null,
    hidingText: null,
    elementCount,
    overlaysClassified,
    textDisclosure,
  };
}

/** The honest reading of an occlusion-sweep payload. */
export function readOcclusion(payload: unknown): OcclusionReading {
  const textDisclosure = readOcclusionTextDisclosure(payload);
  if (!isRecord(payload)) {
    return unknown(
      "the occlusion sweep sent no report",
      null,
      null,
      textDisclosure
    );
  }
  const elementCount = num(payload.elementCount);
  const detection = payload.expectedOverlayDetection;
  const overlaysClassified =
    detection === "modal-stack"
      ? true
      : detection === "unavailable"
        ? false
        : null;
  switch (payload.verdict) {
    case "clear":
      if (payload.occlusionDataObserved === true) {
        return {
          kind: "clear",
          unknownReason: null,
          occlusions: 0,
          hidingText: 0,
          elementCount,
          overlaysClassified,
          textDisclosure,
        };
      }
      return unknown(
        payload.occlusionDataObserved === false
          ? "the sweep found nothing covered, but no element carried occlusion data, so nothing was observed (occlusion data observed: no)"
          : "the sweep found nothing covered, but this runner does not say whether it observed any occlusion data",
        elementCount,
        overlaysClassified,
        textDisclosure
      );
    case "occlusions_found": {
      const entries = Array.isArray(payload.occlusions)
        ? payload.occlusions.filter(isRecord)
        : [];
      if (entries.length === 0) {
        // A finding with no entries cannot be shown or counted honestly.
        return unknown(
          "the sweep reported occlusions but listed none",
          elementCount,
          overlaysClassified,
          textDisclosure
        );
      }
      const hidingText = entries.filter((e) => e.hidesText === true).length;
      return {
        kind: hidingText > 0 ? "hides-text" : "overlaps",
        unknownReason: null,
        occlusions: entries.length,
        hidingText,
        elementCount,
        overlaysClassified,
        textDisclosure,
      };
    }
    case "unknown_empty_registry":
      return unknown(
        "the runner's element registry was empty, so there was nothing to sweep",
        elementCount,
        overlaysClassified,
        textDisclosure
      );
    default:
      return unknown(
        "the occlusion sweep answered a verdict this page does not know",
        elementCount,
        overlaysClassified,
        textDisclosure
      );
  }
}

/**
 * The reading in one sentence — "2 occlusions across 240 elements, 1 hiding
 * text." — or, for an UNKNOWN, its reason (the badge beside it says UNKNOWN).
 */
export function occlusionSummary(reading: OcclusionReading): string {
  if (reading.kind === "unknown") {
    const reason = reading.unknownReason ?? "the sweep gave no verdict";
    return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.`;
  }
  const across =
    reading.elementCount === null
      ? ""
      : ` across ${reading.elementCount} element${reading.elementCount === 1 ? "" : "s"}`;
  if (reading.kind === "clear") {
    return `Nothing covered${across}, with occlusion data observed.`;
  }
  const n = reading.occlusions ?? 0;
  const hiding = reading.hidingText ?? 0;
  return `${n} occlusion${n === 1 ? "" : "s"}${across}, ${hiding} hiding text.`;
}
