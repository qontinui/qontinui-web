/**
 * sessionAccount — which Claude account a session ran on, what it was called,
 * and whether it is running now. Pure: no React, no fetch.
 *
 * Plan `2026-10-19-session-lookup-by-name-shows-claude-account-in-web`
 * Phase 3. The operator's question was *"what account was the session
 * `spaceship-latency` on?"*, and the answer has to survive the session ending:
 * the durable fact is coord's account stamp on `coord.agent_sessions`
 * ({@link SessionAccountStamp}), reported by every runner for every session id
 * its box can still resolve. Whether the process is running RIGHT NOW is a
 * different fact with a different source — coord's per-device census — and
 * this module keeps the two apart.
 *
 * ## Never blank, and never one UNKNOWN for three reasons
 *
 * An unresolved account renders `UNKNOWN — <why>`, never a blank cell and
 * never "none" (`verification-and-evidence` `unknown-must-not-render-as-a-default`).
 * The why matters, because each one sends the operator somewhere different:
 *
 * | the row says | the cell reads | the operator should look at |
 * |---|---|---|
 * | `row_class: null` | `UNKNOWN — agent half unread (<detail>)` | the agent read / the list's join |
 * | stamp key ABSENT | `UNKNOWN — coord does not report the account yet` | coord's deploy (Phase 1) |
 * | stamp `account: null` | `UNKNOWN — not yet reported by <device>` | that device's runner (Phase 2) |
 * | `lifecycle_only` | `–`, titled *not applicable* | nothing — a shell has no Claude account |
 *
 * The absent-vs-null split is the subtle one: the web backend passes coord's
 * agent row through untouched, so an absent key here is still coord not
 * serving the field — a fact about COORD — while `null` is coord serving it and
 * no runner having reported. Conflating them would blame a device for a coord
 * that has not shipped.
 *
 * ## `default` is not an account name on its own
 *
 * The label is the config-dir basename minus `.claude-`, and the bare
 * `~/.claude` home is `default` on every box — so two `default`s on two
 * machines are two different accounts. It renders as `default (<config_dir>)`.
 * The roster shortcut (`clq`) is `accounts.json` data, not coord data, and is
 * deliberately never shown here: hardcoding it would be a second source of
 * truth.
 */

import { relativeTime, absoluteTime } from "@/components/console/time";
import {
  AgentSessionsApiError,
  type SessionAccountStamp,
  type SessionCard,
  type SessionCensusResponse,
  type SessionCensusRow,
} from "@/services/agent-sessions-api";
import type { HalfResult } from "./sessionKeyResolution";
import type { ConsolidatedSessionRow } from "./sessionConsoleStatus";

// ---------------------------------------------------------------------------
// The account fact — shared by the list cell and the detail card
// ---------------------------------------------------------------------------

/** Why the account is unknown, as a machine-readable key (tests, facets). */
export type AccountUnknownReason =
  | "agent-half-unread"
  | "coord-not-reporting"
  | "not-yet-reported";

export type AccountFact =
  | {
      state: "known";
      /** The rendered label — `default (<config_dir>)` for the bare home. */
      label: string;
      account: string;
      configDir: string | null;
    }
  | { state: "unknown"; reason: AccountUnknownReason; label: string };

/** The placeholder inside `default (…)` when the config dir is not known. */
const CONFIG_DIR_UNKNOWN = "config dir UNKNOWN";

/**
 * Render an account label. `default` alone names a different account on every
 * machine, so it carries its config dir.
 */
export function formatAccountLabel(
  account: string,
  configDir: string | null | undefined
): string {
  if (account === "default") {
    return `default (${configDir?.trim() || CONFIG_DIR_UNKNOWN})`;
  }
  return account;
}

/**
 * The sentence naming the device that owes the report. `deviceLabel` is the
 * caller's machine label (hostname, else a short id); `null` means coord
 * recorded no device at all, which is its own sentence rather than an empty
 * slot in this one.
 */
function notYetReported(subject: string, deviceLabel: string | null): string {
  return deviceLabel
    ? `UNKNOWN — ${subject} not yet reported by ${deviceLabel}`
    : `UNKNOWN — ${subject} not yet reported (coord recorded no device for this session)`;
}

