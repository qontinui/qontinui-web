/**
 * Memory row → operator-facing status tag.
 *
 * Created by plan `2026-08-16-coord-console-ui-unification-pipeline-style.md`
 * Phase 3 Wave 2, in the shape `alertStatus.ts` established and `planStatus.ts`
 * repeated: a pure derivation module beside the row that renders it, carrying
 * the two things R3 requires of a console surface — an audited kind→attention
 * table and a palette keyed off it — plus a unit test that asserts the two
 * agree (`memoryStatus.test.ts`, via the shared `paletteDisagreements`).
 *
 * ## What a memory row's "status" honestly is
 *
 * `coord.memories` has no lifecycle. A memory is not queued, running, blocked
 * or shipped; it exists at a version and it was written at a time. So the one
 * thing the status slot can truthfully say is **whether this build understands
 * what kind of memory it is looking at** — which is exactly the question the
 * type column answers, and exactly the question it fails to answer when coord
 * returns a type this build has never seen (the kind set grows: the coord
 * memory store's own vocabulary is `observation`, `fact`, `mental_model`,
 * `episode`, `feedback`, `reference`, `rule`, `library`, and it has already
 * grown once past the `project` / `proj` / `ref` forms this UI shipped with).
 *
 * Inventing a severity ladder over freshness would be the alternative, and it
 * would be a fabrication: nothing about a memory decays, nothing is owed on
 * one, and a red badge nobody must act on is the precise bug R3 exists to
 * prevent.
 *
 * ## Why an unrecognised type is AMBER and not calm
 *
 * This is R3's stated exception — *"amber also covers we do not know"*, shipped
 * in `attention.ts` (`attentionOf`'s `waiting` floor), `planStatus.ts`
 * (`unknown`) and `alertStatus.ts` (`unknown`). An amber painted on ignorance
 * is a statement about our knowledge, not a promise about the row. Painting an
 * unrecognised type calm would assert "nothing is odd here", which is the one
 * thing we do not know.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";

/**
 * One `coord.memories` row as the web proxy's list projection serves it.
 *
 * Declared HERE rather than beside the row component, for the same reason
 * `CoordPlanRow` moved into `planStatus.ts`: it is the surface's data shape and
 * it outlives any one rendering of it.
 */
// TODO: Re-export from @qontinui/shared-types once MemorySummary is published.
// Locally aliased to unblock compilation (unchanged from `MemoryCard.tsx`,
// this type's previous home).
type MemorySummary = {
  name: string;
  version: number;
  updated_at: string;
  written_at?: string | null;
  type?: string | null;
  description?: string | null;
  tags?: string[];
};

/**
 * Wire-format row for the coord memory list view. Sources both the
 * `/coord/memory/list` summary projection (no `content`) and the
 * `/coord/memory/:name` full row — the dashboard only renders the fields they
 * have in common, so a permissive shape covering both keeps the row reusable.
 * `MemorySummary` is the canonical promoted type
 * (qontinui-schemas/rust/src/memory.rs).
 */
export type CoordMemoryRow = MemorySummary & {
  /** Only present when this row came from `/coord/memory/:name` (full
   * `MemoryRow` shape) — the list endpoint strips these. */
  written_by_agent?: string | null;
  written_by_device?: string | null;
};

/**
 * The surface's status vocabulary. TWO tones, not one per memory kind:
 * the KIND is what the badge says (its label is the type verbatim), and the
 * TONE is what the badge is coloured by. Keying colour on the kind would need
 * a total palette over a vocabulary coord grows without telling us — which is
 * the rot `planStatus.ts` records for work-unit status, in the same words.
 */
export type MemoryStatusTone = "known" | "unknown";

/**
 * The memory kinds this build has a meaning for. Two generations of the
 * vocabulary: the coord memory store's current kind set, plus the legacy
 * `project` / `proj` / `ref` / `user` forms that predate it and are still in
 * the corpus.
 *
 * Membership only decides the TONE. An unlisted type is still shown verbatim,
 * never dropped and never rewritten — it is shown as *unrecognised*.
 */
