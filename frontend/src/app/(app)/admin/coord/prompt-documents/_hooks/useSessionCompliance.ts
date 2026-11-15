"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  fetchSessionComplianceConfig,
  listSessionComplianceConfigVersions,
  listSessionComplianceOutstanding,
  listSessionComplianceSessions,
  saveSessionComplianceConfig,
} from "@/lib/api/operations/coordPromptDocuments";
import { httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  useFirstPinnedRead,
  useSendTimePin,
} from "../../_shared/useSendTimePin";
import { usePageSendGuard } from "./usePageWriteGuardContext";
import type {
  ComplianceVerdict,
  OutstandingItem,
  SessionComplianceConfig,
  SessionComplianceConfigUpdate,
  SessionComplianceConfigVersion,
  SessionComplianceRow,
} from "../compliance-types";

/** Default page size for the recent-sessions list. */
const SESSIONS_PAGE = 25;

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * Statuses that mean "this build does not deploy the route", as opposed to
 * "the route ran and failed". A 405 or a 501 is a router that knows the path
 * and not the verb, or knows neither; a 404 here is the same family, because
 * these four endpoints ship together with coord's half of the plan.
 */
const ROUTE_UNAVAILABLE_STATUSES = new Set([404, 405, 501]);

/**
 * True when coord answered "not found" rather than failing.
 *
 * `httpClient` throws a plain `Error` whose message embeds the upstream status
 * (`GET <url> failed: 404 - …`), and the web proxy mirrors coord's status
 * rather than collapsing it. What a 404 MEANS is genuinely ambiguous from here:
 * before coord's half of this plan ships it means "route not deployed", and
 * afterwards it could mean "nothing stored for this tenant" or "bad cursor".
 * The UI therefore reports the fact (coord said not-found) and names both
 * readings, rather than picking one and stating it as diagnosis.
 *
 * What matters either way is that it is NOT an empty result: rendering an empty
 * table would claim "no sessions have been checked", which we do not know.
 *
 * ## Why this reads the status FIELD (#1110 follow-up)
 *
 * This used to be `/ failed: (404|405|501) /.test(message)`, and the tail of
 * that message is `await response.text()` — the raw upstream BODY, which the
 * operations proxy fills with coord's own `resp.text`. So the probe scanned
 * upstream-controlled prose, and a 500 whose body merely quoted a 404 (an
 * echoed inner error, an HTML error page) was classified as route-unavailable.
 *
 * That direction of failure is worse here than anywhere else this class has
 * been found, because of what the caller does next: every `catch` below sets
 * `error: isRouteUnavailable(err) ? null : message(...)`. A misread is not a
 * wrong label on a visible error — it DELETES the error. The operator gets the
 * calm "coord doesn't serve this yet" notice and is never told there was a 500
 * at all, which is the same all-clear-over-a-failed-read defect #1110 removed
 * from `/admin/coord/questions`, arriving through the status probe instead of
 * through the empty slot.
 *
 * `httpStatusOf` is anchored to the verb and reads the status field once, so
 * the body is out of the decision. A message with no status at all yields
 * `null`, which is NOT in the set — an unreachable coord stays loud.
 */
function isRouteUnavailable(err: unknown): boolean {
  const status = httpStatusOf(err);
  return status !== null && ROUTE_UNAVAILABLE_STATUSES.has(status);
}

/** Shared per-request outcome: a value, or a typed reason we have none. */
interface Loaded<T> {
  data: T | null;
  loading: boolean;
  /** Coord doesn't serve this route yet. */
  unavailable: boolean;
  /** Coord answered but its compliance store isn't provisioned. */
  degraded: string | null;
  /** Coord unreachable or refusing — we know nothing. */
  error: string | null;
}

const EMPTY: Loaded<never> = {
  data: null,
  loading: true,
  unavailable: false,
  degraded: null,
  error: null,
};

/** Before the page knows its project: nothing is read, so nothing is loading. */
const IDLE: Loaded<never> = { ...EMPTY, loading: false };