const COORD_NOT_REPORTING = "UNKNOWN — coord does not report the account yet";

/**
 * Read the account off a stamp — an agent-half list row or a resolver card.
 *
 * `"account" in stamp` is the load-bearing test: an ABSENT key is coord not
 * serving the stamp, `null` is no runner having reported. See the module doc.
 */
export function readAccountFact(
  stamp: SessionAccountStamp,
  deviceLabel: string | null
): AccountFact {
  if (!("account" in stamp)) {
    return {
      state: "unknown",
      reason: "coord-not-reporting",
      label: COORD_NOT_REPORTING,
    };
  }
  const account = stamp.account?.trim();
  if (!account) {
    return {
      state: "unknown",
      reason: "not-yet-reported",
      label: notYetReported("account", deviceLabel),
    };
  }
  return {
    state: "known",
    label: formatAccountLabel(account, stamp.config_dir),
    account,
    configDir: stamp.config_dir?.trim() || null,
  };
}

// ---------------------------------------------------------------------------
// The list's Account cell
// ---------------------------------------------------------------------------

export type AccountCell =
  | ({ kind: "fact"; title: string } & AccountFact)
  | { kind: "not-applicable"; title: string };

export interface AccountCellContext {
  /** device_id → the console's machine label (hostname, else a short id). */
  machineLabel: (deviceId: string | null | undefined) => string | null;
  /**
   * The list envelope's agent-half read. When it FAILED, its `detail` is why
   * every row's agent half is unread, and the cell says so.
   */
  agentHalf?: { read: string; detail?: string } | null;
}

/**
 * The Account cell for one console row.
 *
 * Reads the list row's agent half (`row.agent_session`) — the console renders
 * the LIST, so the list row is the load-bearing read, not a resolver card.
 */
export function deriveAccountCell(
  row: ConsolidatedSessionRow,
  ctx: AccountCellContext
): AccountCell {
  if (row.row_class === "lifecycle_only") {
    return {
      kind: "not-applicable",
      title:
        "no Claude Code session id — a Claude account is not applicable to this session (a shell, a workflow, an automation), not missing",
    };
  }

  const half = row.agent_session ?? null;
  if (row.row_class == null || half == null) {
    const detail =
      ctx.agentHalf?.read === "failed"
        ? ctx.agentHalf.detail || "the agent read failed"
        : row.row_class == null
          ? "the agent read did not carry this row"
          : "coord served no agent row for this session";
    const label = `UNKNOWN — agent half unread (${detail})`;
    return {
      kind: "fact",
      state: "unknown",
      reason: "agent-half-unread",
      label,
      title: `${label}. The account lives on the agent half of the join, which this list read did not establish — unknown, not "no account".`,
    };
  }

  const fact = readAccountFact(
    half,
    ctx.machineLabel(half.device_id ?? row.device_id ?? null)
  );
  if (fact.state === "unknown") {
    return {
      kind: "fact",
      ...fact,
      title:
        fact.reason === "coord-not-reporting"
          ? `${fact.label}. The deployed coord serves no account field on its agent-session rows (the session-identity stamp is not live), so this is a fact about coord, not about the session or its device.`
          : `${fact.label}. coord serves the account stamp; no runner has reported this session's account yet.`,
    };
  }
  return {
    kind: "fact",
    ...fact,
    title: [
      `Claude account ${fact.label}`,
      `config dir ${fact.configDir ?? "UNKNOWN"}`,
      half.account_observed_at
        ? `observed ${absoluteTime(half.account_observed_at)}`
        : "observation time UNKNOWN",
    ].join(" — "),
  };
}

/**
 * The account facet's value for a row. Every UNKNOWN shares one chip; a
 * not-applicable row (no Claude session) belongs to no chip, so selecting an
 * account hides shells rather than counting them as unknown.
 */
export const ACCOUNT_FACET_UNKNOWN = "(unknown)";

