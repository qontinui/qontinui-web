/**
 * spawnPathVerdict — a spawn path's "Effective state": the verdict across
 * EVERY switch that governs it, each switch's own verdict
 * (`MatrixGate.verdict`) folded the strictest way.
 *
 * | the path's governing gates | the verdict |
 * |---|---|
 * | any one is `unknown` | UNKNOWN — naming the switches that could not be read |
 * | none unknown, any one `off` | Off — naming the switches that are off |
 * | every one read and `on` | On |
 * | none governs (every one `not_governing`) | UNKNOWN — nothing read says it is on |
 *
 * A gate coord reads but does not act on (`not_governing`) is left out. So the
 * verdict is never more permissive than any switch under it: it can say
 * UNKNOWN or Off where coord would still start a session, never On while one
 * of the path's switches is unread or off. The registry switch keeps its own
 * labelled value beside the verdict, so the one switch coord's authorization
 * fold reads is still shown as served (`spawnPathGates.ts`).
 */

import type { GateVerdict, MatrixGate } from "./spawnPathGates";

export interface PathVerdict {
  state: "on" | "off" | "unknown";
  /** The words shown. */
  text: string;
  /** Which switches made it so, in the reader's words. */
  title: string;
  /** Some switch it rests on is the last good read, not the latest. */
  stale: boolean;
}

function titles(gates: readonly MatrixGate[]): string {
  const names = gates.map((g) => g.title.toLowerCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function are(gates: readonly MatrixGate[]): string {
  return gates.length === 1 ? "is" : "are";
}

/** The verdict over a path's gates (see the module doc). */
export function pathVerdict(gates: readonly MatrixGate[]): PathVerdict {
  const governing = gates.filter((g) => g.verdict !== "not_governing");
  const by = (v: GateVerdict) => governing.filter((g) => g.verdict === v);
  const unknown = by("unknown");
  const off = by("off");
  const stale = governing.some((g) => g.effective.stale);
  if (governing.length === 0) {
    return {
      state: "unknown",
      text: "UNKNOWN",
      title:
        "No switch read for this path is one the service acts on, so nothing read says it is on.",
      stale,
    };
  }
  if (unknown.length > 0) {
    return {
      state: "unknown",
      text: "UNKNOWN",
      title: `Unknown because the ${titles(unknown)} ${are(unknown)} unknown: this path is on only when every switch that governs it is read and on.`,
      stale,
    };
  }
  if (off.length > 0) {
    return {
      state: "off",
      text: "Off",
      title: `Off because the ${titles(off)} ${are(off)} off.`,
      stale,
    };
  }
  return {
    state: "on",
    text: "On",
    title:
      governing.length === 1
        ? `On: its one governing switch, the ${titles(governing)}, is on.`
        : `On: every switch that governs it is read and on (${titles(governing)}).`,
    stale,
  };
}
