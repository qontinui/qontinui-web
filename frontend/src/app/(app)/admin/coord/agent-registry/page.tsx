"use client";

/**
 * /admin/coord/agent-registry — every agent type a spawn may be authorized
 * under, its tenant default, and the tenant-admin spawn switch.
 *
 * Phase 3 of plan
 * `2026-08-22-agent-registry-prefs-are-admin-only-and-the-tenant-default-has-no-ui`
 * (the tenant default) and Phase 7 of plan
 * `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type` (the
 * catalog and the switch).
 *
 * ## Two controls, two meanings
 *
 * - **Default for members** edits the registry row's `default_enabled`: what
 *   a member with no recorded preference gets. A member's own preference
 *   (`/settings/agents`) overrides it, which is why every row states how many
 *   members have one, right beside the toggle.
 * - **Spawns: On / Off** is the tenant CEILING (`admin_disabled`, plan D1).
 *   Off binds every member; no preference turns it back on.
 *
 * ## Agent types with no row
 *
 * The list is coord's CATALOG (`GET /coord/agent-registry/catalog`), not the
 * registry rows alone: declared roles in the tenant's repositories, harness
 * built-ins, coord's spawn kinds and classes, the runner's named spawns, and
 * names observed at spawn time. A type with no row reads "no registry row —
 * default: on"; switching its spawns off writes its row (plan D3 — nothing is
 * written on view). A catalog source coord could not read is an UNKNOWN
 * banner, never an empty list.
 *
 * ## Who may change what
 *
 * Any member may read this page. The raw rows (and so the override counts)
 * and both controls are administrator-only; a member sees the catalog
 * read-only, with the reason.
 *
 * ## Style
 *
 * Follows `frontend/docs/console-ui-style-guide.md`: R1 health strip derived
 * from data already on the page (never a second fetch), R2 one record per
 * line, R3/R4 attention colour on the left edge only, R5 detail expands in
 * place, R6 filter tabs with live counts, R8 labels derived in a pure module
 * (`_lib/agentCatalog.ts`), R9 no duplicated page chrome.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";
import {
  AgentPrefError,
  isWriteOutcomeUnknown,
  listAdminAgentRegistry,
  putAgentRegistryDefaults,
  type AdminAgentRegistryRow,
  type AgentAdminSwitchUpdate,
} from "@/lib/api/agent-registry";
import { outcomeUnknownReason } from "@/components/admin/coord/writeOutcome";
import { createReadSequence } from "@/components/console";
import { RepoFollowupDialsPanel } from "./_components/RepoFollowupDialsPanel";
import { AgentEntryLine } from "./_components/AgentEntryLine";
import { AddAgentByName } from "./_components/AddAgentByName";
import { CatalogUnknownBanners } from "./_components/CatalogUnknownBanners";
import { useAgentCatalog } from "./_hooks/useAgentCatalog";
import { useAdminSpawnSwitch } from "./_hooks/useAdminSpawnSwitch";
import { STATUS_TEXT } from "./_components/AdminSpawnSwitch";
import {
  matchesLineFilter,
  matchesLineQuery,
  mergeLines,
  normalizeAgentName,
  policyRequiredOf,
  spawnSwitchState,
  type AgentLine,
  type LineFilter,
} from "./_lib/agentCatalog";

/** The spawns page's per-spawn-type model & effort panel. */
const SPAWN_LAUNCH_SETTINGS_HREF = "/admin/coord/spawns#spawn-launch-settings";

// R3 — there is deliberately no red attention on this surface. Red means
// "someone must act now", and a registry row or a switched-off type is a
// standing configuration, never a failure. The reds on the page are a load
// failure and a refused write, which ARE failures.
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

const FILTERS: { id: LineFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "spawns-off", label: "Spawns off" },
  { id: "off", label: "Disabled by default" },
  { id: "contested", label: "Overridden" },
];

/** Why a member's controls are read-only. */
const MEMBER_READ_ONLY = "Only a tenant administrator can change this switch.";

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
      headline: "No registry rows for this tenant",
      detail:
        "Every agent type below is on by default; a row is written when an administrator switches one.",
      disabledByDefault,
      contested,
    };
  }
  if (contested > 0) {
    return {
      level: "amber",
      headline: `${contested} default${contested === 1 ? "" : "s"} members have overridden`,
      detail:
        "Changing those reaches only members with no recorded preference.",
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
            `0`. */}
        <Badge variant="outline" className="font-mono text-[11px]">
          registry rows {loaded ? rows.length : "–"}
        </Badge>
        <Badge variant="outline" className="font-mono text-[11px]">
          off by default {loaded ? health.disabledByDefault : "–"}
        </Badge>
        <Badge
          variant="outline"
          className={`font-mono text-[11px] ${
            loaded && health.contested > 0
              ? "text-amber-200 border-amber-500/35"
              : ""
          }`}
        >
          overridden {loaded ? health.contested : "–"}
        </Badge>
      </span>
    </div>
  );
}