const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "observation",
  "fact",
  "mental_model",
  "episode",
  "feedback",
  "reference",
  "rule",
  "library",
  // Pre-cutover frontmatter types, still present in imported rows.
  "project",
  "proj",
  "ref",
  "user",
]);

export const MEMORY_TONE_CLASS: Record<MemoryStatusTone, string> = {
  // Calm: nothing is owed on a memory, and nothing decays.
  known: "bg-muted text-muted-foreground border-border",
  // R3's ignorance floor — amber says "we cannot tell you what this is".
  unknown: "bg-amber-500/10 text-amber-200 border-amber-500/30",
};

/**
 * The audited tone → attention table. TOTAL over {@link MemoryStatusTone}, one
 * row per tone with the reason it lands there:
 *
 * - `known` — **`none`**. A memory of a kind this build understands asks
 *   nothing of anybody. Nothing clears, nothing decays, nothing is blocked.
 * - `unknown` — **`waiting`**. Not a claim that something is wrong: it is
 *   `attentionOf`'s ignorance floor, the same one `planStatus.unknown` and
 *   `alertStatus.unknown` carry. Only a human extending the vocabulary
 *   resolves it, so read literally R3's name-the-clearer test would forbid
 *   amber here — and R3 states the exception explicitly, because rendering
 *   ignorance as calm is `silent-empty-is-unknown` with a badge attached.
 */
export const MEMORY_ATTENTION_BY_TONE: Record<MemoryStatusTone, Attention> = {
  known: "none",
  unknown: "waiting",
};

/**
 * Red ⇔ the colourblind-safe `✕`: exactly the `author` tones. There are none
 * on this surface, and the set is DERIVED rather than written as an empty
 * literal so it cannot fall out of step if a tone is ever added.
 */
export const MEMORY_AUTHOR_GLYPH_TONES: ReadonlySet<MemoryStatusTone> = new Set(
  (Object.keys(MEMORY_ATTENTION_BY_TONE) as MemoryStatusTone[]).filter(
    (t) => MEMORY_ATTENTION_BY_TONE[t] === "author"
  )
);

export const MEMORY_STATUS_PALETTE: StatusPalette<MemoryStatusTone> = {
  badgeClass: MEMORY_TONE_CLASS,
  authorGlyphKinds: MEMORY_AUTHOR_GLYPH_TONES,
};

/**
 * The row status `/memory` renders.
 *
 * `label` is the memory's type VERBATIM when coord sent one — never a
 * prettified guess — so nothing is lost by colouring on the tone instead.
 */
export function deriveMemoryStatus(
  memory: Pick<CoordMemoryRow, "type">
): RowStatus<MemoryStatusTone> {
  const raw = (memory.type ?? "").trim();
  if (!raw) {
    return {
      kind: "unknown",
      label: "no type",
      reason: "coord recorded no type for this memory",
      attention: MEMORY_ATTENTION_BY_TONE.unknown,
    };
  }
  if (!KNOWN_TYPES.has(raw.toLowerCase())) {
    return {
      kind: "unknown",
      label: raw,
      reason: "a memory kind this build has no meaning for — shown verbatim",
      attention: MEMORY_ATTENTION_BY_TONE.unknown,
    };
  }
  return {
    kind: "known",
    label: raw,
    attention: MEMORY_ATTENTION_BY_TONE.known,
  };
}

/**
 * The mono identity chip: the version head.
 *
 * Every memory is event-sourced (immutable version rows, LWW for reads), so
 * `version` is the monotonic HEAD, not a version count — the tooltip on the
 * row says so, because "v14" reads as "fourteen versions" to everyone who has
 * not read that decision.
 */
export function memoryIdentity(memory: Pick<CoordMemoryRow, "version">): string {
  return memory.version === null || memory.version === undefined
    ? "v?"
    : `v${memory.version}`;
}
