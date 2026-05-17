/**
 * `@[user_id:<uuid>]` is the persisted mention marker.
 *
 * - Coord's mention-parser regex (`strategy_threads.rs`) consumes the
 *   same shape, extracts UUIDs at post-create time, and inserts one
 *   `strategy.mentions` row per unique UUID.
 * - The frontend stores the marker verbatim in `body_markdown` and
 *   only resolves UUIDs → usernames at render time via a small cache
 *   populated by `/api/v1/users/lookup`.
 *
 * Stable IDs survive username renames; the marker is collision-free
 * with regular `@username` chatter the human might type.
 */

// RFC 4122-ish UUID regex, case-insensitive. We intentionally don't
// reject UUID v1/v3/v5 — coord re-validates against auth.users.
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const MENTION_MARKER_REGEX = new RegExp(
  `@\\[user_id:(${UUID})\\]`,
  "gi"
);

export interface MentionTextSegment {
  type: "text";
  value: string;
}

export interface MentionMarkerSegment {
  type: "mention";
  userId: string;
}

export type MentionSegment = MentionTextSegment | MentionMarkerSegment;

/**
 * Split raw text into alternating plain + mention segments so a
 * renderer can swap in `<MentionMarker>` components for the latter.
 *
 * Pure / deterministic; safe to call from inside React render. The
 * regex above is `/g`-flagged but a fresh `lastIndex` is implicit per
 * call because we use `matchAll`.
 */
export function parseMentionSegments(input: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let cursor = 0;
  for (const match of input.matchAll(MENTION_MARKER_REGEX)) {
    const start = match.index ?? 0;
    const userId = match[1];
    if (!userId) continue;
    if (start > cursor) {
      out.push({ type: "text", value: input.slice(cursor, start) });
    }
    out.push({ type: "mention", userId: userId.toLowerCase() });
    cursor = start + match[0].length;
  }
  if (cursor < input.length) {
    out.push({ type: "text", value: input.slice(cursor) });
  }
  return out;
}

/**
 * Pull every unique mention UUID out of a body of markdown text.
 * Used by `<ThreadView>` to prime the user-lookup cache in one batch.
 */
export function extractMentionedUserIds(input: string): string[] {
  const seen = new Set<string>();
  for (const match of input.matchAll(MENTION_MARKER_REGEX)) {
    const userId = match[1];
    if (userId) seen.add(userId.toLowerCase());
  }
  return Array.from(seen);
}
