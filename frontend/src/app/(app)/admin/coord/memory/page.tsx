"use client";

/**
 * /admin/coord/memory — memory browser (list view).
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 6 (Wave 3c).
 *
 * Reads `GET /api/v1/operations/memory/list` (proxies to coord's
 * canonical memory substrate per resolved decision Q8 — coord is the
 * source of truth; per-machine `.claude-*` is a 30-day backup).
 *
 * Filters:
 *  - type (multi-select)
 *  - name prefix (free-text)
 * Sort: written_at DESC (client-side once loaded).
 *
 * ## Console style (Phase 3 Wave 2)
 *
 * Migrated onto `components/console` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md`, against
 * `frontend/docs/console-ui-style-guide.md`:
 *
 * - **R9** — the page-level `<Card><CardHeader><CardTitle>Memory` wrapper is
 *   gone, and the body's `p-6` became `p-3 sm:p-6`. `coord/layout.tsx` already
 *   renders the console `<h1>` and the nav crumb.
 * - **R1** — a `<HealthStrip>` derived from the rows ALREADY FETCHED opens the
 *   page. No second request: every count comes off the same list the rows do.
 * - **R2/R5** — one memory is one `<MemoryRow>` line; detail expands in place
 *   (`<RecordList>` keeps one open at a time).
 * - **R6** — the type chips now carry live counts, and render `–` (not `0`)
 *   before the list has answered.
 *
 * **The type filter stays multi-select chips rather than `<FilterTabs>`.**
 * `<FilterTabs>` is single-select by construction (`active: Id`), and this
 * control is a set: an operator narrows to `reference` + `feedback` together.
 * Swapping it would be a functional REGRESSION dressed as conformance, so the
 * R6 property that actually matters here — a live count per option, and a dash
 * for one nobody has counted — was adopted onto the existing chips instead.
 * Same call, same reason, as `/plans` keeping its status `<Select>`.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Filter, RefreshCw } from "lucide-react";
import {
  HealthStrip,
  RecordList,
  type HealthBadge,
  type HealthStripLevel,
} from "@/components/console";
import { MemoryRow } from "@/components/admin/coord/MemoryRow";
import { deriveMemoryStatus } from "@/components/admin/coord/memoryStatus";
import type { CoordMemoryRow } from "@/components/admin/coord/memoryStatus";
import { httpClient } from "@/services/service-factory";

const API = "/api/v1/operations";
const POLL_INTERVAL_MS = 15_000;

interface MemoryListResponse {
  /** Canonical envelope key (matches `qontinui_types::memory::MemoryListResponse`). */
  items?: CoordMemoryRow[];
  /** Pre-Phase-6 legacy aliases — coord older than 2026-05-22 returned these. */
  entries?: CoordMemoryRow[];
  memories?: CoordMemoryRow[];
  count?: number;
  limit?: number;
}

/** Type → how many rows carry it, over the window actually fetched. */
function countByType(rows: CoordMemoryRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!r.type) continue;
    out.set(r.type, (out.get(r.type) ?? 0) + 1);
  }
  return out;
}

/**
 * The page's health, derived from the rows already on it (R1) — never a second
 * fetch.
 *
 * The one signal a memory list carries is whether this build understands what
 * it is showing: a row whose `type` is absent or unrecognised is one the
 * status column can only answer with "we do not know" (see `memoryStatus.ts`).
 * That is the amber, and it is amber on ignorance, not on a problem.
 */
function deriveMemoryHealth(
  rows: CoordMemoryRow[],
  loaded: boolean
): {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
} {
  if (!loaded) {
    return {
      level: "amber",
      headline: "Waiting for coord…",
      detail: "counts appear once the memory list arrives",
      // `<HealthStrip>` renders `label` VERBATIM, so the dash has to be a
      // literal here — a null label renders nothing, not `–`.
      badges: [
        { key: "total", label: <>memories –</>, tone: "muted" },
        { key: "unrecognised", label: <>unrecognised –</>, tone: "muted" },
      ],
    };
  }

  let unrecognised = 0;
  let untyped = 0;
  for (const r of rows) {
    const kind = deriveMemoryStatus(r).kind;
    // Two DIFFERENT statements, and the strip used to make the first about
    // both: "carries a kind this build has no meaning for" is false of a row
    // that carries no kind at all.
    if (kind === "unknown") unrecognised += 1;
    else if (kind === "untyped") untyped += 1;
  }
  const types = countByType(rows).size;

  return {
    // Only an UNRECOGNISED kind moves the light: it is the one thing here this
    // build cannot explain. A row with no type at all is a complete, ordinary
    // row (see `memoryStatus.ts`).
    level: unrecognised > 0 ? "amber" : "green",
    headline:
      rows.length === 0
        ? "coord holds no memories in this window"
        : unrecognised > 0
          ? `${unrecognised} of ${rows.length} carry a kind this build has no meaning for`
          : `${rows.length} memories, ${types} kind${types === 1 ? "" : "s"}`,
    detail:
      unrecognised > 0
        ? "shown verbatim rather than guessed at — extend the vocabulary in memoryStatus.ts"
        : `${untyped} carry no kind at all`,
    badges: [
      { key: "total", label: <>memories {rows.length}</>, tone: "muted" },
      { key: "kinds", label: <>kinds {types}</>, tone: "muted" },
      {
        key: "untyped",
        label: <>untyped {untyped}</>,
        tone: "muted",
        title: "coord recorded no type for these — kind is optional on a memory",
      },
      {
        key: "unrecognised",
        label: <>unrecognised {unrecognised}</>,
        tone: unrecognised > 0 ? "default" : "muted",
        title:
          "memory kind is an open vocabulary in coord; these values are not in this build's",
      },
    ],
  };
}

