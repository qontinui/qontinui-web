/**
 * Page health — every pure derivation the "Page health" panel renders from
 * the runner's `POST /ui-bridge/control/page-health` (style guide R8).
 *
 * The report (qontinui-runner `ui_bridge/screenshots.rs`
 * `ui_bridge_page_health_handler`, after `runnerProxyPost` unwraps its
 * `{ success, data }` envelope) is DOM-derived, no pixels:
 *
 *     { summary: "OK" | "WARNING" | "CRITICAL",
 *       findings: [{ check, severity, detail, data }],
 *       heatmap: string[20],          // '#' where an element sits
 *       element_count, visible_count }
 *
 * over six fixed checks (spatial coverage, layout regions, element diversity,
 * text signals, interactive readiness, visual anomalies).
 *
 * **It carries no occlusion verdict, and this module reads none.** The keys
 * above are all it has: there is no `occlusionDataObserved` in the report. The
 * only producer of that field is the separate visibility sweep, which no relay
 * carries yet (coord finding `99796499-8e46-4d69-94ba-a2ac9fe3ea22`; plan
 * `2026-10-23-console-presentation-spaces` Phase 6, amendment 2026-10-24). A
 * healthy summary here says nothing about "is anything covered?", and the panel
 * never lets one stand in for the other. Should a future runner add an
 * occlusion field to this report, {@link readPageHealth} still ignores it: the
 * occlusion row is decided in `occlusionStatus.ts` / `occlusionReadOf`, and it
 * is UNKNOWN until the follow-up that relays the sweep lands.
 *
 * Colour follows R3: `CRITICAL` is the analyzer saying the page is broken — a
 * human must look, nothing else will fix it — so it borrows red and the `✕`.
 * `WARNING` is a soft signal (a loading state, a page with little content)
 * that blocks nobody: calm, with the finding saying what it saw. A severity
 * this build does not know, or a report with no summary, is R3's ignorance
 * floor — amber, never a guessed "OK".
 *
 * The text-signal finding QUOTES the runner window's own text (each error,
 * loading or empty-state line it matched). Those quotes are kept apart in
 * `quoted` so the panel can show their counts everywhere and the text itself
 * only to the operator — they can name a session or a client.
 */

import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  type AttentionMap,
  type StatusPalette,
} from "@/components/console";

export type PageHealthKind = "ok" | "warning" | "critical" | "unknown";

/** The runner's severity word as a kind; anything unrecognised is `unknown`. */
export function pageHealthKindOf(severity: unknown): PageHealthKind {
  switch (severity) {
    case "OK":
      return "ok";
    case "WARNING":
      return "warning";
    case "CRITICAL":
      return "critical";
    default:
      return "unknown";
  }
}

/**
 * Who must act on a page-health result. `ok`, `warning` — none (a warning is
 * a soft signal stated in words). `critical` — AUTHOR: the analyzer says the
 * page is broken. `unknown` — WAITING, the ignorance floor.
 */
export const PAGE_HEALTH_ATTENTION_BY_KIND = {
  ok: "none",
  warning: "none",
  critical: "author",
  unknown: "waiting",
} satisfies AttentionMap<PageHealthKind>;

export const PAGE_HEALTH_BADGE_CLASS: Record<PageHealthKind, string> = {
  ok: INERT,
  // Calm, and dashed so a soft signal does not read as a firm all-clear.
  warning: `${INERT} border-dashed`,
  critical: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
};

export const PAGE_HEALTH_AUTHOR_GLYPH_KINDS: ReadonlySet<PageHealthKind> =
  new Set<PageHealthKind>(["critical"]);

export const PAGE_HEALTH_PALETTE: StatusPalette<PageHealthKind> = {
  badgeClass: PAGE_HEALTH_BADGE_CLASS,
  authorGlyphKinds: PAGE_HEALTH_AUTHOR_GLYPH_KINDS,
};

export const PAGE_HEALTH_LABEL: Record<PageHealthKind, string> = {
  ok: "OK",
  warning: "warning",
  critical: "critical",
  unknown: "UNKNOWN",
};

/** The checks' names, in an operator's words (R8). */
const CHECK_LABEL: Record<string, string> = {
  spatial_coverage: "Screen coverage",
  layout_regions: "Layout",
  element_diversity: "Element variety",
  text_signals: "Error and loading text",
  interactive_readiness: "Controls ready",
  visual_anomalies: "Visual anomalies",
};

/** A check this build does not know by name. */
export const OTHER_CHECK_LABEL = "Other check";

