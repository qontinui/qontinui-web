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
  /** Extra detail for a tooltip — the other rendering of the time, or why UNKNOWN. */
  title?: string;
  /** Coord's own `unknown_reason`, verbatim — shown muted beside the sentence. */
  reason?: string;
}

export const OBSERVED_UNKNOWN_TEXT =
  "Observed: UNKNOWN — no auto-publisher pass recorded on the serving coord";

export function describeObservedPass(
  pass: AutoPublishWorkerObservation | undefined,
  now?: number
): ObservedReading {
  switch (pass?.status) {
    case "alive": {
      // A leader that has never run a body is not nominal: the loop ticks,
      // but nothing it was built to do has happened yet.
      if (!pass.last_work_tick_at) {
        return {
          text: "Observed: loop alive, no pass body recorded yet",
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
      return {
        text: `Observed: last pass ${when} — ${code}`,
        tone: parseable ? "nominal" : "attention",
        title: absoluteTime(pass.last_work_tick_at),
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