export default function CoordMemoryListPage() {
  const [data, setData] = useState<MemoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [namePrefix, setNamePrefix] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const body = await httpClient.get<MemoryListResponse>(
        `${API}/memory/list`
      );
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchData();
    const id = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  const allRows = useMemo<CoordMemoryRow[]>(() => {
    if (!data) return [];
    return data.items ?? data.entries ?? data.memories ?? [];
  }, [data]);

  const typeCounts = useMemo(() => countByType(allRows), [allRows]);
  const availableTypes = useMemo(
    () => Array.from(typeCounts.keys()).sort(),
    [typeCounts]
  );

  const filtered = useMemo(() => {
    const prefix = namePrefix.trim().toLowerCase();
    const types = selectedTypes;
    const out = allRows.filter((row) => {
      if (prefix && !row.name.toLowerCase().startsWith(prefix)) return false;
      if (types.size > 0) {
        if (!row.type || !types.has(row.type)) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      const at = a.written_at ?? "";
      const bt = b.written_at ?? "";
      if (at === bt) return a.name.localeCompare(b.name);
      return at < bt ? 1 : -1;
    });
    return out;
  }, [allRows, namePrefix, selectedTypes]);

  const toggleType = useCallback((t: string) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const loaded = data !== null;
  const health = useMemo(
    () => deriveMemoryHealth(allRows, loaded),
    [allRows, loaded]
  );

  return (
    <div className="p-3 sm:p-6 space-y-4" data-testid="coord-memory-page">
      <HealthStrip
        level={health.level}
        headline={health.headline}
        detail={health.detail}
        badges={health.badges}
        data-testid="coord-memory-health"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="filter by name prefix..."
          value={namePrefix}
          onChange={(e) => setNamePrefix(e.target.value)}
          className="w-[260px]"
          data-testid="coord-memory-name-prefix"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={fetchData}
          data-testid="coord-memory-refresh"
          aria-label="Refresh memory list"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </Button>
      </div>

      {availableTypes.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1"
          data-testid="coord-memory-type-filter"
        >
          <span className="text-xs text-muted-foreground mr-1">kinds:</span>
          {availableTypes.map((t) => {
            const active = selectedTypes.has(t);
            return (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={active ? "secondary" : "ghost"}
                onClick={() => toggleType(t)}
                data-testid={`coord-memory-type-${t}`}
              >
                {t}
                {/* R6 — a live count per option. `loaded` is guaranteed here
                    (the chip list is derived from rows), so the count is a
                    measurement, never an unasked-for zero. */}
                <span className="font-mono text-[11px] text-muted-foreground">
                  {typeCounts.get(t) ?? 0}
                </span>
              </Button>
            );
          })}
          {selectedTypes.size > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedTypes(new Set())}
              data-testid="coord-memory-clear-types"
            >
              clear
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-destructive">Failed to load: {error}</p>
      )}

      <div data-testid="coord-memory-list">
        <RecordList
          items={filtered}
          itemKey={(m) => m.name}
          loaded={!(loading && !data)}
          skeletonRows={6}
          renderRow={(m, ctx) => (
            <MemoryRow
              memory={m}
              expanded={ctx.expanded}
              onToggle={ctx.onToggle}
            />
          )}
          empty={
            // Gated on `error`: a failed fetch leaves the list empty, and
            // asserting "nothing matched" about a request that never answered
            // is the `silent-empty-is-unknown` mistake. The failure message
            // above is the honest rendering.
            error ? null : (
              <p
                className="text-sm text-muted-foreground italic"
                data-testid="coord-memory-empty"
              >
                No memories match the current filters.
              </p>
            )
          }
        />
      </div>
    </div>
  );
}
