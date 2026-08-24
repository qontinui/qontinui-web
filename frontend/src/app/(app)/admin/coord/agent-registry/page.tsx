"use client";

/**
 * /admin/coord/agent-registry — the TENANT DEFAULT for each agent.
 *
 * Phase 3 of plan
 * `2026-08-22-agent-registry-prefs-are-admin-only-and-the-tenant-default-has-no-ui`.
 *
 * ## What this page decides, and what it does not
 *
 * `/settings/agents` is where a member records their OWN preference. This page
 * edits the row underneath it: `default_enabled` (what a member with no
 * recorded preference gets) and `policy_required` (whether disabling forces a
 * disposition choice). A change here therefore reaches exactly the members who
 * have NOT expressed a preference — which is why every row states how many
 * have, right beside the switch. A default most of the tenant has already
 * overridden is a different decision from one nobody has touched, and the page
 * would be misleading without that number.
 *
 * ## Why it exists
 *
 * The seed writes `default_enabled: false` for `code-reviewer` — deliberately,
 * because a policy-required agent spawns *by policy* on the user's own AI
 * account. Until this page the only ways to change that were re-running a
 * seeder that explicitly refuses to, or hand-rolling a `PUT` with an admin
 * bearer. This makes a tenant-wide consent decision reachable without `curl`.
 * It does not MAKE that decision — the seeded default is untouched.
 *
 * ## Style
 *
 * Follows `frontend/docs/console-ui-style-guide.md`: R1 health strip derived
 * from data already on the page (never a second fetch), R2 one record per
 * line, R3/R4 attention colour on the left edge only, R5 detail expands in
 * place, R6 filter tabs with live counts, R9 no duplicated page chrome. The
 * `console/` primitives that guide describes are not on `main` yet (they land
 * with the migration PRs), so the classes here are the same ones
 * `components/operations/MergePipeline.tsx` — the guide's ✅ exemplar — uses,
 * not a third invented set.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import {
  AgentPrefError,
  listAdminAgentRegistry,
  putAgentRegistryDefaults,
  type AdminAgentRegistryRow,
} from "@/lib/api/agent-registry";

// R3 — the colour families, named once and taken verbatim from the guide's
// exemplar (`components/operations/MergePipeline.tsx`) so a second surface
// cannot pick its own amber.
//
// There is deliberately no red on this surface. Red means "someone must act
// now", and a registry row is a standing configuration, never a failure —
// painting one red is exactly the "trained the eye to ignore red" mistake §4
// of the style guide exists to prevent. The one red on the page is the
// load-failure banner, which IS an outage.
const WAITING_AMBER = "bg-amber-500/15 text-amber-200 border-amber-500/30";
const READY_GREEN = "bg-green-500/15 text-green-200 border-green-500/30";
const INERT = "bg-muted text-muted-foreground border-border";

const LIGHT_CLASS = {
  green: "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]",
  amber: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
  red: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]",
} as const;

const HEADLINE_CLASS = {
  green: "text-foreground",
  amber: "text-amber-200",
  red: "text-red-200",
} as const;

type Filter = "all" | "off" | "contested";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "off", label: "Disabled by default" },
  { id: "contested", label: "Overridden" },
];

/**
 * Attention model, R3: who has to do something.
 *
 * A default members already contradict is amber — a decision waiting to be
 * revisited, and one whose edit will reach fewer people than it looks like it
 * will. Everything else is inert.
 */
function rowAttention(row: AdminAgentRegistryRow): "waiting" | "none" {
  return row.pref_differs_from_default_count > 0 ? "waiting" : "none";
}

function rowAccentClass(row: AdminAgentRegistryRow): string {
  return rowAttention(row) === "waiting"
    ? "border-l-2 border-l-amber-500/80"
    : "";
}

function matchesFilter(row: AdminAgentRegistryRow, filter: Filter): boolean {
  if (filter === "off") return !row.default_enabled;
  if (filter === "contested") return row.pref_differs_from_default_count > 0;
  return true;
}

function matchesQuery(row: AdminAgentRegistryRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    row.agent_name.toLowerCase().includes(q) ||
    row.purpose.toLowerCase().includes(q)
  );
}