/**
 * Reads and mutates the tenant's session-compliance enforcement surface via the
 * coord-proxy (`/api/v1/operations/coord/session-compliance/*`).
 *
 * Reads are visible to any tenant member; the config PUT is tenant-admin-gated
 * (coord re-checks) and coord stamps the editor from its own authenticated
 * operator context — the browser never asserts who made the change.
 *
 * Three failure states are kept distinct rather than flattened into an empty
 * list, because they mean genuinely different things to an operator:
 * `unavailable` (coord doesn't serve this yet), `degraded` (coord answered, its
 * store isn't provisioned), `error` (coord unreachable/refusing). None of them
 * is "nothing to show".
 *
 * On the prompt-documents page every read and the save are sent in the page's
 * project, asked as each goes out and kept on every attempt, so a save
 * re-issued after another tab's switch cannot change that tab's enforcement,
 * and no read can show that project's verdicts as this one's. Nothing is read
 * before the page knows its project: the first read of all four goes out
 * then (`useFirstPinnedRead`), a Refresh, filter or page change with no
 * project sends nothing, and `waitingForProject` says the hook is waiting.
 * And the save is refused — nothing sent, the page says why — while that
 * switch is in effect, or while the page has no project to pin it to.
 * Both come from the page's provider (`usePageSendGuard`), and the refusal
 * sits beside the send, so no caller can leave it out. It is never mounted
 * outside that provider, and throws if it is: there is no unguarded mode.
 */
