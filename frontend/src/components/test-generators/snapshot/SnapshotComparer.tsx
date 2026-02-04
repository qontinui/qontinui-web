/**
 * SnapshotComparer
 *
 * Diff view comparing current snapshot vs previous snapshot.
 * Shows added, removed, and changed elements.
 */

import { Plus, Minus, RefreshCw, ArrowLeft } from "lucide-react";

export interface SnapshotDiff {
  added: Array<{ id: string; label: string; type: string }>;
  removed: Array<{ id: string; label: string; type: string }>;
  changed: Array<{
    id: string;
    label: string;
    type: string;
    changes: string[];
  }>;
  unchanged: number;
}

interface SnapshotComparerProps {
  diff: SnapshotDiff | null;
  previousDate?: string;
  currentDate?: string;
  onBack: () => void;
}

export function SnapshotComparer({ diff, previousDate, currentDate, onBack }: SnapshotComparerProps) {
  if (!diff) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
        No previous snapshot available for comparison.
      </div>
    );
  }

  const totalChanges = diff.added.length + diff.removed.length + diff.changed.length;

  return (
    <div className="h-full overflow-auto">
      {/* Header */}
      <div className="px-4 py-3 border-b border-neutral-700 bg-neutral-800/50">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h3 className="text-sm font-medium text-neutral-200">Snapshot Comparison</h3>
        </div>
        <div className="flex items-center gap-4 mt-2 text-xs text-neutral-400">
          {previousDate && <span>Previous: {new Date(previousDate).toLocaleString()}</span>}
          {currentDate && <span>Current: {new Date(currentDate).toLocaleString()}</span>}
          <span className={totalChanges > 0 ? "text-yellow-400" : "text-emerald-400"}>
            {totalChanges > 0
              ? `${totalChanges} change${totalChanges > 1 ? "s" : ""} detected`
              : "No changes"}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-4 gap-2">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 rounded text-center">
            <p className="text-lg font-bold text-emerald-400">{diff.added.length}</p>
            <p className="text-[10px] text-emerald-400/70">Added</p>
          </div>
          <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-center">
            <p className="text-lg font-bold text-red-400">{diff.removed.length}</p>
            <p className="text-[10px] text-red-400/70">Removed</p>
          </div>
          <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded text-center">
            <p className="text-lg font-bold text-yellow-400">{diff.changed.length}</p>
            <p className="text-[10px] text-yellow-400/70">Changed</p>
          </div>
          <div className="p-2 bg-neutral-800 border border-neutral-700 rounded text-center">
            <p className="text-lg font-bold text-neutral-300">{diff.unchanged}</p>
            <p className="text-[10px] text-neutral-500">Unchanged</p>
          </div>
        </div>

        {/* Added elements */}
        {diff.added.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 text-xs font-medium text-emerald-400 mb-2">
              <Plus className="w-3 h-3" /> Added Elements
            </h4>
            <div className="space-y-1">
              {diff.added.map((el) => (
                <div key={el.id} className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/5 border border-emerald-500/10 rounded">
                  <Plus className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  <span className="text-xs text-neutral-200">{el.label}</span>
                  <span className="text-xs text-neutral-500">({el.type})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Removed elements */}
        {diff.removed.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 text-xs font-medium text-red-400 mb-2">
              <Minus className="w-3 h-3" /> Removed Elements
            </h4>
            <div className="space-y-1">
              {diff.removed.map((el) => (
                <div key={el.id} className="flex items-center gap-2 px-3 py-1.5 bg-red-500/5 border border-red-500/10 rounded">
                  <Minus className="w-3 h-3 text-red-400 flex-shrink-0" />
                  <span className="text-xs text-neutral-200 line-through">{el.label}</span>
                  <span className="text-xs text-neutral-500">({el.type})</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Changed elements */}
        {diff.changed.length > 0 && (
          <div>
            <h4 className="flex items-center gap-2 text-xs font-medium text-yellow-400 mb-2">
              <RefreshCw className="w-3 h-3" /> Changed Elements
            </h4>
            <div className="space-y-1">
              {diff.changed.map((el) => (
                <div key={el.id} className="px-3 py-2 bg-yellow-500/5 border border-yellow-500/10 rounded">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3 h-3 text-yellow-400 flex-shrink-0" />
                    <span className="text-xs text-neutral-200">{el.label}</span>
                    <span className="text-xs text-neutral-500">({el.type})</span>
                  </div>
                  <div className="mt-1 pl-5 space-y-0.5">
                    {el.changes.map((change, i) => (
                      <p key={i} className="text-[10px] text-yellow-400/70">{change}</p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {totalChanges === 0 && (
          <div className="text-center py-8 text-neutral-500 text-sm">
            No differences found between snapshots.
          </div>
        )}
      </div>
    </div>
  );
}