export function accountFacetValue(cell: AccountCell): string | null {
  if (cell.kind === "not-applicable") return null;
  return cell.state === "known" ? cell.label : ACCOUNT_FACET_UNKNOWN;
}

// ---------------------------------------------------------------------------
// The detail card's identity facts
// ---------------------------------------------------------------------------

/** A value, or UNKNOWN with its reason. Never blank. */
export type Fact =
  | { state: "known"; text: string; title?: string }
  | { state: "unknown"; text: string };

/** One name, with the source it was read from — two sources can disagree. */
export interface SourcedName {
  source: "registry" | "tag";
  /** Rendered beside the value: where the name came from. */
  sourceLabel: string;
  value: string;
}

export interface CardIdentity {
  account: AccountFact;
  configDir: Fact;
  device: Fact;
  observed: Fact;
  /** Registry name first, then the tag name when it differs. Empty only when
   *  {@link CardIdentity.namesUnknown} says why. */
  names: SourcedName[];
  namesUnknown: string | null;
}

const SOURCE_LABEL: Record<SourcedName["source"], string> = {
  registry: "Claude Code registry name",
  tag: "fleet tag name — the Session-Name trailer",
};

/**
 * Every identity fact the detail card shows, each known or UNKNOWN-with-why.
 *
 * `hostnameFor` maps a device id to a hostname from the live device stream;
 * the card's own `machine` binding wins when coord bound one.
 */
export function deriveCardIdentity(
  card: SessionCard,
  opts: {
    hostnameFor?: (deviceId: string) => string | undefined;
    now?: number;
  } = {}
): CardIdentity {
  const deviceLabel = card.device_id
    ? (card.machine?.hostname ??
      card.machine?.name ??
      opts.hostnameFor?.(card.device_id) ??
      card.device_id)
    : null;

  const account = readAccountFact(card, deviceLabel);
  const stamped = "account" in card;

  const device: Fact = card.device_id
    ? {
        state: "known",
        text:
          deviceLabel && deviceLabel !== card.device_id
            ? `${deviceLabel} (${card.device_id})`
            : card.device_id,
      }
    : {
        state: "unknown",
        text: "UNKNOWN — coord recorded no device for this session",
      };

  const configDir: Fact = !stamped
    ? {
        state: "unknown",
        text: COORD_NOT_REPORTING.replace("account", "config dir"),
      }
    : card.config_dir?.trim()
      ? { state: "known", text: card.config_dir.trim() }
      : { state: "unknown", text: notYetReported("config dir", deviceLabel) };

  const observed: Fact = !stamped
    ? {
        state: "unknown",
        text: COORD_NOT_REPORTING.replace(
          "the account",
          "when the account was observed"
        ),
      }
    : !card.account_observed_at
      ? {
          state: "unknown",
          text: notYetReported("observation time", deviceLabel),
        }
      : Number.isNaN(Date.parse(card.account_observed_at))
        ? {
            state: "unknown",
            text: `UNKNOWN — coord served an unparseable observation time (${card.account_observed_at})`,
          }
        : {
            state: "known",
            text: relativeTime(card.account_observed_at, { now: opts.now }),
            title: absoluteTime(card.account_observed_at),
          };

  const registry = card.registry_name?.trim() || null;
  const tag = card.tag_name?.trim() || null;
  const names: SourcedName[] = [];
  if (registry) {
    names.push({
      source: "registry",
      sourceLabel: SOURCE_LABEL.registry,
      value: registry,
    });
  }
  if (tag && tag !== registry) {
    names.push({ source: "tag", sourceLabel: SOURCE_LABEL.tag, value: tag });
  }
  let namesUnknown: string | null = null;
  if (names.length === 0) {
    namesUnknown =
      !("registry_name" in card) && !("tag_name" in card)
        ? "UNKNOWN — coord does not report registry or tag names yet"
        : notYetReported("registry or tag name", deviceLabel);
  }

  return { account, configDir, device, observed, names, namesUnknown };
}

// ---------------------------------------------------------------------------
// Live status — the census, which is NOT the stamp
// ---------------------------------------------------------------------------

