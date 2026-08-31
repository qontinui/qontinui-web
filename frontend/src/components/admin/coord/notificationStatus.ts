/**
 * Pure presentation logic for `coord.notifications` rows.
 *
 * Plan `2026-08-05-coord-notifications-type-and-tab.md` Change 4, following
 * the SHARED UI CONVENTIONS owned by
 * `2026-08-05-coord-alerts-surface-and-fleet-style-ui.md`: status/label
 * derivation lives in a pure, unit-tested module so the plain-language line
 * is testable without rendering anything.
 *
 * The hard rule this module enforces mechanically rather than by convention:
 * **no UUID in the default view.** The three functions whose output is
 * rendered on the collapsed scan line — `notificationHeadline`, `humanKind`,
 * `notificationSubject` — all return through `scrubUuids`, so a producer that
 * stuffs an id into `summary`, `repo` or `kind` gets it elided rather than
 * printed. There is no "remember to check this" step for a caller to skip.
 *
 * The converse also matters and was got wrong once: a UUID **is** allowed —
 * and wanted — inside the expanded panel, where it is something an operator
 * pastes into a tool. `detailActor` therefore does NOT scrub. Nothing in this
 * module should scrub a value that only ever renders while expanded; scrubbing
 * there deletes the one identifier the panel exists to hand over.
 *
 * Notifications are EVENTS, not conditions: they are append-only, never
 * resolve, and carry per-principal read state. That is why there is no
 * severity/attention vocabulary here — the only row state is read/unread.
 */

/** One row of coord's `GET /coord/notifications` response. */
export interface CoordNotificationRow {
  notification_id: string;
  kind: string;
  /** Coord pre-renders the plain-language line; this is the row's headline. */
  summary?: string | null;
  detail?: Record<string, unknown> | null;
  repo?: string | null;
  pr_number?: number | null;
  actor?: string | null;
  /**
   * The device the event is about, when it is about one. A UUID, and the
   * migration argues at length for keeping it a first-class column precisely
   * so the default view never has to render it: it belongs in the expanded
   * panel, where it is a paste target for a coord query.
   */
  device_id?: string | null;
  occurred_at?: string | null;
  /** Null/absent ⇒ unread for the calling principal. */
  read_at?: string | null;
}

/**
 * Coord's list envelope. `total` and `unread_count` are server-computed
 * scalars DISTINCT from the page — never derive either from
 * `notifications.length`, which is the page size.
 */
export interface NotificationsResponse {
  notifications?: CoordNotificationRow[];
  next_cursor?: string | null;
  total?: number;
  unread_count?: number;
}

/** Coord's mark-read answer. */
export interface MarkReadResponse {
  marked?: number;
  unread_count?: number;
}

/**
 * The mark-read request body. Two DISJOINT, EXPLICIT arms — there is no
 * "absent means everything" spelling, and the union type is what stops one
 * being written by accident.
 *
 * This shape is load-bearing rather than stylistic. Coord previously accepted
 * an optional body and treated every deserialization failure as "mark the
 * whole tenant read", so a camelCase field name — `notificationIds`, the
 * natural spelling in this language — silently destroyed every read record.
 * Coord now rejects unknown fields, but the field names here must still be
 * `snake_case` or the button is merely broken instead of catastrophic.
 * `MARK_ALL` is a named constant so the destructive arm is greppable.
 */
export type MarkReadSelection = { notification_ids: string[] } | { all: true };

/** The destructive arm: everything unread for this principal. No undo. */
export const MARK_ALL: MarkReadSelection = { all: true };

/** The ids arm, or null when this selection is the mark-everything one. */
export function selectionIds(selection: MarkReadSelection): string[] | null {
  return "notification_ids" in selection ? selection.notification_ids : null;
}