export default function CoordAgentRegistryPage() {
  const [rows, setRows] = useState<AdminAgentRegistryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  // Whether an admin rows read has EVER answered. Until one has, a non-403
  // failure leaves the reader's role unknown — never "admin".
  const [rowsDelivered, setRowsDelivered] = useState(false);
  const [filter, setFilter] = useState<LineFilter>("all");
  const [query, setQuery] = useState("");
  // R5 — one row open at a time.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [savingAgents, setSavingAgents] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const catalogRead = useAgentCatalog();
  const refreshCatalog = catalogRead.refresh;
  const spawnSwitch = useAdminSpawnSwitch();

  // Reads can overtake each other (a slow re-read after one save, a fast one
  // after the next). Each is ticketed, so an older answer never paints over a
  // newer one, and an older failure says nothing about a newer value.
  const reads = useRef(createReadSequence());

  /**
   * Resolves with whether what is on screen is a read issued at or after this
   * one — the answer a save's re-read needs. `afterWrite` is a save's re-read:
   * its failure is reported by that save, beside the write's outcome, so a 403
   * on it does not switch the page to read-only for a reader who may not read
   * the page at all.
   */
  const refresh = useCallback(async (afterWrite = false): Promise<boolean> => {
    const seq = reads.current;
    const ticket = seq.issue();
    try {
      const next = await listAdminAgentRegistry();
      if (seq.settle(ticket, true)) {
        setRows(next);
        setRowsDelivered(true);
        // A NEWER read that failed still stands: an older answer may show its
        // rows, but must not clear that failure's banner or panel.
        if (!seq.isStale()) {
          setLoadError(null);
          setForbidden(false);
        }
      }
      return true;
    } catch (err) {
      seq.settle(ticket, false);
      // A newer read has delivered since this one was issued, so the screen
      // holds a read made after it: for the save waiting on this re-read,
      // that is the answer it needed, not a failed re-read.
      if (seq.hasDelivered() && !seq.isStale()) return true;
      // The web tier gates the raw rows, so a non-admin lands here with
      // `not_coord_tenant_admin`. The catalog is still theirs to read: the
      // page turns read-only and says why, rather than showing nothing.
      if (err instanceof AgentPrefError && err.status === 403) {
        if (!afterWrite) {
          setForbidden(true);
          setLoadError(null);
        }
      } else {
        setForbidden(false);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
      return false;
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
    // Keyed by the line's (normalized) name, which is what the line reads;
    // the PUT keeps the row's own spelling, which coord normalizes.
    const name = normalizeAgentName(row.agent_name);
    setSavingAgents((prev) => new Set(prev).add(name));
    setSaveErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    try {
      await reportSave(name, row.agent_name, update);
    } finally {
      setSavingAgents((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  };

  /** One save: the PUT's own outcome, then the re-read after it. */
  const reportSave = async (
    name: string,
    rowName: string,
    update: { default_enabled: boolean; policy_required?: boolean }
  ) => {
    const setSaveError = (text: string) =>
      setSaveErrors((prev) => ({ ...prev, [name]: text }));
    try {
      await putAgentRegistryDefaults(rowName, update);
    } catch (err) {
      if (isWriteOutcomeUnknown(err)) {
        // The change may have landed, so "failed" beside the old value would be
        // a claim nobody can make: only a re-read can say.
        const unknown = `Whether this change was applied is unknown (${outcomeUnknownReason(err)}).`;
        setSaveError(`${unknown} Re-reading what coord serves.`);
        void refreshCatalog();
        setSaveError(
          (await refresh(true))
            ? `${unknown} What is shown is a read made after it.`
            : `${unknown} The re-read failed too, so what is shown may be out of date.`
        );
      } else {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    // Re-read rather than patching local state: what is shown is then what
    // the server recorded. The catalog carries the default too, so it is
    // re-read beside the rows. The write is saved whatever the re-read says.
    void refreshCatalog();
    if (!(await refresh(true))) {
      setSaveError(
        "Saved, but the re-read failed, so what is shown may be out of date."
      );
    }
  };

  /** The ceiling write, then a re-read of BOTH lists: the catalog carries the
   *  switch's state, the rows its who/when/why. Only the catalog read decides
   *  whether what is shown is after the write. */
  const flipSpawns = (name: string, update: AgentAdminSwitchUpdate) =>
    void spawnSwitch.flip(name, update, async () => {
      const [catalogOk] = await Promise.all([refreshCatalog(), refresh(true)]);
      return catalogOk;
    });

  // A member's rows are not theirs to read, so whatever an older read left in
  // `rows` is not shown once the page knows it is read-only.
  const lines = useMemo(
    () =>
      mergeLines(catalogRead.catalog?.agents ?? null, forbidden ? [] : rows),
    [catalogRead.catalog, rows, forbidden]
  );
  const knownNames = useMemo(
    () => new Set(lines.map((l) => l.agent_name)),
    [lines]
  );
  const readOnlyReason = forbidden
    ? MEMBER_READ_ONLY
    : !loaded
      ? "Checking whether you can change this…"
      : loadError !== null && !rowsDelivered
        ? "Whether you can change this is unknown: the registry rows did not load. Retry the read."
        : null;
  const listsLoaded = loaded && catalogRead.loaded;
  // A type whose policy_required neither the row nor the catalog states
  // cannot be switched off: whether it needs a disposition picked (plan D5)
  // is unknown. Switching back ON needs none.
  // Add-by-name trusts `knownNames` to say whether a typed name already has a
  // row; that holds only when the rows AND the catalog's row source were read.
  const addByNameReady =
    !loadError &&
    catalogRead.catalog !== null &&
    !catalogRead.catalog.sources_unread.some((u) => u.source === "row");
  const lineReadOnlyReason = (line: AgentLine): string | null => {
    if (readOnlyReason !== null) return readOnlyReason;
    if (spawnSwitchState(line) === "on" && policyRequiredOf(line) === null) {
      return "Neither this agent's registry row nor the catalog says whether it needs a disposition, so it cannot be switched off yet. Retry the read.";
    }
    return null;
  };

  const counts = useMemo(
    () =>
      FILTERS.reduce<Record<LineFilter, number>>(
        (acc, f) => {
          acc[f.id] = lines.filter((l) => matchesLineFilter(l, f.id)).length;
          return acc;
        },
        { all: 0, "spawns-off": 0, off: 0, contested: 0 }
      ),
    [lines]
  );
  // A count over a list that has not been read is `–` (R6): the switch count
  // needs the catalog with every ceiling read, the others the rows (or the
  // catalog, for a member).
  const unknownSwitches = lines.filter(
    (l) => spawnSwitchState(l) === "unknown"
  ).length;
  const countKnown = (id: LineFilter): boolean => {
    if (!listsLoaded) return false;
    if (id === "spawns-off")
      return catalogRead.catalog !== null && unknownSwitches === 0;
    if (!forbidden) return !loadError;
    // A member reads the catalog only: it carries no override counts, and its
    // default is `null` wherever the row source was unread.
    if (id === "contested") return false;
    if (id === "off")
      return (
        catalogRead.catalog !== null &&
        lines.every((l) => l.catalog?.default_enabled !== null)
      );
    return catalogRead.catalog !== null;
  };

  const visible = useMemo(
    () =>
      lines.filter(
        (l) => matchesLineFilter(l, filter) && matchesLineQuery(l, query)
      ),
    [lines, filter, query]
  );
  const spawnsOff = lines.filter((l) => spawnSwitchState(l) === "off").length;

  return (
    <div
      className="p-3 sm:p-6 space-y-4 overflow-x-auto"
      data-testid="coord-agent-registry-page"
    >
      {forbidden ? (
        <div
          className="rounded-lg border border-border bg-card/30 px-4 py-3 space-y-1"
          data-testid="coord-agent-registry-forbidden"
          role="status"
        >
          <p className="text-sm font-semibold">
            Spawn switches and tenant defaults are administrator-only
          </p>
          <p className="text-xs text-muted-foreground">
            You are seeing them read-only, so you can tell what is switched off
            for this tenant and why. Changing them needs the tenant
            administrator role. Your own agent preferences are at{" "}
            <code className="font-mono bg-muted px-1 rounded">
              /settings/agents
            </code>
            , which needs no special role.
          </p>
        </div>
      ) : (
        <HealthStrip rows={rows} loaded={loaded && !loadError} />
      )}

      {/* The model and effort a SPAWNED session launches at are set per spawn
          type, not per agent row (plan
          2026-11-15-operator-sets-spawn-model-and-effort-per-spawn-type). */}
      <p
        className="text-xs text-muted-foreground m-0"
        data-testid="coord-agent-registry-launch-settings-link"
      >
        The model and reasoning effort of spawned sessions are set per spawn
        type:{" "}
        <Link
          href={SPAWN_LAUNCH_SETTINGS_HREF}
          className="font-medium underline underline-offset-2 hover:no-underline"
        >
          Model &amp; effort by spawn type
        </Link>
        .
        {catalogRead.catalog && (
          <span data-testid="agent-registry-spawns-off-count">
            {" "}
            Agent types with spawns switched off:{" "}
            {unknownSwitches === 0
              ? `${spawnsOff}.`
              : `at least ${spawnsOff}; ${unknownSwitches} unknown.`}
          </span>
        )}
      </p>

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

      <CatalogUnknownBanners
        sourcesUnread={catalogRead.catalog?.sources_unread ?? []}
        declaredSkipped={catalogRead.catalog?.declared_skipped ?? []}
        loadError={catalogRead.loaded ? catalogRead.error : null}
        stale={catalogRead.catalog !== null}
        onRetry={() => void refreshCatalog()}
      />

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
              {countKnown(f.id) ? counts[f.id] : "–"}
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
          onClick={() => {
            void refresh();
            void refreshCatalog();
          }}
          data-testid="coord-agent-registry-refresh"
          aria-label="Refresh"
        >
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {!listsLoaded && (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {listsLoaded && !loadError && visible.length === 0 && (
        <p
          className="text-sm text-muted-foreground italic"
          data-testid="coord-agent-registry-empty"
        >
          {lines.length > 0
            ? "No agent matches this filter."
            : catalogRead.catalog
              ? "Coord's catalog lists no agent types for this tenant, and it has no registry rows. Add one by name below to switch its spawns off."
              : "The catalog could not be read and this tenant has no registry rows, so which agent types exist is unknown."}
        </p>
      )}

      <div className="space-y-1">
        {listsLoaded &&
          visible.map((line) => (
            <AgentEntryLine
              key={line.agent_name}
              line={line}
              isOpen={expanded === line.agent_name}
              onToggleOpen={() =>
                setExpanded(
                  expanded === line.agent_name ? null : line.agent_name
                )
              }
              readOnlyReason={lineReadOnlyReason(line)}
              saving={savingAgents.has(line.agent_name)}
              saveError={saveErrors[line.agent_name]}
              onSaveDefault={(row, update) => void save(row, update)}
              switchStatus={spawnSwitch.statuses[line.agent_name]}
              onFlip={(update) => flipSpawns(line.agent_name, update)}
            />
          ))}
      </div>

      {listsLoaded && readOnlyReason === null && !addByNameReady && (
        <p
          className="px-3 text-xs text-muted-foreground"
          data-testid="agent-registry-add-by-name-held"
        >
          Adding an agent type by name waits until both the registry rows and
          the catalog have been read: a name already on a row may need a
          disposition picked.
        </p>
      )}
      {listsLoaded && readOnlyReason === null && addByNameReady && (
        <AddAgentByName
          knownNames={knownNames}
          onSwitchOff={(name, reason) => {
            setFilter("all");
            setQuery(name);
            flipSpawns(
              name,
              reason ? { disabled: true, reason } : { disabled: true }
            );
          }}
          onShowExisting={(name) => {
            setFilter("all");
            setQuery(name);
          }}
        />
      )}
      {/* A switch written for a name that is not on screen yet still says how
          it went: its line appears only once the re-read lists it. */}
      {Object.entries(spawnSwitch.statuses)
        .filter(([name]) => !knownNames.has(name))
        .map(([name, status]) => (
          <p
            key={name}
            className={`px-3 text-xs ${STATUS_TEXT[status.phase]}`}
            data-testid={`agent-spawn-switch-status-${name}`}
            data-phase={status.phase}
            role="status"
          >
            <span className="font-mono">{name}</span>: {status.message}
          </p>
        ))}

      {/* Per-repo follow-up dials (plan
          2026-09-01-post-merge-followup-spawn-is-repo-and-content-blind
          Phase 4b) — the other half of "which sessions get spawned": the
          rows above decide which agents run, this decides which merges spawn
          a follow-up at all. Collapsible and last, so it never displaces the
          registry (R7). */}
      <RepoFollowupDialsPanel />
    </div>
  );
}
