import { absoluteTime, relativeTime } from "@/components/console";
import type { AutoPublishWorkerObservation } from "../types";

/**
 * The sentences the auto-publish dial says about what coord OBSERVED of its two
 * workers (plan `2026-10-17-auto-publish-lands-via-coord-2290-adoption`
 * D5 / Phase 4): the publication pass, and the daily recovery reconcile the
 * dial promises keeps running when the switch is off.
 *
 * The dial's "In force:" line says what the worker is ALLOWED to do. It used to
 * be the only line, and a bare "In force: on" over a loop nothing was running is
 * exactly the eight silent days that plan exists to end. These are the lines
 * below it: what anything actually did.
 *
 * Two rules, each a way this would otherwise lie:
 *
 * 1. **"Last pass" is `last_work_tick_at`, never `last_tick_at`.** A follower
 *    replica's `follower_skip` refreshes `last_tick_at` every interval, so it
 *    would report a pass on a coord where no pass has run.
 * 2. **Anything not positively recognised is UNKNOWN.** An absent observation
 *    (older coord, failed read), coord's own `unknown`, and a status string this
 *    build does not know all render the same UNKNOWN sentence — never a healthy
 *    reading by default.
 */
export type ObservedTone = "nominal" | "attention" | "unknown";

export interface ObservedReading {
  text: string;
  tone: ObservedTone;
  /**
   * Extra detail for a tooltip — the other rendering of the time, or coord's
   * sentence for why the status is UNKNOWN or erroring.
   */
  title?: string;
  /**
   * Coord's own words, verbatim, shown muted beside the sentence: its
   * `unknown_reason`, or the `reason` it gives for a loop that is not nominal.
   */
  reason?: string;
}

/**
 * The decision code coord's worker ledger records for a tick whose body
 * errored (`worker_ledger::TICK_ERROR_DECISION`).
 */
export const ERROR_TICK_CODE = "tick_error";

/**
 * Coord's `reason` for a live loop whose lease holder it could not read
 * (`observe_worker`): never nominal, and no pass is attributable.
 */
export const LEASE_HOLDER_UNKNOWN = "lease_holder_unknown";

export const OBSERVED_UNKNOWN_TEXT =
  "Observed: UNKNOWN — no auto-publisher pass recorded on the serving coord";

export const OBSERVED_RECONCILE_UNKNOWN_TEXT =
  "Observed reconcile: UNKNOWN — no recovery reconcile recorded on the serving coord";

/**
 * Coord's idle code for a recovery tick whose daily reconcile is not due, and
 * whose last one returned with no errors (`TICK_RECOVERY_NOT_DUE`; after errors
 * coord serves `erroring` instead). The memory behind it lives in the process
 * and starts empty, so the code is only ever written after a clean reconcile.
 */
export const RECONCILE_NOT_DUE_CODE = "recovery:not_due";

/** The per-worker words of the sentences `describeObserved` builds. */
interface WorkerWording {
  label: string;
  /** Names the time of the last body execution. */
  lastRun: string;
  /** What coord cannot attribute to a replica when the lease is unreadable. */
  leaseSubject: string;
  /** An idle tick with a code: the tick ran and did no work. */
  idleTick: string;
  /** An idle tick with no code: nothing has run yet. */
  neverRan: string;
  /** Coord's `tick_error`: the body errors every time it runs. */
  bodyErrors: string;
  noReplica: string;
  unknownText: string;
  /**
   * The idle code that is this worker's ordinary resting state, with its
   * sentence. Only this exact code reads healthy with no body execution beside
   * it: any other idle code is still not positively recognised.
   */
  resting?: { code: string; text: string };
}

const PASS_WORDING: WorkerWording = {
  label: "Observed",
  lastRun: "last pass",
  leaseSubject: "the pass",
  idleTick: "last tick did no pass work",
  neverRan: "no pass body recorded yet",
  bodyErrors: "the pass body errors on every tick",
  noReplica: "no live replica is running the auto-publisher",
  unknownText: OBSERVED_UNKNOWN_TEXT,
};

const RECONCILE_WORDING: WorkerWording = {
  label: "Observed reconcile",
  lastRun: "last ran",
  leaseSubject: "the reconcile",
  idleTick: "last tick did no reconcile",
  neverRan: "no reconcile recorded yet",
  bodyErrors: "the reconcile errors on every attempt",
  noReplica: "no live replica is running the recovery reconcile",
  unknownText: OBSERVED_RECONCILE_UNKNOWN_TEXT,
  // The ledger keeps only each row's latest outcome, so for about 23 hours of
  // every day `last_work_tick_at` is null on a healthy reconcile.
  resting: {
    code: RECONCILE_NOT_DUE_CODE,
    text: "clean within the last day, next run not due",
  },
};