/**
 * `httpClient` options every call to these two routes must pass.
 *
 * `HttpClient` retries any 5xx with exponential backoff. Coord's
 * `503 schema_migration_pending` is not a transient fault — it is the
 * deliberate, persistent answer for the whole window between this PR landing
 * and the coord PR deploying, which the plan sequences as *days*.
 *
 * Measured, not estimated (`http-client.test.ts`, "retries a 5xx by default"):
 * the default policy costs **5 requests and ~15s** of wall clock, because the
 * first request happens before `executeWithRetry` is even entered and that
 * helper runs the request once more before its own attempt counter applies.
 * The page's 10s poller would therefore overlap its own retry chain twice
 * over, and the nav badge would multiply the whole thing by every open console
 * tab — all to re-learn an answer that will not change for days.
 *
 * Scoped per-request rather than by lowering `maxRetries`: that option
 * reassigns the client's SHARED `retryStrategy` and would silently disable
 * retries for every other caller in the app.
 */
export const NOTIFICATIONS_REQUEST_OPTIONS: { noRetryStatuses: number[] } = {
  noRetryStatuses: [503],
};

/**
 * Deliberately NOT `/g`: a global regex carries `lastIndex` across `.test()`
 * calls, so alternating calls on the same instance return alternating answers.
 * The global form below is a separate instance used only with `.replace()`,
 * which resets `lastIndex` itself.
 */
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const UUID_RE_GLOBAL = new RegExp(UUID_RE.source, "gi");

/** Stand-in for an elided UUID. Keeps the surrounding sentence readable. */
const ELISION = "…";