interface Health {
  level: "green" | "amber" | "red";
  headline: string;
  detail: string | null;
  disabledByDefault: number;
  contested: number;
}

/** R1 — derived from rows the page already has; never a second fetch. */
function deriveHealth(rows: AdminAgentRegistryRow[]): Health {
  const disabledByDefault = rows.filter((r) => !r.default_enabled).length;
  const contested = rows.filter(
    (r) => r.pref_differs_from_default_count > 0
  ).length;
  if (rows.length === 0) {
    return {
      level: "green",
      headline: "No agents registered for this tenant",
      detail: "Seeding creates rows from the fleet's agent definitions.",
      disabledByDefault,
      contested,
    };
  }
  if (contested > 0) {
    return {
      level: "amber",
      headline: `${contested} default${contested === 1 ? "" : "s"} members have overridden`,
      detail: "Changing those reaches only members with no recorded preference.",
      disabledByDefault,
      contested,
    };
  }
  return {
    level: "green",
    headline: "Every tenant default stands unchallenged",
    detail: "No member has recorded a preference that contradicts one.",
    disabledByDefault,
    contested,
  };
}

function HealthStrip({
  rows,
  loaded,
}: {
  rows: AdminAgentRegistryRow[];
  loaded: boolean;
}) {
  const health = useMemo(() => deriveHealth(rows), [rows]);
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border bg-card/30 px-4 py-2.5 flex-wrap ${
        health.level === "amber" ? "border-amber-500/35" : "border-border"
      }`}
      data-testid="agent-registry-health"
      data-health-level={health.level}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${LIGHT_CLASS[health.level]}`}
        aria-hidden
      />
      <span
        className={`text-[13px] font-semibold ${HEADLINE_CLASS[health.level]}`}
      >
        {loaded ? health.headline : "Loading…"}
      </span>
      {loaded && health.detail && (
        <span className="text-xs text-muted-foreground">{health.detail}</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        {/* R6's rule, applied to the strip: an unfetched count is `–`, never
            `0`. "No agents are disabled by default" is a claim; "we have not
            loaded the registry" is not the same statement. */}
        <Badge variant="outline" className="font-mono text-[11px]">
          agents {loaded ? rows.length : "–"}
        </Badge>
        <Badge variant="outline" className="font-mono text-[11px]">
          off by default {loaded ? health.disabledByDefault : "–"}
        </Badge>
        <Badge
          variant="outline"
          className={`font-mono text-[11px] ${
            loaded && health.contested > 0 ? "text-amber-200 border-amber-500/35" : ""
          }`}
        >
          overridden {loaded ? health.contested : "–"}
        </Badge>
      </span>
    </div>
  );
}

/** R8 — the vocabulary the screen sees, derived in one place. */
function defaultLabel(row: AdminAgentRegistryRow): {
  label: string;
  className: string;
} {
  return row.default_enabled
    ? { label: "On by default", className: READY_GREEN }
    : { label: "Off by default", className: INERT };
}

function overrideLabel(row: AdminAgentRegistryRow): {
  label: string;
  className: string;
  title: string;
} {
  if (row.pref_count === 0) {
    return {
      label: "no overrides",
      className: INERT,
      title: "No member has recorded a preference for this agent.",
    };
  }
  const differs = row.pref_differs_from_default_count;
  return {
    label: `${row.pref_count} override${row.pref_count === 1 ? "" : "s"}`,
    className: differs > 0 ? WAITING_AMBER : INERT,
    title:
      `${row.pref_count} member${row.pref_count === 1 ? " has" : "s have"} a ` +
      `recorded preference for this agent, so a change to the default does ` +
      `not reach ${row.pref_count === 1 ? "that member" : "them"}. ` +
      (differs > 0
        ? `${differs} currently contradict${differs === 1 ? "s" : ""} it.`
        : `None of them contradicts it.`),
  };
}

