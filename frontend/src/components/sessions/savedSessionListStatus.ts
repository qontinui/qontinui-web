/**
 * savedSessionListStatus — pure derivation for the "Saved tab lists" panel on
 * `/sessions`.
 *
 * Plan `2026-11-08-save-per-tab-runner-session-lists-on-sessions-page-kept-14-days`
 * Phase 3. Same shape as `sessionConsoleStatus.ts` beside it: every word the
 * panel shows is derived HERE, in a module with no JSX, so it is testable
 * without a DOM and no component derives a status inline (style guide R8).
 *
 * What it decides, by the plan's design decisions:
 *
 * - **D2 — tab names.** A tab is named by the label its runner registered. A
 *   tab with none reads `Tab <id8> (name not reported)` — never an invented
 *   "Page N" — and a label two tabs of one snapshot share reads
 *   `<label> (<id8>)`, so each heading names one tab.
 * - **D3 — finished, tri-state.** The `/sessions` work axis, reused: `✓
 *   finished` when the runner's finished marker OR coord's `session_status`
 *   (classified by `SESSION_FINISHED_WORDS`) says so, its hover naming which;
 *   nothing otherwise, because no source can assert "not finished"; and
 *   `unknown`, with its reason, only when the runner reported no marker AND
 *   coord's read for that session did not answer for it.
 * - **D4 — which runner.** A capture reaches the instance that owns the
 *   device's relay socket — the primary — so a device offers itself only
 *   while that socket is up, and its secondaries are listed but never
 *   selectable.
 * - **D8 — titles.** A title the runner withheld reads `title withheld`, never
 *   a blank.
 *
 * Absence is never zero (`silent-empty-is-unknown`): a field the runner sent
 * as `null` renders as "not reported" / "unknown", never as an empty string.
 */