/** Lines of the runner window's own text the text-signal check matched. */
export interface QuotedText {
  readonly errors: readonly string[];
  readonly loading: readonly string[];
  readonly empty: readonly string[];
}

export interface PageHealthFinding {
  readonly key: string;
  /** The runner's check id, or null when the finding names none. */
  readonly check: string | null;
  readonly label: string;
  readonly kind: PageHealthKind;
  /** What the check measured, in plain words; null when its data is unreadable. */
  readonly summary: string | null;
  /** The runner's own detail line (counts only, engineering wording). */
  readonly runnerDetail: string | null;
  /** The text-signal check's quotes; null for every other check. */
  readonly quoted: QuotedText | null;
}

export interface PageHealthReading {
  /** The runner's worst-of-all verdict; `unknown` when it sent none. */
  readonly summary: PageHealthKind;
  readonly findings: readonly PageHealthFinding[];
  readonly elementCount: number | null;
  readonly visibleCount: number | null;
  /** The 20×20 occupancy grid, or null when absent or malformed. */
  readonly heatmap: readonly string[] | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "")
    : [];
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The plain-language reading of one check's `data`, or null when unreadable. */
function checkSummary(check: string | null, data: unknown): string | null {
  if (!isRecord(data)) return null;
  switch (check) {
    case "spatial_coverage": {
      const all = num(data.coverage_pct);
      const left = num(data.left_half_pct);
      const right = num(data.right_half_pct);
      if (all === null) return null;
      const halves =
        left !== null && right !== null
          ? ` (left half ${left}%, right half ${right}%)`
          : "";
      return `Elements cover ${all}% of the window${halves}.`;
    }
    case "layout_regions": {
      const sidebar = num(data.sidebar);
      const header = num(data.header);
      const content = num(data.content);
      if (sidebar === null || header === null || content === null) return null;
      return `${sidebar} in the sidebar, ${header} in the header, ${content} in the content area.`;
    }
    case "element_diversity": {
      if (!isRecord(data.types)) return null;
      const counts = Object.values(data.types).filter(
        (n): n is number => typeof n === "number"
      );
      const total = counts.reduce((a, b) => a + b, 0);
      return `${plural(counts.length, "element type")} across ${plural(total, "element")}.`;
    }
    case "text_signals": {
      const errors = strings(data.errors).length;
      const loading = strings(data.loading).length;
      const empty = strings(data.empty).length;
      const css = strings(data.css_signals).length;
      return `${plural(errors, "error message")}, ${plural(loading, "loading message")}, ${plural(empty, "empty-state message")}, ${plural(css, "loading style")}.`;
    }
    case "interactive_readiness": {
      const total = num(data.total);
      const disabled = num(data.disabled);
      if (total === null || disabled === null) return null;
      return `${plural(total, "control")}, ${disabled} disabled.`;
    }
    case "visual_anomalies": {
      const zero = num(data.zero_size);
      const outside = num(data.outside_viewport);
      if (zero === null || outside === null) return null;
      return `${plural(zero, "zero-size element")}, ${outside} outside the window.`;
    }
    default:
      return null;
  }
}

function readFinding(v: unknown, index: number): PageHealthFinding | null {
  if (!isRecord(v)) return null;
  const check = text(v.check);
  const data = v.data;
  return {
    key: `${check ?? "check"}#${index}`,
    check,
    label: (check && CHECK_LABEL[check]) ?? OTHER_CHECK_LABEL,
    kind: pageHealthKindOf(v.severity),
    summary: checkSummary(check, data),
    runnerDetail: text(v.detail),
    quoted:
      check === "text_signals" && isRecord(data)
        ? {
            errors: strings(data.errors),
            loading: strings(data.loading),
            empty: strings(data.empty),
          }
        : null,
  };
}

function readHeatmap(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  if (!v.every((row) => typeof row === "string" && /^[#.]+$/.test(row))) {
    return null;
  }
  return v as string[];
}

/**
 * The report in a page-health payload, or `null` when the payload is not a
 * report at all (not an object, or no `findings` array) — UNKNOWN, not a
 * healthy page.
 */
export function readPageHealth(payload: unknown): PageHealthReading | null {
  if (!isRecord(payload) || !Array.isArray(payload.findings)) return null;
  return {
    summary: pageHealthKindOf(payload.summary),
    findings: payload.findings
      .map(readFinding)
      .filter((f): f is PageHealthFinding => f !== null),
    elementCount: num(payload.element_count),
    visibleCount: num(payload.visible_count),
    heatmap: readHeatmap(payload.heatmap),
  };
}
