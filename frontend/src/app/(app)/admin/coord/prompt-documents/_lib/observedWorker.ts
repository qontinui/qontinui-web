import { absoluteTime, relativeTime } from "@/components/console";
import type { AutoPublishWorkerObservation } from "../types";

/**
 * The one sentence the auto-publish dial says about what coord OBSERVED of the
 * publication pass (plan `2026-10-17-auto-publish-lands-via-coord-2290-adoption`
 * D5 / Phase 4).
 *
 * The dial's "In force:" line says what the worker is ALLOWED to do. It used to
 * be the only line, and a bare "In force: on" over a loop nothing was running is
 * exactly the eight silent days that plan exists to end. This is the second
 * line: what anything actually did.
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
  /** Coord's own `unknown_reason`, verbatim — shown muted beside the sentence. */
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

export function describeObservedPass(
  pass: AutoPublishWorkerObservation | undefined,
  now?: number
): ObservedReading {
  switch (pass?.status) {
    case "alive": {
      // Coord could not read the lease, so no replica's pass can be called
      // THE last pass: the pass fields are null, and "no pass body recorded
      // yet" would claim passes never ran when only the holder is unknown.
      if (pass.reason === LEASE_HOLDER_UNKNOWN) {
        return {
          text: "Observed: loop alive, but coord cannot tell which replica runs the pass",
          tone: "attention",
          title: "Coord could not read the auto-publisher's lease holder",
        };
      }
      // No body execution on the holder's latest tick. With a code, the tick
      // DID run and deliberately did no pass work — every skip (`skip:switch_off`
      // when the operator turned it off) is an idle tick — so "no pass ever
      // ran" would be false. Without one, nothing it was built to do has
      // happened yet. Neither is nominal.
      if (!pass.last_work_tick_at) {
        return {
          text: pass.last_decision_code
            ? `Observed: loop alive, last tick did no pass work — ${pass.last_decision_code}`
            : "Observed: loop alive, no pass body recorded yet",
          tone: "attention",
        };
      }
      // Present but unparseable is not a pass we can place in time — say so
      // and flag it rather than rendering it as a healthy reading.
      const parseable = !Number.isNaN(
        new Date(pass.last_work_tick_at).getTime()
      );
      const when = relativeTime(pass.last_work_tick_at, {
        now,
        absent: "at an unknown time",
      });
      const code = pass.last_decision_code ?? "no decision code recorded";
      // Coord's own `nominal: false` outranks a parseable time: an `alive`
      // loop coord calls unhealthy never renders in the healthy tone, and its
      // reason is shown. (Absent from an older coord, which reads as before.)
      const unhealthy = pass.nominal === false;
      return {
        text: `Observed: last pass ${when} — ${code}`,
        tone: parseable && !unhealthy ? "nominal" : "attention",
        title: absoluteTime(pass.last_work_tick_at),
        reason: unhealthy ? pass.reason || undefined : undefined,
      };
    }
    case "erroring": {
      // The loop runs and is FAILING: its body errors on every tick (the
      // ledger records such a tick as `tick_error`), or its last pass
      // returned a failure code (`ran:publish_failed`, …). Not UNKNOWN —
      // coord observed it — and never a healthy "last pass". The code is
      // CONTEXT, not the verdict: coord decides `erroring` across replicas,
      // so the lease holder's latest code can briefly read healthy after a
      // handover. Coord's own sentence, beside it, says where to look.
      // No code at all means coord could not read the lease holder's row; its
      // reason, beside the line, then says what is failing.
      const code = pass.last_decision_code;
      return {
        text:
          code === ERROR_TICK_CODE
            ? "Observed: running but failing — the pass body errors on every tick"
            : code == null
              ? "Observed: running but failing"
              : `Observed: running but failing (last decision: ${code})`,
        tone: "attention",
        reason: pass.unknown_reason || undefined,
        title: pass.unknown_reason ? `Coord: ${pass.unknown_reason}` : undefined,
      };
    }
    case "stale":
    case "dead": {
      // The last tick of any kind is the honest "since" for a loop that
      // stopped ticking. Absolute in the text ("stale since 3m ago" reads
      // wrong), relative in the tooltip.
      const since = pass.last_tick_at
        ? absoluteTime(pass.last_tick_at).replace("time unknown", "unknown")
        : "unknown";
      return {
        text: `Observed: ${pass.status} since ${since}`,
        tone: "attention",
        title: pass.last_tick_at
          ? relativeTime(pass.last_tick_at, { now, absent: "unknown" })
          : undefined,
      };
    }
    case "not_leader_here":
      return {
        text: "Observed: no live replica is running the auto-publisher",
        tone: "attention",
      };
    default:
      return {
        text: OBSERVED_UNKNOWN_TEXT,
        tone: "unknown",
        reason: pass?.unknown_reason || undefined,
        title: pass?.unknown_reason
          ? `Coord: ${pass.unknown_reason}`
          : pass && pass.status !== "unknown"
            ? `Coord reported a worker status this console does not recognise: ${String(pass.status)}`
            : undefined,
      };
  }
}
