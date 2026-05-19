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
 * Sort: updated_at DESC (client-side once loaded).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Filter, RefreshCw } from "lucide-react";
import {
  MemoryCard,
  type CoordMemoryRow,
} from "@/components/admin/coord/MemoryCard";
import { ApiConfig } from "@/services/api-config";

const API = `${ApiConfig.API_BASE_URL}/api/v1/operations`;
const POLL_INTERVAL_MS = 15_000;

interface MemoryListResponse {
  entries?: CoordMemoryRow[];
  memories?: CoordMemoryRow[];
  count?: number;
}

function uniqueTypes(rows: CoordMemoryRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.type) set.add(r.type);
  }
  return Array.from(set).sort();
}

export default function CoordMemoryListPage() {
  const [data, setData] = useState<MemoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [namePrefix, setNamePrefix] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/memory/list`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: MemoryListResponse = await res.json();
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
    return data.entries ?? data.memories ?? [];
  }, [data]);

  const availableTypes = useMemo(() => uniqueTypes(allRows), [allRows]);

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

  return (
    <div className="p-6 space-y-4" data-testid="coord-memory-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4" />
            Memory
            {data && (
              <Badge variant="outline" className="ml-2">
                {filtered.length}
                {filtered.length !== allRows.length
                  ? ` of ${allRows.length}`
                  : ""}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>

          {availableTypes.length > 0 && (
            <div
              className="flex flex-wrap items-center gap-1"
              data-testid="coord-memory-type-filter"
            >
              <span className="text-xs text-muted-foreground mr-1">
                types:
              </span>
              {availableTypes.map((t) => {
                const active = selectedTypes.has(t);
                return (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={active ? "default" : "outline"}
                    onClick={() => toggleType(t)}
                    data-testid={`coord-memory-type-${t}`}
                  >
                    {t}
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

          {loading && !data ? (
            <Skeleton className="h-24 w-full" />
          ) : filtered.length > 0 ? (
            <div className="space-y-2" data-testid="coord-memory-list">
              {filtered.map((m) => (
                <MemoryCard key={m.name} memory={m} />
              ))}
            </div>
          ) : (
            <p
              className="text-sm text-muted-foreground italic"
              data-testid="coord-memory-empty"
            >
              No memories match the current filters.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