export default function CoordAgentRegistryPage() {
  const [rows, setRows] = useState<AdminAgentRegistryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  // R5 — one row open at a time.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingAgents, setSavingAgents] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      setRows(await listAdminAgentRegistry());
      setLoadError(null);
      setForbidden(false);
    } catch (err) {
      // The web tier gates both proxies, so a non-admin lands here with
      // `not_coord_tenant_admin` rather than an opaque coord body. Say what
      // the page is instead of showing an empty registry, which would read as
      // "this tenant has no agents".
      if (err instanceof AgentPrefError && err.status === 403) {
        setForbidden(true);
        setLoadError(null);
      } else {
        setForbidden(false);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async (
    row: AdminAgentRegistryRow,
    update: { default_enabled: boolean; policy_required?: boolean }
  ) => {
    const name = row.agent_name;
    setSavingAgents((prev) => new Set(prev).add(name));
    setSaveErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    try {
      await putAgentRegistryDefaults(name, update);
      // Re-read rather than patching local state: what is shown is then what
      // the server recorded, including anything coord normalised on the way
      // in. The same UX-honesty rule /settings/agents follows.
      await refresh();
    } catch (err) {
      setSaveErrors((prev) => ({
        ...prev,
        [name]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setSavingAgents((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  const counts = useMemo(
    () =>
      FILTERS.reduce<Record<Filter, number>>(
        (acc, f) => {
          acc[f.id] = rows.filter((r) => matchesFilter(r, f.id)).length;
          return acc;
        },
        { all: 0, off: 0, contested: 0 }
      ),
    [rows]
  );

  const visible = useMemo(
    () =>
      rows
        .filter((r) => matchesFilter(r, filter) && matchesQuery(r, query))
        .sort((a, b) => a.agent_name.localeCompare(b.agent_name)),
    [rows, filter, query]
  );

  if (forbidden) {
    return (
      <div
        className="p-3 sm:p-6 space-y-4"
        data-testid="coord-agent-registry-forbidden"
      >
        <div className="rounded-lg border border-border bg-card/30 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold">
            Tenant defaults are administrator-only
          </p>
          <p className="text-xs text-muted-foreground">
            This page edits what every member of the tenant gets when they have
            recorded no preference of their own, so it is gated on the tenant
            administrator role. Your own agent preferences are at{" "}
            <code className="font-mono bg-muted px-1 rounded">
              /settings/agents
            </code>
            , which needs no special role.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-agent-registry-page"
    >
      <HealthStrip rows={rows} loaded={loaded && !loadError} />

      {loaded && loadError && (
        <div
          className="rounded-lg border border-red-500/40 bg-card/30 px-4 py-3 space-y-2"
          data-testid="coord-agent-registry-error"
        >
          <p className="text-sm text-red-200">
            Failed to load the agent registry: {loadError}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}

      {/* R6 — filter tabs with live counts, right-aligned filter input. */}
      <div className="flex items-center gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            variant={filter === f.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setFilter(f.id)}
            data-testid={`agent-registry-filter-${f.id}`}
            data-active={filter === f.id}
          >
            {f.label}{" "}
            <span className="font-mono text-[11px] text-muted-foreground">
              {loaded && !loadError ? counts[f.id] : "–"}
            </span>
          </Button>
        ))}
        <Input
          className="ml-auto w-56"
          placeholder="Filter agents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter agents"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          data-testid="coord-agent-registry-refresh"
          aria-label="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {!loaded && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {loaded && !loadError && visible.length === 0 && (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-agent-registry-empty"
        >
          {rows.length === 0
            ? "No agents are registered for this tenant yet. Rows are created by seeding from the fleet's agent definitions; this page edits rows that exist."
            : "No agent matches this filter."}
        </p>
      )}

      <div className="space-y-1">
        {visible.map((row) => {
          const saving = savingAgents.has(row.agent_name);
          const isOpen = expanded === row.agent_name;
          const def = defaultLabel(row);
          const ovr = overrideLabel(row);
          const saveError = saveErrors[row.agent_name];
          return (
            <div key={row.agent_name}>
              {/* R2 — one record, one line. R4 — accent on the edge only. */}
              <div
                className={`flex items-center gap-2 px-3 py-2 text-sm rounded-md border bg-card/30 ${rowAccentClass(
                  row
                )} ${isOpen ? "rounded-b-none" : ""}`}
                data-testid={`agent-registry-row-${row.agent_name}`}
                data-attention={rowAttention(row)}
              >
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setExpanded(isOpen ? null : row.agent_name)}
                  aria-label={`${isOpen ? "Collapse" : "Expand"} ${row.agent_name}`}
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>
                <span
                  className="font-mono text-[11px] text-muted-foreground shrink-0 truncate max-w-[10rem]"
                  title={row.spawn_path}
                >
                  {row.spawn_path}
                </span>
                <span
                  className="font-medium flex-1 truncate"
                  title={row.purpose || row.agent_name}
                >
                  {row.agent_name}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[11px] font-semibold whitespace-nowrap ${def.className}`}
                  data-default-enabled={row.default_enabled}
                >
                  {def.label}
                </Badge>
                {row.policy_required && (
                  <Badge
                    variant="outline"
                    className={`text-[11px] whitespace-nowrap hidden sm:inline-flex ${WAITING_AMBER}`}
                    title="Disabling this agent forces the member to choose a disposition."
                  >
                    policy required
                  </Badge>
                )}
                <Badge
                  variant="outline"
                  className={`text-[11px] whitespace-nowrap ${ovr.className}`}
                  title={ovr.title}
                  data-testid={`agent-registry-overrides-${row.agent_name}`}
                >
                  {ovr.label}
                </Badge>
                <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none text-xs">
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={row.default_enabled}
                    disabled={saving}
                    onChange={() =>
                      void save(row, { default_enabled: !row.default_enabled })
                    }
                    aria-label={`Default-enable ${row.agent_name}`}
                  />
                </label>
              </div>

              {/* R5 — detail expands in place, sharing the row's border. */}
              {isOpen && (
                <div
                  className="rounded-md rounded-t-none border border-t-0 bg-card/20 px-3 py-2 space-y-2"
                  data-testid={`agent-registry-detail-${row.agent_name}`}
                >
                  <p className="text-xs text-muted-foreground">
                    {row.purpose || "No purpose recorded for this agent."}
                  </p>
                  <p className="text-xs">
                    {row.pref_count === 0
                      ? "Every member of this tenant sees the default above — nobody has recorded a preference."
                      : `${row.pref_count} member${
                          row.pref_count === 1 ? "" : "s"
                        } already recorded a preference, so changing the default does not reach ${
                          row.pref_count === 1 ? "that member" : "them"
                        }. ${row.pref_differs_from_default_count} of ${
                          row.pref_count
                        } currently contradict the default.`}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={saving}
                      onClick={() =>
                        void save(row, {
                          default_enabled: row.default_enabled,
                          policy_required: !row.policy_required,
                        })
                      }
                      data-testid={`agent-registry-toggle-policy-${row.agent_name}`}
                    >
                      {row.policy_required
                        ? "Stop requiring a disposition"
                        : "Require a disposition to disable"}
                    </Button>
                    {row.trigger_condition && (
                      <span className="text-xs text-muted-foreground">
                        Triggers: {row.trigger_condition}
                      </span>
                    )}
                  </div>
                  {saveError && (
                    <p
                      className="text-xs text-red-200"
                      data-testid={`agent-registry-save-error-${row.agent_name}`}
                    >
                      {saveError}
                    </p>
                  )}
                  {/* R5 — raw ids last, and only here. */}
                  <p className="font-mono text-[10px] text-muted-foreground/60">
                    {row.agent_name} · spawn_path={row.spawn_path} · model=
                    {row.model ?? "—"} · effort={row.effort ?? "—"} ·
                    fanout_bound={row.fanout_bound ?? "—"} · allowed=
                    {row.allowed_dispositions.join(",") || "—"}
                  </p>
                </div>
              )}

              {/* A save that failed while the row is COLLAPSED still has to be
                  visible: the switch snapped back to the server's value, and
                  without this the only evidence of the refusal would be
                  inside a panel the reader has no reason to open. */}
              {saveError && !isOpen && (
                <p
                  className="px-3 py-1 text-xs text-red-200"
                  data-testid={`agent-registry-save-error-${row.agent_name}`}
                >
                  {saveError}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
