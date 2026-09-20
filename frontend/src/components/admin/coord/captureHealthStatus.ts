/**
 * `GET /api/v1/plan-library/capture-health` — which door is actually feeding
 * the plan corpus, derived.
 *
 * Plan `2026-09-20-the-operator-plans-page-reads-the-wrong-store` Phase 4a.
 * This is the companion to Phase 0, and it answers the question Phase 0's
 * reading left standing: *the document layer is 94.8% complete — by which
 * door, and is that door still alive?*
 *
 * Everything here is pure (R8). Four readings the route's own schema states
 * and a renderer gets wrong by default:
 *
 * ## 1. A door with ZERO artifacts is the finding, so it must RENDER — and an
 * ABSENT count is not one
 *
 * `CaptureHealthResponse`'s docstring is explicit: *"Every door in
 * `CapturedBy` appears, **including the ones with zero artifacts**. That is
 * the point of the panel: 'the agent door has written nothing' is the finding,
 * and a door that is simply missing from the list reads as an absent feature
 * rather than an unused one."* So {@link deriveCaptureCensus} never filters,
 * never sorts a zero to the bottom out of sight, and marks it
 * {@link CaptureDoorReading.silent} so the renderer can say it in words. A
 * panel that quietly drops the zero row re-creates the exact
 * `capability-ships-enabled` blindness this whole plan opens by naming.
 *
 * The other half of that rule is what a `?? 0` costs here: an ABSENT `count`
 * would render as the accusation "this door has written nothing" — the
 * loudest claim on the panel, manufactured out of a field the response did
 * not carry. {@link CaptureDoorReading.count} is therefore `number | null`,
 * `silent` fires only on a served `0`, and an unstated count gets its own
 * cell [policy: `verification-and-evidence` `silent-empty-is-unknown`].
 *
 * ## 2. `last_touched_at` is LAST TOUCHED, not last captured
 *
 * `max(updated_at)`, and `CaptureDoorHealth` says why the distinction is in
 * the field's NAME: *"a kind correction bumps it without any capture."* So a
 * door that has captured nothing for a month can still carry a fresh
 * timestamp. The label is carried through verbatim; nothing here re-titles it
 * "last captured", and {@link CaptureDoorReading.freshnessCaveat} is the
 * sentence a consumer is expected to render beside it.
 *
 * ## 3. `newest_updated_at: null` is UNKNOWN on an empty corpus, not "fresh"
 *
 * The schema says `null` *"on an empty corpus"*. A renderer that prints a
 * dash and moves on has said nothing; one that prints "just now" has said
 * something false. {@link describeCorpusFreshness} returns an explicit
 * unknown arm carrying the reason [policy: `verification-and-evidence`
 * `silent-empty-is-unknown`].
 *
 * ## 4. `known: false` is a door this BUILD does not recognise
 *
 * The CHECK constraint can grow a member ahead of this frontend. The schema
 * asks for it to be *"surfaced rather than swallowed"*, so it is a first-class
 * reading rather than an "other" bucket.
 *
 * ## The one thing this census may NOT do
 *
 * It is a **second read**, with its own timing, of the **artifact store** —
 * which is axis B's source and nothing else. When the reconciliation read's
 * `work_unit_population_state` suppressed the document-layer completeness
 * claim (Phase 0 Finding 2: on that arm the flag is vacuously true), this
 * census does NOT restore it. It counts what the store holds by door; it
 * cannot say whether every plan stem has a body, because the population that
 * question is asked of is the thing that could not be read. See
 * {@link SECOND_READ_CAVEAT}.
 */

// ---------------------------------------------------------------------------
// The wire shape. Mirrors `backend/app/schemas/plan_library.py`
// (`CaptureHealthResponse` / `CaptureDoorHealth`). Optional where reading a
// missing field wrongly would manufacture a claim.
// ---------------------------------------------------------------------------

export interface CaptureDoorHealth {
  /** `runner_scan` / `agent` / `operator` — or a value this build has not heard of. */
  captured_by: string;
  /**
   * How many artifacts this door wrote.
   *
   * OPTIONAL here although the route declares it required, for the reason
   * stated at the top of this block: reading a missing field wrongly would
   * manufacture a claim, and on THIS field the manufactured claim is the
   * loudest one the panel makes — *"this door has written nothing"*, a false
   * accusation about a door, on the one panel whose whole purpose is that
   * accusation. An absent count is UNKNOWN; only a served `0` is silence.
   */
  count?: number;
  /** `false` when the corpus holds a door this build does not recognise. */
  known?: boolean;
  first_at?: string | null;
  /** `max(updated_at)` — LAST TOUCHED, never "last captured". */
  last_touched_at?: string | null;
}

