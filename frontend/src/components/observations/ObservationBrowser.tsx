"use client";

import { useState, useMemo, useEffect } from "react";
import {
  useObservationTemporalSearch,
  useObservationSnapshot,
  useObservationStats,
  useObservationTrends,
  useObservationHistory,
  type ObservationSearchResult,
  type ObservationHistoryEntry,
} from "@/lib/runner/hooks/observation-hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Clock,
  TrendingUp,
  History,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Eye,
  EyeOff,
  ArrowRight,
} from "lucide-react";

// =============================================================================
// Sub-components
// =============================================================================

function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <label className="text-text-muted">From</label>
      <input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        className="bg-surface-raised border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
      />
      <label className="text-text-muted">To</label>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        className="bg-surface-raised border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
      />
    </div>
  );
}

function TemporalBadge({ obs }: { obs: ObservationSearchResult }) {
  if (obs.supersededBy) {
    return (
      <Badge variant="outline" className="text-xs opacity-60 line-through">
        superseded
      </Badge>
    );
  }
  if (obs.validUntil) {
    return (
      <Badge variant="outline" className="text-xs opacity-60">
        expired
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-green-400 border-green-400/30">
      current
    </Badge>
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    architecture: "text-blue-400 border-blue-400/30",
    decision: "text-purple-400 border-purple-400/30",
    bugfix: "text-red-400 border-red-400/30",
    pattern: "text-amber-400 border-amber-400/30",
    learning: "text-emerald-400 border-emerald-400/30",
    discovery: "text-cyan-400 border-cyan-400/30",
  };
  return (
    <Badge variant="outline" className={`text-xs ${colors[type] ?? "text-text-muted"}`}>
      {type}
    </Badge>
  );
}

function ObservationRow({
  obs,
  isSelected,
  onSelect,
}: {
  obs: ObservationSearchResult;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const validFrom = new Date(obs.validFrom).toLocaleDateString();
  const isSuperseded = obs.supersededBy != null;
  const isExpired = obs.validUntil != null;

  return (
    <div
      onClick={onSelect}
      className={`px-4 py-3 cursor-pointer border-b border-border-subtle/30 transition-colors hover:bg-surface-raised/50 ${
        isSelected ? "bg-surface-raised/80 border-l-2 border-l-blue-500" : ""
      } ${isSuperseded || isExpired ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-sm font-medium truncate ${isSuperseded ? "line-through" : ""}`}>
              {obs.title}
            </span>
            <TypeBadge type={obs.observationType} />
            <TemporalBadge obs={obs} />
          </div>
          <p className="text-xs text-text-muted line-clamp-2">{obs.contentPreview}</p>
        </div>
        <div className="text-xs text-text-muted whitespace-nowrap flex flex-col items-end gap-1">
          <span>Valid from {validFrom}</span>
          {obs.revisionCount > 1 && (
            <span className="text-amber-400/80">rev {obs.revisionCount}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryTimeline({ observationId }: { observationId: number }) {
  const { data: history, isLoading } = useObservationHistory(observationId);

  if (isLoading) {
    return (
      <div className="text-center py-4 text-text-muted text-xs">
        <RefreshCw className="size-3 animate-spin mx-auto mb-1" />
        Loading history...
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <p className="text-xs text-text-muted py-2">No revision history (original version).</p>
    );
  }

  return (
    <div className="space-y-2">
      {history.map((entry: ObservationHistoryEntry) => (
        <div
          key={entry.id}
          className="pl-4 border-l-2 border-border-subtle/50 text-xs space-y-1"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-secondary">
              Rev {entry.revisionNumber}
            </span>
            <span className="text-text-muted">
              {new Date(entry.validFrom).toLocaleDateString()} {" "}
              <ArrowRight className="inline size-3" />{" "}
              {new Date(entry.validUntil).toLocaleDateString()}
            </span>
          </div>
          <p className="text-text-muted">{entry.title}</p>
          <p className="text-text-muted/70 line-clamp-2">{entry.contentPreview}</p>
        </div>
      ))}
    </div>
  );
}

function TrendChart({ weeks }: { weeks: number }) {
  const { data: trends, isLoading } = useObservationTrends(weeks);

  if (isLoading || !trends || trends.length === 0) {
    return null;
  }

  // Group by week
  const weekMap = new Map<string, Record<string, number>>();
  for (const t of trends) {
    const week = new Date(t.weekStart).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    if (!weekMap.has(week)) weekMap.set(week, {});
    weekMap.get(week)![t.observationType] = t.count;
  }

  const maxCount = Math.max(...trends.map((t) => t.count), 1);

  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-text-muted mb-2">Weekly Trends</h4>
      {Array.from(weekMap.entries()).map(([week, types]) => (
        <div key={week} className="flex items-center gap-2 text-xs">
          <span className="w-16 text-text-muted text-right">{week}</span>
          <div className="flex-1 flex gap-0.5">
            {Object.entries(types).map(([type, count]) => (
              <div
                key={type}
                className="h-4 rounded-sm bg-blue-500/40"
                style={{ width: `${(count / maxCount) * 100}%`, minWidth: "4px" }}
                title={`${type}: ${count}`}
              />
            ))}
          </div>
          <span className="w-8 text-text-muted">
            {Object.values(types).reduce((a, b) => a + b, 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ObservationBrowser() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showSuperseded, setShowSuperseded] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showTrends, setShowTrends] = useState(false);
  const [asOfDate, setAsOfDate] = useState("");

  // Debounce search query to avoid flooding API on every keystroke
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Reset history expansion when selection changes
  const handleSelect = (id: number) => {
    if (id === selectedId) {
      setSelectedId(null);
    } else {
      setSelectedId(id);
      setShowHistory(false);
    }
  };

  // Build temporal search params
  const temporalFrom = dateFrom ? new Date(dateFrom).toISOString() : undefined;
  const temporalTo = dateTo ? new Date(dateTo).toISOString() : undefined;
  const asOfIso = asOfDate ? new Date(asOfDate).toISOString() : null;

  // Use snapshot mode when as-of is set, otherwise use temporal search
  const { data: searchResults, isLoading: searchLoading, error: searchError } = useObservationTemporalSearch({
    q: debouncedQuery || undefined,
    from: temporalFrom,
    to: temporalTo,
    maxResults: 100,
    enabled: !asOfDate,
  });

  const { data: snapshotResults, isLoading: snapshotLoading, error: snapshotError } = useObservationSnapshot(
    asOfIso,
    100
  );

  // Merge: snapshot mode overrides search
  const results = asOfDate
    ? snapshotResults?.map((obs) => ({
        ...obs,
        contentPreview: obs.content.slice(0, 300),
        rank: undefined as number | undefined,
      }))
    : searchResults;
  const isLoading = asOfDate ? snapshotLoading : searchLoading;
  const error = asOfDate ? snapshotError : searchError;

  const { data: stats } = useObservationStats();

  // Filter superseded if toggled off
  const filteredResults = useMemo(() => {
    if (!results) return [];
    if (showSuperseded) return results;
    return results.filter(
      (obs) => obs.supersededBy == null && obs.validUntil == null
    );
  }, [results, showSuperseded]);

  const selectedObs = filteredResults.find((o) => o.id === selectedId);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-border-subtle/50 bg-surface-raised/20">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2 size-4 text-text-muted" />
          <Input
            placeholder="Search observations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-8 text-sm bg-surface-raised border-border-subtle"
          />
        </div>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={(f, t) => {
            setDateFrom(f);
            setDateTo(t);
          }}
        />
        <div className="flex items-center gap-2 text-sm">
          <label className="text-text-muted text-xs">As of</label>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="bg-surface-raised border border-border-subtle rounded px-2 py-1 text-xs text-text-primary"
          />
          {asOfDate && (
            <button
              onClick={() => setAsOfDate("")}
              className="text-xs text-text-muted hover:text-text-primary"
              title="Clear snapshot"
            >
              &times;
            </button>
          )}
        </div>
        <button
          onClick={() => setShowSuperseded(!showSuperseded)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
          title={showSuperseded ? "Hide superseded" : "Show superseded"}
        >
          {showSuperseded ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          Superseded
        </button>
        <button
          onClick={() => setShowTrends(!showTrends)}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <TrendingUp className="size-3.5" />
          Trends
        </button>
      </div>

      {/* Stats bar */}
      {stats && stats.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border-subtle/30 text-xs text-text-muted">
          {stats.map((s) => (
            <span key={s.observationType} className="flex items-center gap-1">
              <TypeBadge type={s.observationType} />
              {s.count}
            </span>
          ))}
        </div>
      )}

      {/* Trends panel */}
      {showTrends && (
        <div className="px-4 py-3 border-b border-border-subtle/30 bg-surface-raised/10">
          <TrendChart weeks={8} />
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 flex min-h-0">
        {/* Results list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="text-center py-12 text-text-muted">
              <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
              Searching...
            </div>
          )}
          {error && (
            <div className="text-center py-12 text-red-400 text-sm">{error}</div>
          )}
          {!isLoading && !error && filteredResults.length === 0 && (
            <div className="text-center py-12 text-text-muted">
              <Clock className="size-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">
                {searchQuery || dateFrom || dateTo
                  ? "No observations match your filters."
                  : "No observations found. Create observations via the runner to see them here."}
              </p>
            </div>
          )}
          {filteredResults.map((obs) => (
            <ObservationRow
              key={obs.id}
              obs={obs}
              isSelected={obs.id === selectedId}
              onSelect={() => handleSelect(obs.id)}
            />
          ))}
        </div>

        {/* Detail panel */}
        {selectedObs && (
          <div className="w-[380px] border-l border-border-subtle/50 overflow-y-auto bg-surface-raised/10">
            <div className="p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-1">{selectedObs.title}</h3>
                <div className="flex items-center gap-2 mb-2">
                  <TypeBadge type={selectedObs.observationType} />
                  <TemporalBadge obs={selectedObs} />
                  <span className="text-xs text-text-muted">{selectedObs.scope}</span>
                </div>
                {selectedObs.topicKey && (
                  <p className="text-xs text-text-muted font-mono mb-2">
                    {selectedObs.topicKey}
                  </p>
                )}
                <p className="text-sm text-text-secondary whitespace-pre-wrap">
                  {selectedObs.contentPreview}
                </p>
              </div>

              {/* Temporal info */}
              <Card className="bg-surface-raised/30 border-border-subtle/50">
                <CardHeader className="py-2 px-3">
                  <CardTitle className="text-xs flex items-center gap-1.5">
                    <Clock className="size-3" />
                    Temporal Validity
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Valid from</span>
                    <span>{new Date(selectedObs.validFrom).toLocaleString()}</span>
                  </div>
                  {selectedObs.validUntil && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Valid until</span>
                      <span>{new Date(selectedObs.validUntil).toLocaleString()}</span>
                    </div>
                  )}
                  {selectedObs.supersededBy && (
                    <div className="flex justify-between">
                      <span className="text-text-muted">Superseded by</span>
                      <span className="text-blue-400">#{selectedObs.supersededBy}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-text-muted">Revisions</span>
                    <span>{selectedObs.revisionCount}</span>
                  </div>
                </CardContent>
              </Card>

              {/* Revision history */}
              {selectedObs.revisionCount > 1 && (
                <div>
                  <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-2"
                  >
                    {showHistory ? (
                      <ChevronDown className="size-3" />
                    ) : (
                      <ChevronRight className="size-3" />
                    )}
                    <History className="size-3" />
                    Revision History
                  </button>
                  {showHistory && <HistoryTimeline observationId={selectedObs.id} />}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
