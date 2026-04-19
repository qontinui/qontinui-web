/**
 * Lightweight human-readable preview for common cron expressions.
 *
 * Not a full cron translator. We handle the most common shapes so the user
 * gets reassurance in the create-schedule dialog. If we don't recognise a
 * shape we fall through to the raw expression.
 *
 * Supported forms:
 *   "<minute> <hour> * * *"         daily
 *   "*\/N * * * *"                    every N minutes
 *   "<minute> *\/N * * *"             every N hours at minute M
 *   "0 0 * * *"                      midnight UTC daily
 *   "<minute> <hour> * * <weekday>"  weekly
 */

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function describeCron(expression: string): string {
  const expr = expression.trim();
  if (!expr) return "";
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return expr;
  const [minute, hour, dom, month, dow] = parts;

  // Every N minutes
  if (
    minute &&
    minute.startsWith("*/") &&
    hour === "*" &&
    dom === "*" &&
    month === "*" &&
    dow === "*"
  ) {
    const n = Number.parseInt(minute.slice(2), 10);
    if (Number.isFinite(n) && n > 0) {
      return `Every ${n} minute${n === 1 ? "" : "s"}`;
    }
  }

  // Every minute
  if (
    minute === "*" &&
    hour === "*" &&
    dom === "*" &&
    month === "*" &&
    dow === "*"
  ) {
    return "Every minute";
  }

  // Daily at HH:MM (UTC)
  const m = minute ? Number.parseInt(minute, 10) : NaN;
  const h = hour ? Number.parseInt(hour, 10) : NaN;
  if (
    Number.isFinite(m) &&
    Number.isFinite(h) &&
    dom === "*" &&
    month === "*" &&
    dow === "*"
  ) {
    return `Every day at ${pad(h)}:${pad(m)} UTC`;
  }

  // Weekly at HH:MM UTC on <weekday>
  if (
    Number.isFinite(m) &&
    Number.isFinite(h) &&
    dom === "*" &&
    month === "*" &&
    dow !== "*" &&
    dow
  ) {
    const dowNum = Number.parseInt(dow, 10);
    if (Number.isFinite(dowNum) && dowNum >= 0 && dowNum <= 6) {
      return `Every ${WEEKDAY_NAMES[dowNum]} at ${pad(h)}:${pad(m)} UTC`;
    }
  }

  // Every N hours at minute M
  if (
    hour &&
    hour.startsWith("*/") &&
    Number.isFinite(m) &&
    dom === "*" &&
    month === "*" &&
    dow === "*"
  ) {
    const n = Number.parseInt(hour.slice(2), 10);
    if (Number.isFinite(n) && n > 0) {
      return `Every ${n} hour${n === 1 ? "" : "s"} at minute ${m}`;
    }
  }

  return expr;
}