import type { Runner, RunnerInstance } from "@qontinui/shared-types";
import type { Attention } from "@/components/console/attention";
import {
  UNKNOWN_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
import { absoluteTime } from "@/components/console/time";
import type {
  SavedSessionListCoordStatus,
  SavedSessionListDetail,
  SavedSessionListSummary,
  TerminalLayoutPage,
  TerminalLayoutSession,
} from "@/lib/api/savedSessionLists";
import {
  SESSION_FINISHED_WORDS,
  SESSION_WORK_CLASS,
} from "./sessionConsoleStatus";

/** How long a saved list is kept (`expires_at - captured_at`, D5). */
export const SAVED_SESSION_LIST_RETENTION_DAYS = 14;

/** The first 8 characters of an id: page ids are UUIDs (plus `default`). */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A string with something printable in it, or `null`. */
function present(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// ---------------------------------------------------------------------------
// D3 — the finished badge
// ---------------------------------------------------------------------------

/**
 * The finished badge's vocabulary: the `/sessions` work axis's one kind,
 * `finished`, plus the `unknown` a snapshot can hold and a live row cannot
 * (coord was asked once, at capture, and that read may have failed).
 */
export type SavedSessionFinishedKind = "finished" | "unknown";

/**
 * The audited kind → attention table (R3, style guide §4.2); TOTAL over
 * {@link SavedSessionFinishedKind}. `console/attention.test.ts` audits
 * {@link SAVED_SESSION_FINISHED_CLASS} against it.
 *
 * - `finished` → `none`: terminal on the work axis, nothing is blocked on it
 *   and nothing decays — the same row `SESSION_WORK_ATTENTION_BY_KIND` audits
 *   for the live console, because it is the same claim.
 * - `unknown` → `waiting`: R3's ignorance floor. Nothing will clear it (a
 *   snapshot is never re-read), but we do not know the session's state, and
 *   painting that calm would claim the one thing we cannot.
 */
export const SAVED_SESSION_FINISHED_ATTENTION_BY_KIND: Record<
  SavedSessionFinishedKind,
  Attention
> = {
  finished: "none",
  unknown: "waiting",
};

/**
 * Kind → badge classes. `finished` IS the live console's work-axis badge
 * class, so a saved list's finished session wears the same green as the row
 * above it on `/sessions`; `unknown` is the shared ignorance amber.
 */
export const SAVED_SESSION_FINISHED_CLASS: Record<
  SavedSessionFinishedKind,
  string
> = {
  finished: SESSION_WORK_CLASS.finished,
  unknown: UNKNOWN_AMBER,
};

/** No kind here is red, so no kind carries `✕`. */
export const SAVED_SESSION_FINISHED_AUTHOR_GLYPH_KINDS: ReadonlySet<SavedSessionFinishedKind> =
  new Set<SavedSessionFinishedKind>();

export const SAVED_SESSION_FINISHED_PALETTE: StatusPalette<SavedSessionFinishedKind> =
  {
    badgeClass: SAVED_SESSION_FINISHED_CLASS,
    authorGlyphKinds: SAVED_SESSION_FINISHED_AUTHOR_GLYPH_KINDS,
    // `✓`, exactly as the live console's work axis renders it.
    doneGlyphKinds: new Set<SavedSessionFinishedKind>(["finished"]),
  };

/** Who said a session was finished. */
export type FinishedSource = "runner marker" | "coord";

export interface SavedSessionFinished {
  /** The badge to render, or `null` for nothing (there is no "not finished"). */
  status: RowStatus<SavedSessionFinishedKind> | null;
  /** The sources that said finished; empty unless the badge is `finished`. */
  sources: readonly FinishedSource[];
}

/** coord's answer for a session, as the capture recorded it. */
function coordAnswer(
  session: TerminalLayoutSession,
  coordStatus: Readonly<Record<string, SavedSessionListCoordStatus>>
): SavedSessionListCoordStatus | undefined {
  const id = present(session.claudeSessionId);
  return id === null ? undefined : coordStatus[id];
}

/**
 * D3's finished verdict for one saved session.
 *
 * `finished` is the runner's own marker (`true` / `false` / `null`); coord's
 * answer is `coord_status[claudeSessionId]`. Only `read: "ok"` is an answer —
 * `unknown` (coord had no such session in the caller's project) and `failed`
 * (coord could not be read) never mean "not finished".
 */
export function deriveSavedSessionFinished(
  session: TerminalLayoutSession,
  coordStatus: Readonly<Record<string, SavedSessionListCoordStatus>>
): SavedSessionFinished {
  const marker = session.finished ?? null;
  const confirmed = present(session.claudeSessionId) !== null;
  const coord = coordAnswer(session, coordStatus);
  const coordSaysFinished =
    coord?.read === "ok" &&
    coord.value != null &&
    SESSION_FINISHED_WORDS.has(coord.value);

  const sources: FinishedSource[] = [];
  if (marker === true) sources.push("runner marker");
  if (coordSaysFinished) sources.push("coord");

  if (sources.length > 0) {
    const markedAt = present(session.finishedAt);
    const why = present(session.finishReason);
    const markerDetail =
      marker === true
        ? `${markedAt ? `, marked ${absoluteTime(markedAt)}` : ""}${
            why ? ` (${why})` : ""
          }`
        : "";
    const by =
      sources.length === 2
        ? "the runner's finished marker and coord's session status"
        : sources[0] === "runner marker"
          ? "the runner's finished marker"
          : "coord's session status at capture";
    return {
      status: {
        kind: "finished",
        label: "finished",
        reason: `finished per ${by}${markerDetail}`,
        attention: SAVED_SESSION_FINISHED_ATTENTION_BY_KIND.finished,
      },
      sources,
    };
  }

  // `unknown` only when the runner sent NO marker and coord did not answer
  // for this session. A terminal with no confirmed session has nothing to be
  // finished, so it gets nothing at all.
  if (marker === null && confirmed && coord?.read !== "ok") {
    const reason =
      coord?.read === "failed"
        ? "the runner reported no finished marker, and coord could not be read when this list was saved"
        : coord?.read === "unknown"
          ? "the runner reported no finished marker, and coord had no record of this session in your project"
          : "the runner reported no finished marker, and coord's answer for this session was not recorded";
    return {
      status: {
        kind: "unknown",
        label: "unknown",
        reason,
        attention: SAVED_SESSION_FINISHED_ATTENTION_BY_KIND.unknown,
      },
      sources: [],
    };
  }

  return { status: null, sources: [] };
}

// ---------------------------------------------------------------------------
// D2 — tab headings
// ---------------------------------------------------------------------------

export interface TabHeading {
  page: TerminalLayoutPage;
  /** What the heading reads. */
  text: string;
  /** Why it reads that way, for a `title`. */
  title: string;
}

/**
 * Each page with its heading, in the order given — the runner's own order,
 * which the panel never re-sorts.
 */
export function tabHeadings(
  pages: readonly TerminalLayoutPage[]
): TabHeading[] {
  const uses = new Map<string, number>();
  for (const page of pages) {
    const label = present(page.label);
    if (label !== null) uses.set(label, (uses.get(label) ?? 0) + 1);
  }
  return pages.map((page) => {
    const id8 = shortId(page.pageId);
    if (page.label == null) {
      return {
        page,
        text: `Tab ${id8} (name not reported)`,
        title:
          "The runner had not reported a name for this tab when the list was saved, so it is shown by its id.",
      };
    }
    const label = present(page.label);
    if (label === null) {
      return {
        page,
        text: `Tab ${id8} (empty name)`,
        title: "The runner reported this tab with an empty name.",
      };
    }
    const count = uses.get(label) ?? 0;
    if (count > 1) {
      return {
        page,
        text: `${label} (${id8})`,
        title: `${count} tabs in this list are named "${label}"; the id prefix tells them apart.`,
      };
    }
    return { page, text: label, title: `Tab "${label}"` };
  });
}

// ---------------------------------------------------------------------------
// One terminal of a saved tab
// ---------------------------------------------------------------------------

export interface SessionLine {
  key: string;
  /** A confirmed session runs in the terminal (it has a `claudeSessionId`). */
  confirmed: boolean;
  name: { text: string; known: boolean; title: string };
  account: { text: string; known: boolean; title: string };
  title: { text: string; withheld: boolean; known: boolean; tooltip: string };
  process: { text: "alive" | "exited"; tooltip: string };
  finished: SavedSessionFinished;
}

const NO_SESSION_TITLE =
  "No confirmed session runs in this terminal (a plain shell, or a session the runner had not confirmed), so it has no session name, account or finished state.";

/** How the panel shows one saved terminal. */
export function sessionLine(
  session: TerminalLayoutSession,
  coordStatus: Readonly<Record<string, SavedSessionListCoordStatus>>
): SessionLine {
  const confirmed = present(session.claudeSessionId) !== null;
  const sessionName = present(session.sessionName);
  const spawnName = present(session.spawnName);
  const account = present(session.accountLabel);
  const title = present(session.title);

  const name = !confirmed
    ? {
        text: spawnName ?? `Terminal ${shortId(session.terminalId)}`,
        known: false,
        title: NO_SESSION_TITLE,
      }
    : sessionName !== null
      ? { text: sessionName, known: true, title: `Session "${sessionName}"` }
      : {
          text: "name not reported",
          known: false,
          title: "The runner reported no name for this session.",
        };

  return {
    key: session.terminalId,
    confirmed,
    name,
    account: !confirmed
      ? { text: "–", known: false, title: NO_SESSION_TITLE }
      : account !== null
        ? { text: account, known: true, title: `Claude account: ${account}` }
        : {
            text: "account unknown",
            known: false,
            title:
              "The runner did not know which Claude account this session runs under.",
          },
    title: session.titleWithheld
      ? {
          text: "title withheld",
          withheld: true,
          known: false,
          tooltip:
            "The runner withheld this terminal's title: the session's project keeps terminal content on its machine (its Terminal streaming setting is off).",
        }
      : title !== null
        ? { text: title, withheld: false, known: true, tooltip: title }
        : {
            text: "–",
            withheld: false,
            known: false,
            tooltip: "The terminal had no title.",
          },
    process: session.isAlive
      ? { text: "alive", tooltip: "The terminal's process was running." }
      : { text: "exited", tooltip: "The terminal's process had exited." },
    finished: deriveSavedSessionFinished(session, coordStatus),
  };
}

/** How many saved sessions' finished state is unknown. */
export function unknownFinishedCount(detail: SavedSessionListDetail): number {
  let n = 0;
  for (const page of detail.layout.pages) {
    for (const session of page.sessions) {
      const verdict = deriveSavedSessionFinished(session, detail.coord_status);
      if (verdict.status?.kind === "unknown") n += 1;
    }
  }
  return n;
}

// ---------------------------------------------------------------------------
// D5 — the deletion countdown
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface Countdown {
  text: string;
  /** The absolute deletion time, for a `title`. */
  title: string;
  expired: boolean;
}

/**
 * "deletes in N days" for a list expiring at `expiresAt`.
 *
 * Days are ROUNDED, so a list saved a moment ago reads "14 days" rather than
 * "13"; under two days it counts hours, under one hour minutes. The absolute
 * time is always in `title`.
 */
export function deletionCountdown(expiresAt: string, now: number): Countdown {
  const at = Date.parse(expiresAt);
  if (Number.isNaN(at)) {
    return {
      text: "deletion time unknown",
      title: "The backend sent a deletion time this page could not read.",
      expired: false,
    };
  }
  const left = at - now;
  if (left <= 0) {
    return {
      text: "expired",
      title: `Expired ${absoluteTime(expiresAt)}; it is no longer retrievable.`,
      expired: true,
    };
  }
  const title = `Deleted automatically ${absoluteTime(expiresAt)}`;
  if (left < HOUR_MS) {
    const minutes = Math.max(1, Math.ceil(left / MINUTE_MS));
    return {
      text: `deletes in ${plural(minutes, "minute")}`,
      title,
      expired: false,
    };
  }
  if (left < 2 * DAY_MS) {
    const hours = Math.floor(left / HOUR_MS);
    return {
      text: `deletes in ${plural(hours, "hour")}`,
      title,
      expired: false,
    };
  }
  const days = Math.round(left / DAY_MS);
  return { text: `deletes in ${plural(days, "day")}`, title, expired: false };
}

// ---------------------------------------------------------------------------
// The list row
// ---------------------------------------------------------------------------

/** "by Josh" — or, when the saver has no name on record, says so. */
export function byWhom(name: string | null | undefined): string {
  const who = present(name);
  return who !== null ? `by ${who}` : "by a user with no name on record";
}

/** Who saved a list, for the row: "saved by Josh". */
export function creatorText(name: string | null | undefined): string {
  return `saved ${byWhom(name)}`;
}

/** The row's inline reason: counts and creator. */
export function listReason(list: SavedSessionListSummary): string {
  return [
    plural(list.tab_count, "tab"),
    plural(list.session_count, "session"),
    creatorText(list.created_by_name),
  ].join(" · ");
}

/** A detail's own summary, for the list after a capture answered with it. */
export function summaryOf(
  detail: SavedSessionListDetail
): SavedSessionListSummary {
  return {
    id: detail.id,
    device_id: detail.device_id,
    runner_instance: detail.runner_instance,
    runner_port: detail.runner_port,
    runner_build_id: detail.runner_build_id,
    title: detail.title,
    created_by_user_id: detail.created_by_user_id,
    created_by_name: detail.created_by_name,
    captured_at: detail.captured_at,
    expires_at: detail.expires_at,
    tab_count: detail.tab_count,
    session_count: detail.session_count,
  };
}

/** The runner as the capture recorded it: instance and port, as reported. */
export function runnerProvenance(
  list: Pick<SavedSessionListSummary, "runner_instance" | "runner_port">
): string {
  const instance = present(list.runner_instance);
  const parts = [
    instance !== null ? `instance ${instance}` : "instance not reported",
    list.runner_port != null ? `port ${list.runner_port}` : "port not reported",
  ];
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// D4 — the runner picker
// ---------------------------------------------------------------------------

export interface RunnerPickerSecondary {
  key: string;
  port: number | null;
}

export interface RunnerPickerRow {
  deviceId: string;
  host: string;
  /** The instance a capture reaches, e.g. `primary :9876`; `null` when off. */
  instanceText: string | null;
  selectable: boolean;
  /** Why the device cannot be chosen, in the relay's own words. */
  disabledReason: string | null;
  /** The row's `title`: what choosing it does, or why it cannot be chosen. */
  title: string;
  /** Instances on the device the relay cannot reach — listed, never chosen. */
  secondaries: RunnerPickerSecondary[];
}

/** The text a secondary instance is listed with (D4). */
export const SECONDARY_NOT_ADDRESSABLE = "not addressable over the relay";

function hostOf(runner: Runner): string {
  return (
    present(runner.hostname) ??
    present(runner.name) ??
    `device ${shortId(runner.id)}`
  );
}

function portText(instance: RunnerInstance): string {
  return instance.port != null ? ` :${instance.port}` : "";
}

/**
 * One picker row per device. A device is selectable exactly while its runner
 * holds the relay socket (`wsConnected`) — the socket a capture travels and
 * that only a primary ever holds — so its answering instance is that primary.
 * Selectable devices come first, then by host name.
 */
export function runnerPickerRows(
  runners: readonly Runner[]
): RunnerPickerRow[] {
  const rows = runners.map((runner): RunnerPickerRow => {
    const host = hostOf(runner);
    const instances = Array.isArray(runner.instances) ? runner.instances : [];
    const primary = instances.find((i) => i.instanceRole === "primary");
    const secondaries = instances
      .filter((i) => i.instanceRole === "secondary")
      .map((i) => ({
        key: `${i.instanceKey}@${i.port ?? "?"}`,
        port: i.port ?? null,
      }));
    if (!runner.wsConnected) {
      return {
        deviceId: runner.id,
        host,
        instanceText: null,
        selectable: false,
        disabledReason: `runner not connected to the relay (${runner.derivedStatus})`,
        title:
          'The relay would refuse a save with "runner not connected": this device\'s runner has no open relay connection. Start the runner there with its Web Integration (cloud relay) setting on.',
        secondaries,
      };
    }
    return {
      deviceId: runner.id,
      host,
      instanceText: primary
        ? `primary${portText(primary)}`
        : "relay-connected runner",
      selectable: true,
      disabledReason: null,
      title: primary
        ? `Saves the tab list of ${host}'s primary runner${portText(primary)}, the instance that holds its relay connection.`
        : `Saves the tab list of the runner holding ${host}'s relay connection; the backend did not report which instance that is.`,
      secondaries,
    };
  });
  return rows.sort(
    (a, b) =>
      Number(b.selectable) - Number(a.selectable) ||
      a.host.localeCompare(b.host)
  );
}

// ---------------------------------------------------------------------------
// D7 — the capture refusal the plan words itself
// ---------------------------------------------------------------------------

/** The plan's own words for the one capture refusal it names (D7). */
export const RUNNER_PREDATES_SAVED_TAB_LISTS =
  "This runner's build predates saved tab lists — rebuild it to enable saving.";

const SAVE_REFUSAL_LEADS: ReadonlyMap<string, string> = new Map([
  ["runner_predates_terminal_layout", RUNNER_PREDATES_SAVED_TAB_LISTS],
]);

/**
 * The lead sentence a capture refusal is shown with, by its discriminator, or
 * `null`. The refusal itself always renders through `BackendErrorMessage`;
 * this only puts the plan's wording in front of the one it names.
 */
export function saveRefusalLead(discriminator: string | null): string | null {
  return discriminator === null
    ? null
    : (SAVE_REFUSAL_LEADS.get(discriminator) ?? null);
}

// ---------------------------------------------------------------------------
// Naming a runner
// ---------------------------------------------------------------------------

/** device id → the host name each paired runner reports. */
export function runnerHostNames(
  runners: readonly Runner[]
): ReadonlyMap<string, string> {
  return new Map(runners.map((r) => [r.id, hostOf(r)]));
}

export interface RunnerFilterOption {
  deviceId: string;
  label: string;
  count: number;
}

/**
 * The runner filter's options: one per device the lists were saved from, in
 * first-seen order (the lists arrive newest first), each with its count. Two
 * devices that share a name are told apart by their id prefix.
 */
export function runnerFilterOptions(
  lists: readonly SavedSessionListSummary[],
  nameFor: (deviceId: string) => string
): RunnerFilterOption[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    counts.set(list.device_id, (counts.get(list.device_id) ?? 0) + 1);
  }
  const named = [...counts.entries()].map(([deviceId, count]) => ({
    deviceId,
    name: nameFor(deviceId),
    count,
  }));
  const uses = new Map<string, number>();
  for (const { name } of named) uses.set(name, (uses.get(name) ?? 0) + 1);
  return named.map(({ deviceId, name, count }) => ({
    deviceId,
    label: (uses.get(name) ?? 0) > 1 ? `${name} (${shortId(deviceId)})` : name,
    count,
  }));
}

// ---------------------------------------------------------------------------
// Copy as Markdown
// ---------------------------------------------------------------------------

/** One line of plain Markdown text: control characters out, syntax escaped. */
function md(text: string): string {
  return text
    .replace(/\p{Cc}+/gu, " ")
    .replace(/([\\`*_[\]<>|#])/g, "\\$1")
    .trim();
}

function finishedMarkdown(finished: SavedSessionFinished): string | null {
  if (finished.status === null) return null;
  if (finished.status.kind === "finished") {
    return `✓ finished (${finished.sources.join(" and ")})`;
  }
  return `finished: unknown (${finished.status.reason})`;
}

/**
 * The whole saved list as Markdown: a header naming the runner, the save time
 * and the deletion time, then one section per tab in the runner's order and
 * one bullet per terminal, in the same words the panel shows.
 */
export function savedListMarkdown(
  detail: SavedSessionListDetail,
  runnerName: string
): string {
  const lines: string[] = [
    `# Saved tab list: ${md(present(detail.title) ?? "untitled")}`,
    "",
    `- Runner: ${md(runnerName)} (${runnerProvenance(detail)})`,
    `- Saved: ${detail.captured_at} ${md(byWhom(detail.created_by_name))}`,
    `- Deleted automatically: ${detail.expires_at}`,
    `- ${plural(detail.layout.pages.length, "tab")}, ${plural(
      detail.layout.pages.reduce((n, p) => n + p.sessions.length, 0),
      "terminal"
    )}`,
  ];
  if (!detail.layout.labelsRegistered) {
    lines.push(
      "- The runner had not reported its tab names, so tabs are shown by id."
    );
  }
  for (const { page, text } of tabHeadings(detail.layout.pages)) {
    lines.push("", `## ${md(text)}`, "");
    if (page.sessions.length === 0) {
      lines.push("- (no terminals)");
      continue;
    }
    for (const session of page.sessions) {
      const line = sessionLine(session, detail.coord_status);
      const parts = [
        line.confirmed
          ? line.name.known
            ? `**${md(line.name.text)}**`
            : md(line.name.text)
          : `${md(line.name.text)} (no confirmed session)`,
      ];
      if (line.confirmed) parts.push(`account: ${md(line.account.text)}`);
      const finished = finishedMarkdown(line.finished);
      if (finished !== null) parts.push(md(finished));
      parts.push(line.process.text);
      if (line.title.withheld) parts.push("title withheld");
      else if (line.title.known) parts.push(`title: ${md(line.title.text)}`);
      lines.push(`- ${parts.join(" · ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