function describeObserved(
  worker: AutoPublishWorkerObservation | undefined,
  words: WorkerWording,
  now?: number
): ObservedReading {
  const { label } = words;
  switch (worker?.status) {
    case "alive": {
      // Coord could not read the lease, so no replica's run can be called
      // THE last run: the run fields are null, and "nothing recorded yet" would
      // claim runs never happened when only the holder is unknown.
      if (worker.reason === LEASE_HOLDER_UNKNOWN) {
        return {
          text: `${label}: loop alive, but coord cannot tell which replica runs ${words.leaseSubject}`,
          tone: "attention",
          title: "Coord could not read the auto-publisher's lease holder",
        };
      }
      // No body execution on the holder's latest tick. With a code, the tick
      // DID run and deliberately did no work — every skip (`skip:switch_off`
      // when the operator turned it off) is an idle tick — so "nothing ever
      // ran" would be false. Without one, nothing it was built to do has
      // happened yet. Neither is nominal, unless the code is this worker's
      // named resting state and coord agrees it is healthy.
      if (!worker.last_work_tick_at) {
        const code = worker.last_decision_code;
        if (
          words.resting &&
          code === words.resting.code &&
          worker.nominal !== false
        ) {
          return {
            text: `${label}: ${words.resting.text} — ${code}`,
            tone: "nominal",
          };
        }
        return {
          text: code
            ? `${label}: loop alive, ${words.idleTick} — ${code}`
            : `${label}: loop alive, ${words.neverRan}`,
          tone: "attention",
          reason:
            worker.nominal === false ? worker.reason || undefined : undefined,
        };
      }
      // Present but unparseable is not a run we can place in time — say so
      // and flag it rather than rendering it as a healthy reading.
      const parseable = !Number.isNaN(
        new Date(worker.last_work_tick_at).getTime()
      );
      const when = relativeTime(worker.last_work_tick_at, {
        now,
        absent: "at an unknown time",
      });
      const code = worker.last_decision_code ?? "no decision code recorded";
      // Coord's own `nominal: false` outranks a parseable time: an `alive`
      // loop coord calls unhealthy never renders in the healthy tone, and its
      // reason is shown. (Absent from an older coord, which reads as before.)
      const unhealthy = worker.nominal === false;
      return {
        text: `${label}: ${words.lastRun} ${when} — ${code}`,
        tone: parseable && !unhealthy ? "nominal" : "attention",
        title: absoluteTime(worker.last_work_tick_at),
        reason: unhealthy ? worker.reason || undefined : undefined,
      };
    }
    case "erroring": {
      // The loop runs and is FAILING: its body errors on every tick (the
      // ledger records such a tick as `tick_error`), or its last run
      // returned a failure code (`ran:publish_failed`,
      // `recovery:reconciled_with_errors`, …). Not UNKNOWN — coord observed
      // it — and never a healthy "last run". The code is CONTEXT, not the
      // verdict: coord decides `erroring` across replicas, so the lease
      // holder's latest code can briefly read healthy after a handover.
      // Coord's own sentence, beside it, says where to look.
      // No code at all means coord could not read the lease holder's row; its
      // reason, beside the line, then says what is failing.
      const code = worker.last_decision_code;
      return {
        text:
          code === ERROR_TICK_CODE
            ? `${label}: running but failing — ${words.bodyErrors}`
            : code == null
              ? `${label}: running but failing`
              : `${label}: running but failing (last decision: ${code})`,
        tone: "attention",
        reason: worker.unknown_reason || undefined,
        title: worker.unknown_reason
          ? `Coord: ${worker.unknown_reason}`
          : undefined,
      };
    }
    case "stale":
    case "dead": {
      // The last tick of any kind is the honest "since" for a loop that
      // stopped ticking. Absolute in the text ("stale since 3m ago" reads
      // wrong), relative in the tooltip.
      const since = worker.last_tick_at
        ? absoluteTime(worker.last_tick_at).replace("time unknown", "unknown")
        : "unknown";
      return {
        text: `${label}: ${worker.status} since ${since}`,
        tone: "attention",
        title: worker.last_tick_at
          ? relativeTime(worker.last_tick_at, { now, absent: "unknown" })
          : undefined,
      };
    }
    case "not_leader_here":
      return {
        text: `${label}: ${words.noReplica}`,
        tone: "attention",
      };
    default:
      return {
        text: words.unknownText,
        tone: "unknown",
        reason: worker?.unknown_reason || undefined,
        title: worker?.unknown_reason
          ? `Coord: ${worker.unknown_reason}`
          : worker && worker.status !== "unknown"
            ? `Coord reported a worker status this console does not recognise: ${String(worker.status)}`
            : undefined,
      };
  }
}

/** What coord observed of the publication pass. */
export function describeObservedPass(
  pass: AutoPublishWorkerObservation | undefined,
  now?: number
): ObservedReading {
  return describeObserved(pass, PASS_WORDING, now);
}

/** What coord observed of the daily recovery reconcile. */
export function describeObservedReconcile(
  reconcile: AutoPublishWorkerObservation | undefined,
  now?: number
): ObservedReading {
  return describeObserved(reconcile, RECONCILE_WORDING, now);
}