export interface CaptureHealthResponse {
  total?: number;
  doors?: CaptureDoorHealth[];
  /** `max(updated_at)` across every door. `null` on an EMPTY corpus. */
  newest_updated_at?: string | null;
}

// ---------------------------------------------------------------------------
// Per-door readings
// ---------------------------------------------------------------------------

/** The three doors the backend's vocabulary knows, in the order they matter. */
export const KNOWN_DOOR_ORDER: readonly string[] = [
  "runner_scan",
  "agent",
  "operator",
];

const DOOR_LABEL: Record<string, string> = {
  runner_scan: "runner scan",
  agent: "agent write door",
  operator: "operator",
};

const DOOR_DETAIL: Record<string, string> = {
  runner_scan:
    "the deterministic scanner — the corpus's backbone. It walks a machine's " +
    "plan directories and captures what it finds there.",
  agent:
    "the agent write door — what a scan cannot see: ad-hoc worktree prompts, " +
    "and the provenance edges only the agent that ran the chain knows. If " +
    "this door is unused the corpus is quietly missing exactly that half.",
  operator: "a hand-written capture through the operator surface.",
};

export interface CaptureDoorReading {
  doorId: string;
  /** Human label; the raw `captured_by` for a door this build does not know. */
  label: string;
  /** `null` when the response carried no count — UNKNOWN, never a zero. */
  count: number | null;
  /**
   * `true` when this door has written NOTHING — a SERVED `0`. The finding,
   * not a gap, and never inferred from a missing field.
   */
  silent: boolean;
  /** `true` when the response carried no count for this door at all. */
  countUnstated: boolean;
  /**
   * `true` when the corpus carries a `captured_by` this build's vocabulary
   * does not contain — surfaced, never bucketed as "other".
   */
  unrecognised: boolean;
  firstAt: string | null;
  /** `max(updated_at)`. Named for what it measures. */
  lastTouchedAt: string | null;
  /** What this door is, for a title or the row's second line. */
  detail: string;
  /**
   * The sentence that must ride beside `lastTouchedAt`. Present whenever the
   * door has a timestamp at all, because the caveat is a property of the
   * FIELD, not of any particular value.
   */
  freshnessCaveat: string | null;
}

const TOUCHED_CAVEAT =
  "Last TOUCHED, not last captured: this is max(updated_at), and a kind " +
  "correction bumps it with no capture at all. A fresh stamp here is not " +
  "evidence the door is still writing.";

function doorLabel(id: string, known: boolean): string {
  if (!known) return id;
  return DOOR_LABEL[id] ?? id;
}

/**
 * One door's reading. A zero count is a value, never a reason to drop a row —
 * and an ABSENT count is neither a value nor a zero.
 */
export function describeDoor(door: CaptureDoorHealth): CaptureDoorReading {
  const known = door.known !== false;
  // NOT `?? 0`. The zero is this panel's headline finding, so it may only be
  // rendered where the route actually served one.
  const count = typeof door.count === "number" ? door.count : null;
  const lastTouchedAt = door.last_touched_at ?? null;
  return {
    doorId: door.captured_by,
    label: doorLabel(door.captured_by, known),
    count,
    silent: count === 0,
    countUnstated: count === null,
    unrecognised: !known,
    firstAt: door.first_at ?? null,
    lastTouchedAt,
    detail: known
      ? (DOOR_DETAIL[door.captured_by] ??
        "a capture door this build knows by name but has no description for.")
      : "This build's vocabulary does not contain this door. The corpus " +
        "holds artifacts captured through it, so it is shown rather than " +
        "bucketed as 'other' — a newer backend may have added it.",
    freshnessCaveat: lastTouchedAt !== null ? TOUCHED_CAVEAT : null,
  };
}

export interface CaptureCensus {
  /** Every door the response carried, zeros INCLUDED, in a stable order. */
  doors: CaptureDoorReading[];
  /** The route's own `total`; `null` when it served none — UNKNOWN. */
  total: number | null;
  /** Doors that have written nothing — a served `0`. The headline finding. */
  silentDoors: CaptureDoorReading[];
  /** Doors whose count this response did not carry. UNKNOWN, not silent. */
  countUnstatedDoors: CaptureDoorReading[];
  /** Doors whose name this build does not recognise. */
  unrecognisedDoors: CaptureDoorReading[];
  /**
   * `true` when the response carried no `doors` array at all — which is a
   * response shape this build does not understand, NOT "no door has written".
   * The route returns every door in its vocabulary on every read.
   */
  doorsUnstated: boolean;
}