/** True when the string carries a UUID anywhere inside it. */
export function containsUuid(value: string | null | undefined): boolean {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Elide every UUID in a string that is bound for the DEFAULT view.
 *
 * Eliding rather than discarding the whole string keeps the producer's
 * sentence: `stale-tree:c79a…-…:qontinui-runner-wt-mtobs` becomes
 * `stale-tree:…:qontinui-runner-wt-mtobs`, which still says what happened.
 * Discarding it would trade one rule violation for a blank row.
 *
 * Do not call this on expanded-panel strings — see the module header.
 */
export function scrubUuids(value: string): string {
  return value.replace(UUID_RE_GLOBAL, ELISION);
}

/**
 * Machine kind → scannable label: `pr_merge_landed` → "Pr merge landed".
 * Deliberately mechanical rather than a hand-maintained lookup table: a
 * hardcoded kind list is exactly what rotted on the Alerts page, where four
 * hardcoded values matched almost nothing live.
 *
 * Default-view string ⇒ scrubbed.
 */
export function humanKind(kind: string | null | undefined): string {
  const raw = scrubUuids((kind ?? "").trim());
  const spaced = raw.replace(/[_-]+/g, " ").trim();
  // Nothing left worth reading — including the case where the kind was
  // ENTIRELY a UUID and scrubbed down to the elision. A badge reading "…"
  // is not a label.
  if (!/[a-z0-9]/i.test(spaced)) return "Event";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The human identity of the row — what a person recognises. `repo#pr`, else
 * the repo, else nothing.
 *
 * Default-view string ⇒ scrubbed. A `repo` carrying a UUID is a producer bug,
 * and without the scrub it would put that UUID on the scan line twice (here
 * and again via the headline fallback).
 */
export function notificationSubject(
  n: Pick<CoordNotificationRow, "repo" | "pr_number">
): string | null {
  const repo = scrubUuids((n.repo ?? "").trim());
  const shortRepo = repo.includes("/") ? repo.split("/").pop()! : repo;
  if (!shortRepo) return null;
  if (n.pr_number != null) return `${shortRepo}#${n.pr_number}`;
  return shortRepo;
}

/**
 * The actor, for the EXPANDED panel only.
 *
 * Not scrubbed, on purpose. Coord's principal labels are `operator:<uuid>` /
 * `device:<uuid>`, and inside expanded detail that id is the whole point — it
 * is what an operator pastes into a coord query to find out who did this.
 * Stripping it there protects nothing (the collapsed row never renders this)
 * while deleting the only identifying half of the value.
 *
 * Returns null only for a genuinely empty actor, so the caller can omit the
 * field rather than render "by ".
 */
export function detailActor(
  n: Pick<CoordNotificationRow, "actor">
): string | null {
  const actor = (n.actor ?? "").trim();
  return actor ? actor : null;
}

/**
 * Does this row answer a `?ref=<id>` deep link?
 *
 * The landed-write feed on `/admin/coord/prompt-document-proposals` links a
 * write to the notification that announced it, so the operator reaches the
 * author's reasoning in one click instead of correlating two surfaces by
 * timestamp (plan `2026-08-27-tenant-level-agent-authorable-stores.md`,
 * Phase 4). It links into THIS feed rather than building a second one.
 *
 * Two spellings are accepted because the reference has two honest readings and
 * the linking side cannot know which coord sent: the notification's own id, and
 * a `notification_ref` coord carries into the payload (Phase 2 — the id of the
 * finding whose body holds the reasoning). Matching both means the link works
 * whichever one the payload turns out to carry, and neither reading can produce
 * a false positive: both are opaque ids compared for exact equality.
 *
 * A blank ref matches nothing — an empty query string must never select the
 * first row on the page.
 */
export function matchesNotificationRef(
  n: Pick<CoordNotificationRow, "notification_id" | "detail">,
  ref: string | null | undefined
): boolean {
  const wanted = (ref ?? "").trim();
  if (!wanted) return false;
  if (n.notification_id === wanted) return true;
  const carried = n.detail?.["notification_ref"];
  return typeof carried === "string" && carried.trim() === wanted;
}

/**
 * What the `?ref=` banner should say, as a pure derivation of the three inputs
 * that can be true at once.
 *
 * The whole point is that "not found" is the LAST arm, not the default. The
 * operator arrives here by clicking through from a landed write, so the first
 * render — empty rows, request in flight — would otherwise tell him the event
 * is missing before anything had been fetched, and a failed load would tell him
 * to clear filters when the truth is that coord did not answer. Both are the
 * unknown-reported-as-fact failure the linking surface exists to avoid.
 */
export function linkedRefNotice(state: {
  found: boolean;
  loading: boolean;
  /** The HEAD read failed — the feed itself is not answering. */
  error: boolean;
  /**
   * A "Load more" failed while the head read is fine.
   *
   * Its own input rather than folded into `error`, for the reason `error` is
   * not `error`: the two failures want DIFFERENT sentences. The head failing
   * means the feed is down and there is nothing to do here. A page append
   * failing means the feed is healthy, the walk is short, and the remedy is to
   * retry the button — so saying "the feed above failed to load" names a thing
   * that is working and withholds the one action that would help.
   */
  pagingFailed?: boolean;
  /**
   * A kind filter or the unread-only switch is on, so the event may be excluded
   * rather than merely further back. Only consulted by the `pagingFailed` arm,
   * which otherwise SUBTRACTS an unknown it never resolved: a failed page adds
   * "we could not look further", it does not rule out "the filter hides it".
   */
  filterActive?: boolean;
  /** coord has the routes but not the table — there is no feed to search. */
  migrationPending?: boolean;
}): string {
  if (state.found) {
    return "Showing the event this write was announced with — expanded below.";
  }
  // Outranks every arm below: with no table there is no page for the event to
  // be absent FROM, so "not on the page that is loaded" would report a
  // deployment state as a fact about this event — and "clear the filters"
  // would send the operator after something no filter can fix.
  if (state.migrationPending) {
    return (
      "The linked event cannot be looked up yet — coord has the notifications " +
      "routes but not the table. This is a deployment state, not a missing event."
    );
  }
  if (state.loading) return "Looking for the linked event…";
  if (state.error) {
    return "The linked event could not be looked up — the feed above failed to load.";
  }
  // Ranked BELOW `error` on purpose: when both are true the head is down, and
  // that is the bigger truth. Alone it is the opposite situation — the feed is
  // answering and only the walk is short — so this arm names the BUTTON rather
  // than the feed.
  //
  // It keeps the filter clause, though, because a failed page ADDS an unknown
  // without resolving the one the fallback arm was already carrying. An event
  // excluded by the kind filter will never match however many pages load, so
  // an arm that named only the button would leave the operator retrying it
  // forever with the one action that works — clearing the filter — never
  // mentioned.
  if (state.pagingFailed) {
    const base =
      "The linked event is not on the pages loaded so far, and loading more " +
      "failed — whether it is further back is unknown. Try Load more again.";
    return state.filterActive
      ? `${base} It may also be excluded by the filters above — clear them.`
      : base;
  }
  return (
    "The linked event is not on the page that is loaded. It may be older than " +
    "these, or excluded by the filters above — clear them or load more."
  );
}

/**
 * The single plain-language line for the row.
 *
 * Prefers coord's pre-rendered `summary` — coord owns the rendering, and its
 * kind enum is exhaustive precisely so every kind has one — and falls back to
 * a kind + subject sentence when a producer sends none. Both arms are
 * scrubbed, so the "no UUID in the default view" rule holds regardless of what
 * the payload contains.
 */
export function notificationHeadline(n: CoordNotificationRow): string {
  const summary = scrubUuids((n.summary ?? "").trim());
  if (summary) return summary;
  const subject = notificationSubject(n);
  return subject ? `${humanKind(n.kind)} — ${subject}` : humanKind(n.kind);
}

/** Unread ⇔ the calling principal has no `read_at` for this row. */
export function isUnread(n: CoordNotificationRow): boolean {
  return !n.read_at;
}

/**
 * Fold the kinds present in a freshly-fetched page into the vocabulary already
 * accumulated, returning the SAME array reference when nothing is new (so a
 * caller can use it as a `useState` updater without re-rendering on every
 * poll).
 *
 * Accumulating is the point. Deriving the dropdown from the currently-loaded
 * rows instead collapses the vocabulary to `["A"]` the moment kind A is
 * selected, and then the operator cannot get from A to B without detouring
 * through "All kinds" — the filter erases the very options it exists to offer.
 */
export function mergeKindVocabulary(
  prev: string[],
  rows: Pick<CoordNotificationRow, "kind">[]
): string[] {
  const next = new Set(prev);
  const before = next.size;
  for (const r of rows) {
    const k = (r.kind ?? "").trim();
    if (k) next.add(k);
  }
  return next.size === before ? prev : [...next].sort();
}

/**
 * The dropdown's options: the accumulated vocabulary, plus whatever kind is
 * currently selected so an active filter never vanishes from its own dropdown
 * (a filter returning zero rows must still be un-selectable).
 *
 * Derived, never hardcoded: the Alerts page's frozen four-value `KINDS` list
 * matched almost nothing in the live corpus by the time anyone measured it.
 */
export function kindOptions(vocabulary: string[], selected: string): string[] {
  const seen = new Set(vocabulary);
  if (selected && selected !== "any") seen.add(selected);
  return [...seen].sort();
}

/**
 * True when an error is coord's pre-migration degrade rather than a real
 * failure. `coord.notifications` is a best-effort manifest table, so coord
 * answers `503 {"error": "schema_migration_pending"}` for both routes until
 * the alembic revision deploys — and the web PR lands FIRST by design, so
 * this is the expected steady state for a while. It must read as "nothing
 * here yet", never as an error.
 *
 * Both probes are anchored. A bare `\b503\b` would also match a genuine 500
 * whose body happens to contain those three digits — a PR number, a byte
 * count, a duration — and swallow a real outage as "not available yet",
 * which is the worst possible direction for this predicate to fail in.
 * `HttpClient` formats the message as `<METHOD> <url> failed: <status> - …`,
 * so `failed: 503` pins the status field itself.
 */
export function isMigrationPending(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return (
    message.includes("schema_migration_pending") ||
    /failed:\s*503\b/.test(message)
  );
}

/**
 * True when an error is a rejected REQUEST rather than an unavailable server:
 * a `400` from the mark-read arm check, or a `422` from body validation.
 *
 * Kept distinct from `isMigrationPending` on purpose. Both are non-2xx and it
 * would be easy to lump them together, but they mean opposite things and want
 * opposite responses: a 503 here is "coord has not deployed yet, wait", which
 * the UI renders as a quiet nothing-to-show; a 400/422 is "this client sent a
 * body the contract forbids", which must be loud, because the alternative is a
 * button that silently does nothing forever. Swallowing a 400 as
 * migration-pending is the specific mistake this predicate exists to prevent.
 */
export function isContractError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? "");
  return /failed:\s*4(?:00|22)\b/.test(message);
}
