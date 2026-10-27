/**
 * The presentation caption registry (plan
 * `2026-10-23-console-presentation-spaces` D5) — ONE registry, composed from
 * one module per lens surface.
 *
 * D5 wants the copy in one place, so it is reviewed in one diff and a test can
 * assert every lens panel has a caption. `modular-code-and-file-size` wants no
 * shared list every feature appends to, because a shared append point
 * serializes parallel work. Both hold: each surface owns its file —
 *
 * | surface | file | key prefix |
 * |---|---|---|
 * | digital twin | `digitalTwinCaptions.ts` | `digital-twin.` |
 * | coordination overview | `coordinationOverviewCaptions.ts` | `coordination-overview.` |
 * | agentic activity | `agenticActivityCaptions.ts` | `agentic-activity.` |
 * | UI Bridge | `uiBridgeCaptions.ts` | `ui-bridge.` |
 * | dev-ops | `devOpsCaptions.ts` | `dev-ops.` |
 * | the tour | `tourCaptions.ts` | `tour.` |
 *
 * — and this index only composes them. **To caption a panel, add an entry to
 * that surface's file**, keyed `<prefix><panel>`; nothing here changes, and
 * the key joins {@link CaptionKey} so `<Caption id>` type-checks it. Only a NEW
 * surface touches this file.
 */

import { AGENTIC_ACTIVITY_CAPTIONS } from "./agenticActivityCaptions";
import type { CaptionEntry } from "./captionTypes";
import { COORDINATION_OVERVIEW_CAPTIONS } from "./coordinationOverviewCaptions";
import { DEV_OPS_CAPTIONS } from "./devOpsCaptions";
import { DIGITAL_TWIN_CAPTIONS } from "./digitalTwinCaptions";
import { TOUR_CAPTIONS } from "./tourCaptions";
import { UI_BRIDGE_CAPTIONS } from "./uiBridgeCaptions";

export {
  captionSegments,
  copy,
  term,
  type CaptionEntry,
  type CaptionSegment,
  type CaptionTermSegment,
  type CaptionText,
  type SurfaceCaptions,
} from "./captionTypes";

/** Each surface's captions, under the key prefix its entries carry. */
export const CAPTION_SURFACES = {
  "digital-twin": DIGITAL_TWIN_CAPTIONS,
  "coordination-overview": COORDINATION_OVERVIEW_CAPTIONS,
  "agentic-activity": AGENTIC_ACTIVITY_CAPTIONS,
  "ui-bridge": UI_BRIDGE_CAPTIONS,
  "dev-ops": DEV_OPS_CAPTIONS,
  tour: TOUR_CAPTIONS,
} as const;

/** A surface that has a caption file: the five lens surfaces and the tour. */
export type CaptionSurfaceId = keyof typeof CAPTION_SURFACES;

/** Every caption key, across every surface file. */
export type CaptionKey = {
  [S in CaptionSurfaceId]: keyof (typeof CAPTION_SURFACES)[S] & string;
}[CaptionSurfaceId];

/** Every caption, by key. */
export const CAPTIONS: Readonly<Record<CaptionKey, CaptionEntry>> = {
  ...DIGITAL_TWIN_CAPTIONS,
  ...COORDINATION_OVERVIEW_CAPTIONS,
  ...AGENTIC_ACTIVITY_CAPTIONS,
  ...UI_BRIDGE_CAPTIONS,
  ...DEV_OPS_CAPTIONS,
  ...TOUR_CAPTIONS,
};

/** Whether `key` names a caption — for a key that arrives untyped. */
export function isCaptionKey(key: string): key is CaptionKey {
  return Object.prototype.hasOwnProperty.call(CAPTIONS, key);
}

/** The caption for a key. Total over {@link CaptionKey}. */
export function captionEntry(key: CaptionKey): CaptionEntry {
  return CAPTIONS[key];
}