export function useSessionCompliance() {
  const { writeAllowed, resolvePin } = usePageSendGuard();
  // One identity whatever the provider hands over, so the first read runs once.
  const sendPin = useSendTimePin(resolvePin);
  // Loading from the first render only when a read goes out at mount.
  const [initial] = useState(() => (sendPin() === undefined ? IDLE : EMPTY));
  const [config, setConfig] =
    useState<Loaded<SessionComplianceConfig>>(initial);
  const [versions, setVersions] =
    useState<Loaded<SessionComplianceConfigVersion[]>>(initial);
  const [sessions, setSessions] =
    useState<Loaded<SessionComplianceRow[]>>(initial);
  const [outstanding, setOutstanding] =
    useState<Loaded<OutstandingItem[]>>(initial);

  const [saving, setSaving] = useState(false);
  const [verdictFilter, setVerdictFilter] = useState<ComplianceVerdict | "all">(
    "all"
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Bumped when a save LANDS. A settings or history read that began before it
  // may answer after the save's own result; applying it would show them as
  // they were before the save. Its answer is dropped, as the shared dial does
  // (`useTenantFleetPolicyDial`). A save does not change the verdicts or the
  // ledger, so their reads keep their answers.
  const writeGeneration = useRef(0);

  /* ---- config ---------------------------------------------------------- */

  const loadConfig = useCallback(async () => {
    const pin = sendPin();
    // No project to read in yet: nothing is sent, and what is shown stays.
    if (pin === undefined) return;
    const generation = writeGeneration.current;
    setConfig((s) => ({ ...s, loading: true }));
    try {
      const data = await fetchSessionComplianceConfig(pin);
      if (generation !== writeGeneration.current) return;
      setConfig({
        data,
        loading: false,
        unavailable: false,
        degraded: data.degraded ?? null,
        error: null,
      });
    } catch (err) {
      if (generation !== writeGeneration.current) return;
      setConfig({
        data: null,
        loading: false,
        unavailable: isRouteUnavailable(err),
        degraded: null,
        error: isRouteUnavailable(err)
          ? null
          : message(err, "Failed to load enforcement settings"),
      });
    }
  }, [sendPin]);

  const loadVersions = useCallback(async () => {
    const pin = sendPin();
    if (pin === undefined) return;
    const generation = writeGeneration.current;
    setVersions((s) => ({ ...s, loading: true }));
    try {
      const data = await listSessionComplianceConfigVersions(pin);
      if (generation !== writeGeneration.current) return;
      setVersions({
        data: data.versions ?? [],
        loading: false,
        unavailable: false,
        degraded: data.degraded ?? null,
        error: null,
      });
    } catch (err) {
      if (generation !== writeGeneration.current) return;
      setVersions({
        data: null,
        loading: false,
        unavailable: isRouteUnavailable(err),
        degraded: null,
        error: isRouteUnavailable(err)
          ? null
          : message(err, "Failed to load setting history"),
      });
    }
  }, [sendPin]);

  /**
   * Save the enforcement settings. Coord versions the row, so a change is
   * auditable and reversible rather than a silent overwrite. `applicable` is
   * never sent — it is derived from the clause, not configured.
   */
  const saveConfig = useCallback(
    async (patch: SessionComplianceConfigUpdate): Promise<boolean> => {
      if (!writeAllowed()) return false;
      setSaving(true);
      try {
        const updated = await saveSessionComplianceConfig(patch, sendPin());
        writeGeneration.current += 1;
        setConfig({
          data: updated,
          loading: false,
          unavailable: false,
          degraded: updated.degraded ?? null,
          error: null,
        });
        toast.success(`Saved as settings version ${updated.current_version}`);
        // Fire-and-forget refresh of the audit trail; it reports its own
        // failures into `versions.error`, so there is nothing to await here.
        void loadVersions();
        return true;
      } catch (err) {
        toast.error(message(err, "Failed to save enforcement settings"));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [loadVersions, sendPin, writeAllowed]
  );

  /* ---- sessions -------------------------------------------------------- */

  const loadSessions = useCallback(async () => {
    const pin = sendPin();
    if (pin === undefined) return;
    setSessions((s) => ({ ...s, loading: true }));
    try {
      const data = await listSessionComplianceSessions(
        {
          limit: SESSIONS_PAGE,
          verdict: verdictFilter !== "all" ? verdictFilter : undefined,
          cursor,
        },
        pin
      );
      setSessions({
        data: data.sessions ?? [],
        loading: false,
        unavailable: false,
        degraded: data.degraded ?? null,
        error: null,
      });
      setNextCursor(data.next_cursor ?? null);
    } catch (err) {
      setSessions({
        data: null,
        loading: false,
        unavailable: isRouteUnavailable(err),
        degraded: null,
        error: isRouteUnavailable(err)
          ? null
          : message(err, "Failed to load session verdicts"),
      });
      setNextCursor(null);
    }
  }, [verdictFilter, cursor, sendPin]);

  /* ---- outstanding ledger ---------------------------------------------- */

  const loadOutstanding = useCallback(async () => {
    const pin = sendPin();
    if (pin === undefined) return;
    setOutstanding((s) => ({ ...s, loading: true }));
    try {
      const data = await listSessionComplianceOutstanding(pin);
      setOutstanding({
        data: data.items ?? [],
        loading: false,
        unavailable: false,
        degraded: data.degraded ?? null,
        error: null,
      });
    } catch (err) {
      setOutstanding({
        data: null,
        loading: false,
        unavailable: isRouteUnavailable(err),
        degraded: null,
        error: isRouteUnavailable(err)
          ? null
          : message(err, "Failed to load the outstanding-work ledger"),
      });
    }
  }, [sendPin]);

  // The verdicts are re-read when their filter or page changes. Their first
  // read is the hook's first read (below), so a commit that changes neither
  // reads nothing here, StrictMode's second mount included.
  const sessionsReadWith = useRef(loadSessions);
  useEffect(() => {
    if (sessionsReadWith.current === loadSessions) return;
    sessionsReadWith.current = loadSessions;
    void loadSessions();
  }, [loadSessions]);

  /** Reset paging whenever the verdict filter changes. */
  const changeVerdictFilter = useCallback((next: ComplianceVerdict | "all") => {
    setVerdictFilter(next);
    setCursor(null);
  }, []);

  const reloadAll = useCallback(() => {
    loadConfig();
    loadVersions();
    loadSessions();
    loadOutstanding();
  }, [loadConfig, loadVersions, loadSessions, loadOutstanding]);

  const waitingForProject = useFirstPinnedRead(sendPin, reloadAll);

  /**
   * True when EVERY compliance route 404s — i.e. the whole feature isn't on
   * coord yet. Reported once at the top of the section rather than four times.
   */
  const featureUnavailable = useMemo(
    () =>
      config.unavailable &&
      versions.unavailable &&
      sessions.unavailable &&
      outstanding.unavailable,
    [
      config.unavailable,
      versions.unavailable,
      sessions.unavailable,
      outstanding.unavailable,
    ]
  );

  return {
    config,
    versions,
    sessions,
    outstanding,
    saving,
    verdictFilter,
    changeVerdictFilter,
    nextCursor,
    /** Page forward; `null` returns to the first page. */
    setCursor,
    atFirstPage: cursor === null,
    saveConfig,
    reloadAll,
    featureUnavailable,
    /** No project to read in yet: nothing has been read, or is shown as read. */
    waitingForProject,
  };
}