/**
 * Order: the three known doors first, in vocabulary order, then anything
 * unrecognised. Deliberately NOT by count — sorting by count would push the
 * zero rows to one end, and "the agent door has written nothing" is the
 * reading this panel exists to deliver, not its footer.
 */
export function deriveCaptureCensus(
  res: CaptureHealthResponse | null
): CaptureCensus {
  const raw = res?.doors;
  const readings = (raw ?? []).map(describeDoor);
  const rank = (d: CaptureDoorReading) => {
    const i = KNOWN_DOOR_ORDER.indexOf(d.doorId);
    return i === -1 ? KNOWN_DOOR_ORDER.length : i;
  };
  const doors = [...readings].sort(
    (a, b) => rank(a) - rank(b) || a.doorId.localeCompare(b.doorId)
  );
  return {
    doors,
    total: typeof res?.total === "number" ? res.total : null,
    silentDoors: doors.filter((d) => d.silent),
    countUnstatedDoors: doors.filter((d) => d.countUnstated),
    unrecognisedDoors: doors.filter((d) => d.unrecognised),
    doorsUnstated: !Array.isArray(raw),
  };
}

// ---------------------------------------------------------------------------
// The corpus's freshness figure
// ---------------------------------------------------------------------------

export interface CorpusFreshness {
  /** `true` when nothing here is a measurement. */
  unknown: boolean;
  /** The timestamp, when there is one. */
  at: string | null;
  /**
   * What to render — the WHOLE reading, so a caller renders it and nothing
   * else. Never "fresh", never an epoch, never a bare dash, and on an unknown
   * arm it says so itself: a renderer that prefixes its own `unknown —` in
   * front of a sentence that already ends *"…is unknown"* labels the value
   * twice.
   */
  text: string;
}

/**
 * `newest_updated_at` — `max(updated_at)` across every door.
 *
 * `null` is the EMPTY-corpus arm, and the schema says so. It is UNKNOWN about
 * freshness rather than a statement that the corpus is current: there is no
 * observation behind it at all. An absent field (an older backend) reads the
 * same way for the same reason.
 */
export function describeCorpusFreshness(
  res: CaptureHealthResponse | null
): CorpusFreshness {
  if (res === null) {
    return {
      unknown: true,
      at: null,
      text: "the capture census has not been read, so the corpus's freshness is unknown.",
    };
  }
  const at = res.newest_updated_at ?? null;
  if (at === null) {
    return {
      unknown: true,
      at: null,
      text:
        "unknown — the route served no newest-touched timestamp: the corpus " +
        "is empty, or this backend does not report it. Either way nothing " +
        "here says the corpus is current.",
    };
  }
  return { unknown: false, at, text: TOUCHED_CAVEAT };
}

// ---------------------------------------------------------------------------
// What this census may NOT be read as
// ---------------------------------------------------------------------------

/**
 * The caveat that rides the panel whenever the reconciliation read beside it
 * suppressed its document-layer completeness claim.
 *
 * Phase 0's Finding 2 is that `document_axis_complete` is vacuously `true`
 * when coord's work-unit population arm failed. This census is a SEPARATE
 * request against the artifact store, so it CAN be read on that arm — the
 * store answered. What it cannot do is repair the suppressed claim: it counts
 * rows by door, and "does every plan stem have a body?" is a question about
 * the population that could not be read.
 */
export const SECOND_READ_CAVEAT =
  "This census is a separate read of the artifact store, with its own " +
  "timing. It says which door wrote what is in that store — it does NOT " +
  "restore the document-layer completeness verdict suppressed above, because " +
  "that verdict is about the population coord could not serve. The two " +
  "totals may also disagree simply because they were read at different " +
  "moments.";

/**
 * The label a census that is still on screen after a FAILED refresh must
 * carry.
 *
 * Keeping the previous census beside a failed read is the right call — an
 * empty panel would be a fabricated absence — but only *"and labelled"*.
 * Unlabelled, the summary goes on reading "3 doors, all of them writing" and
 * `Corpus last touched: 4m ago` keeps drifting as though it were being
 * re-measured, which is the stale-read defect the two lists on this page
 * already guard with their own `plansStale` arm.
 */
export const STALE_CENSUS_NOTE =
  "The last refresh of this census FAILED, so everything below is the last " +
  "good read and has not been re-measured since. The relative times keep " +
  "drifting; they are ages of an old observation, not a current one.";

/** The same caveat's shorter form, for a read where nothing was suppressed. */
export const SECOND_READ_NOTE =
  "A separate read of the artifact store, with its own timing — so its total " +
  "may differ from the reconciliation's by whatever landed between the two.";
