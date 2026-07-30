"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type {
  ComplianceVerdict,
  ListComplianceSessionsResponse,
  ListConfigVersionsResponse,
  ListOutstandingResponse,
  OutstandingItem,
  SessionComplianceConfig,
  SessionComplianceConfigUpdate,
  SessionComplianceConfigVersion,
  SessionComplianceRow,
} from "../compliance-types";

const API = "/api/v1/operations/coord/session-compliance";

/** Default page size for the recent-sessions list. */
const SESSIONS_PAGE = 25;

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

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
 */
function isRouteUnavailable(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err);
  return / failed: (404|405|501) /.test(text);
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
 */
export function useSessionCompliance() {
  const [config, setConfig] =
    useState<Loaded<SessionComplianceConfig>>(EMPTY);
  const [versions, setVersions] =
    useState<Loaded<SessionComplianceConfigVersion[]>>(EMPTY);
  const [sessions, setSessions] =
    useState<Loaded<SessionComplianceRow[]>>(EMPTY);
  const [outstanding, setOutstanding] =
    useState<Loaded<OutstandingItem[]>>(EMPTY);

  const [saving, setSaving] = useState(false);
  const [verdictFilter, setVerdictFilter] = useState<ComplianceVerdict | "all">(
    "all"
  );
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  /* ---- config ---------------------------------------------------------- */

  const loadConfig = useCallback(async () => {
    setConfig((s) => ({ ...s, loading: true }));
    try {
      const data = await httpClient.get<SessionComplianceConfig>(
        `${API}/config`
      );
      setConfig({
        data,
        loading: false,
        unavailable: false,
        degraded: data.degraded ?? null,
        error: null,
      });
    } catch (err) {
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
  }, []);

  const loadVersions = useCallback(async () => {
    setVersions((s) => ({ ...s, loading: true }));
    try {
      const data = await httpClient.get<ListConfigVersionsResponse>(
        `${API}/config/versions`
      );
      setVersions({
        data: data.versions ?? [],
        loading: false,
        unavailable: false,
        degraded: data.degraded ?? null,
        error: null,
      });
    } catch (err) {
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
  }, []);

  /**
   * Save the enforcement settings. Coord versions the row, so a change is
   * auditable and reversible rather than a silent overwrite. `applicable` is
   * never sent — it is derived from the clause, not configured.
   */
  const saveConfig = useCallback(
    async (patch: SessionComplianceConfigUpdate): Promise<boolean> => {
      setSaving(true);
      try {
        const updated = await httpClient.put<SessionComplianceConfig>(
          `${API}/config`,
          patch
        );
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
    [loadVersions]
  );

  /* ---- sessions -------------------------------------------------------- */

  const loadSessions = useCallback(async () => {
    setSessions((s) => ({ ...s, loading: true }));
    const qs = new URLSearchParams({ limit: String(SESSIONS_PAGE) });
    if (verdictFilter !== "all") qs.set("verdict", verdictFilter);
    if (cursor) qs.set("cursor", cursor);
    try {
      const data = await httpClient.get<ListComplianceSessionsResponse>(
        `${API}/sessions?${qs.toString()}`
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
  }, [verdictFilter, cursor]);

  /* ---- outstanding ledger ---------------------------------------------- */

  const loadOutstanding = useCallback(async () => {
    setOutstanding((s) => ({ ...s, loading: true }));
    try {
      const data = await httpClient.get<ListOutstandingResponse>(
        `${API}/outstanding`
      );
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
  }, []);

  useEffect(() => {
    loadConfig();
    loadVersions();
    loadOutstanding();
  }, [loadConfig, loadVersions, loadOutstanding]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  /** Reset paging whenever the verdict filter changes. */
  const changeVerdictFilter = useCallback(
    (next: ComplianceVerdict | "all") => {
      setVerdictFilter(next);
      setCursor(null);
    },
    []
  );

  const reloadAll = useCallback(() => {
    loadConfig();
    loadVersions();
    loadSessions();
    loadOutstanding();
  }, [loadConfig, loadVersions, loadSessions, loadOutstanding]);

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
  };
}