export type LiveStatus =
  | { state: "loading"; text: string }
  | { state: "live"; text: string; title: string }
  | { state: "not-live"; text: string; title: string }
  | { state: "unknown"; text: string; title: string };

/**
 * Classify a thrown census read. The proxy answers coord's 404 as a 200
 * not-served envelope, so a 404 that still reaches here is the same fact
 * (`absent`, which {@link deriveLiveStatus} reads as "census not served");
 * anything else is a read that did not land.
 */
export function classifyCensusError(
  err: unknown
): HalfResult<SessionCensusResponse> {
  if (err instanceof AgentSessionsApiError && err.status === 404) {
    return { state: "absent" };
  }
  const detail =
    err instanceof AgentSessionsApiError
      ? `${err.status}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err ?? "unknown error");
  return { state: "unknown", detail };
}

/** Find the census row that answers for `sessionId` — by id or by alias. */
export function censusRowFor(
  rows: readonly SessionCensusRow[],
  sessionId: string
): SessionCensusRow | null {
  const want = sessionId.toLowerCase();
  return (
    rows.find((r) => r.session_id.toLowerCase() === want) ??
    rows.find((r) => (r.aliases ?? []).some((a) => a.toLowerCase() === want)) ??
    null
  );
}

/**
 * "Live now / last acted", from the census read.
 *
 * **Never "not live" for anything but coord's own `dead` verdict.** A census
 * coord does not serve, a read that failed, a census with no row for this
 * session, and coord's own `unknown` are all UNKNOWN with their reason — an
 * ended session and an unobserved one look identical from here otherwise.
 */
export function deriveLiveStatus(
  half: HalfResult<SessionCensusResponse>,
  sessionId: string,
  opts: { now?: number } = {}
): LiveStatus {
  const unknown = (why: string, title?: string): LiveStatus => ({
    state: "unknown",
    text: `live status UNKNOWN — ${why}`,
    title: title ?? `live status UNKNOWN — ${why}`,
  });

  if (half.state === "loading") {
    return { state: "loading", text: "reading the session census…" };
  }
  if (half.state === "unknown") {
    return unknown(`census read failed (${half.detail})`);
  }
  if (half.state === "absent") {
    // The proxy turns coord's 404 into the not-served envelope, so a raw 404
    // reaching here is the same fact by another route.
    return unknown("census not served");
  }

  const census = half.value;
  if (!census.served) {
    return unknown(
      "census not served",
      `The deployed coord does not serve GET /coord/sessions/census (${census.unknown_reason}${census.detail ? `: ${census.detail}` : ""}). Whether this session is running is unknown — not "not live".`
    );
  }
  if (!census.census_present) {
    return unknown("the census tables are unreadable on coord");
  }
  const row = censusRowFor(census.sessions, sessionId);
  if (!row) {
    return unknown(
      census.truncated
        ? "the census was truncated before this session"
        : "no census row covers this session",
      "coord's census carries no row for this session id. A device that has not posted a census, or one this session never ran on, leaves it uncovered — absence is unknown, not ended."
    );
  }

  const where = row.hostname ? ` on ${row.hostname}` : "";
  const observed = row.observed_at
    ? `census observed ${relativeTime(row.observed_at, { now: opts.now, absent: "at an unknown time" })}`
    : "census observation time unknown";
  if (row.liveness === "alive") {
    return {
      state: "live",
      text: `live now${where}`,
      title: `coord's census saw the process alive — ${observed}`,
    };
  }
  if (row.liveness === "dead") {
    const acted = row.last_acted_at
      ? `last acted ${relativeTime(row.last_acted_at, { now: opts.now, absent: "at an unknown time" })}`
      : "last action time unknown";
    return {
      state: "not-live",
      text: `not live — ${acted}`,
      title: `coord's census says the process is gone${row.liveness_reason ? ` (${row.liveness_reason})` : ""} — ${observed}`,
    };
  }
  return unknown(
    row.liveness_reason ?? "the census did not decide",
    `coord's census answered liveness "${row.liveness}"${row.liveness_reason ? ` (${row.liveness_reason})` : ""} — ${observed}`
  );
}
