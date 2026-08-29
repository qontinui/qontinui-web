/**
 * console — the primitives every operator/monitoring surface in qontinui-web
 * composes from.
 *
 * **This barrel IS the executable half of the style guide**
 * (`frontend/docs/console-ui-style-guide.md`): a page either composes these or
 * it does not, and "does not" is visible in a diff in a way a prose rule is
 * not. §6.4 of the guide states the rule these enforce — *a new console page
 * adds no new visual vocabulary; it composes primitives, or it extends the
 * guide in the same PR*.
 *
 * Created by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1.
 *
 * | Export | Rule |
 * |---|---|
 * | `HealthStrip` | R1 — health strip first |
 * | `StatCluster` | R1 — the count-cluster form of the same opening |
 * | `RecordRow` | R2, R4 — one record = one line, left-edge accent |
 * | `RecordList` | R2, R5 — one open at a time, honest empty state |
 * | `RecordDetail` | R5 — detail expands in place, fixed section order |
 * | `FilterTabs` | R6 — live counts, and `–`-not-`0` for an unfetched one |
 * | `FilterChips` | R6 — the same strip where the filter is MULTI-select |
 * | `CollapsiblePanel` | R7 — collapses, keeps its signal, unmounts children |
 * | `statusRow` atoms | R2, R3, R4 — the badge, the accent, the timestamp |
 * | `attention` | R3 — the severity vocabulary and its palette invariant |
 * | `time` | supports R2 — `relativeTime` / `absoluteTime` |
 * | `diff` / `DiffTable` | supports R5 — the version diff a detail panel shows |
 *
 * These are **presentation only**. Nothing here fetches, polls, or knows a
 * route, and **no shipped module under `console/` has any runtime dependency
 * on `components/operations/`** — the only edge from shipped code is an
 * `import type` on `prPipeline`, which erases at build time. (`console/`'s
 * TESTS do import values from `operations/` and `admin/coord/`: that is
 * `attention.test.ts`, the cross-surface palette oracle, and it is supposed
 * to. Test files ship nothing.) That is what lets `/admin/coord/*`,
 * `/admin/agent-claims` and `/admin/agent-sessions` share these without
 * sharing a data model, and it is a property to CHECK when adding a
 * primitive, not one to assume: the one import that broke it
 * (`relativeTime`, out of the 730-line merge-train route catalogue) looked
 * completely harmless.
 */

export { HealthStrip } from "./HealthStrip";
export type {
  HealthBadge,
  HealthBadgeTone,
  HealthStripLevel,
  HealthStripProps,
} from "./HealthStrip";

export { StatCluster } from "./StatCluster";
export type { Stat, StatClusterProps, StatTone } from "./StatCluster";

export { RecordRow } from "./RecordRow";
export type { RecordRowProps } from "./RecordRow";

export { RecordDetail } from "./RecordDetail";
export type { RecordDetailProps } from "./RecordDetail";

export { RecordList } from "./RecordList";
export type {
  RecordListBaseProps,
  RecordListExpansion,
  RecordListProps,
  RecordListRenderContext,
} from "./RecordList";

export { FilterTabs } from "./FilterTabs";
export type { FilterTab, FilterTabsProps } from "./FilterTabs";

export { FilterChips } from "./FilterChips";
export type { FilterChipOption, FilterChipsProps } from "./FilterChips";

export { CollapsiblePanel } from "./CollapsiblePanel";

export {
  AUTHOR_GLYPH_KINDS,
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  RowTime,
  STATUS_BADGE_CLASS,
  StatusBadge,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  rowAccentClass,
} from "./statusRow";
export type {
  RowStatus,
  RowTimeProps,
  StatusPalette,
} from "./statusRow";

export { absoluteTime, relativeTime } from "./time";
export type { RelativeTimeOptions } from "./time";

export { diffLines } from "./diff";
export type { DiffLine, DiffResult, DiffStats } from "./diff";

export {
  DIFF_ADDED_COUNT_CLASS,
  DIFF_REMOVED_COUNT_CLASS,
  DiffTable,
} from "./DiffTable";
export type { DiffTableProps } from "./DiffTable";

export {
  ATTENTION_RANK,
  attentionOf,
  escalateAttention,
  paletteDisagreements,
} from "./attention";
export type {
  Attention,
  AttentionMap,
  AuditablePalette,
} from "./attention";
