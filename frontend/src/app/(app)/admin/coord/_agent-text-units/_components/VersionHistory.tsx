"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import type { AgentTextUnitVersion } from "@/lib/api/agent-text-units";
import { VersionDiff } from "./VersionDiff";
import { diffFileSets } from "../_lib/unitRows";
import { LAYER_LABEL, type WritableLayer } from "../types";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

interface VersionHistoryProps {
  unitName: string;
  layer: WritableLayer;
  versions: AgentTextUnitVersion[];
  loading: boolean;
  error: string | null;
  headVersion: number | null;
  reverting: boolean;
  readOnly: boolean;
  onRevert: (versionNumber: number) => void;
}

/**
 * The append-only version chain of ONE LAYER, plus a per-file diff.
 *
 * Two things this states rather than implies:
 *
 * * **History is layer-local.** The account override and the fleet default are
 *   different rows with different edits, so this chain never mixes them and
 *   never falls back from one to the other.
 * * **A version stores a file MAP.** The comparison therefore has three
 *   selectors, not two — left version, right version, and which file — with a
 *   summary line naming every path added, removed or changed between the two,
 *   so an operator can see a deleted sibling that a single-file diff would
 *   have hidden entirely.
 *
 * Revert is presented as what the backend actually does: it APPENDS a version
 * whose files equal the chosen one. Nothing is rewound and no history row is
 * removed.
 */
export function VersionHistory({
  unitName,
  layer,
  versions,
  loading,
  error,
  headVersion,
  reverting,
  readOnly,
  onRevert,
}: VersionHistoryProps) {
  const [leftVersion, setLeftVersion] = useState<number | null>(null);
  const [rightVersion, setRightVersion] = useState<number | null>(null);
  const [path, setPath] = useState<string | null>(null);

  // Default the comparison to "previous vs. head" whenever the chain changes.
  useEffect(() => {
    const head = versions[0];
    const previous = versions[1];
    if (head && previous) {
      setLeftVersion(previous.version_number);
      setRightVersion(head.version_number);
    } else {
      setLeftVersion(null);
      setRightVersion(null);
    }
  }, [versions]);

  const byNumber = useMemo(() => {
    const map = new Map<number, AgentTextUnitVersion>();
    for (const version of versions) map.set(version.version_number, version);
    return map;
  }, [versions]);

  const left = leftVersion !== null ? byNumber.get(leftVersion) : undefined;
  const right = rightVersion !== null ? byNumber.get(rightVersion) : undefined;

  const fileDiff = useMemo(
    () => diffFileSets(left?.files ?? {}, right?.files ?? {}),
    [left, right]
  );

  // Prefer a file that actually differs — landing the operator on an identical
  // file is the least useful default a per-file diff can pick.
  useEffect(() => {
    const preferred =
      fileDiff.changed[0] ??
      fileDiff.added[0] ??
      fileDiff.removed[0] ??
      fileDiff.all[0] ??
      null;
    setPath((current) =>
      current && fileDiff.all.includes(current) ? current : preferred
    );
  }, [fileDiff]);

  return (
    <div
      className="rounded-md border border-border bg-card/30"
      data-testid="unit-version-history"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <History className="size-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">Version history</span>
        <span className="text-xs text-muted-foreground">
          {LAYER_LABEL[layer].toLowerCase()} of {unitName}
        </span>
      </div>

      <div className="space-y-4 px-3 py-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading version history…
          </div>
        )}

        {!loading && error && <p className="form-error">{error}</p>}

        {!loading && !error && versions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No versions stored at this layer yet. The first save creates
            version 1.
          </p>
        )}

        {!loading && !error && versions.length > 0 && (
          <>
            {versions.length >= 2 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="form-group">
                    <label className="form-label" htmlFor="unit-diff-left">
                      Compare
                    </label>
                    <select
                      id="unit-diff-left"
                      className="input"
                      value={leftVersion ?? ""}
                      onChange={(e) => setLeftVersion(Number(e.target.value))}
                      data-testid="unit-diff-left"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.version_number}>
                          v{v.version_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="unit-diff-right">
                      With
                    </label>
                    <select
                      id="unit-diff-right"
                      className="input"
                      value={rightVersion ?? ""}
                      onChange={(e) => setRightVersion(Number(e.target.value))}
                      data-testid="unit-diff-right"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.version_number}>
                          v{v.version_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="unit-diff-file">
                      File
                    </label>
                    <select
                      id="unit-diff-file"
                      className="input font-mono text-xs"
                      value={path ?? ""}
                      onChange={(e) => setPath(e.target.value)}
                      data-testid="unit-diff-file"
                    >
                      {fileDiff.all.map((p) => (
                        <option key={p} value={p}>
                          {p}
                          {fileDiff.changed.includes(p)
                            ? " (changed)"
                            : fileDiff.added.includes(p)
                              ? " (added)"
                              : fileDiff.removed.includes(p)
                                ? " (removed)"
                                : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <p
                  className="text-xs text-muted-foreground"
                  data-testid="unit-diff-file-summary"
                >
                  {fileDiff.changed.length + fileDiff.added.length + fileDiff.removed.length ===
                  0
                    ? "Every file is identical between these two versions."
                    : [
                        fileDiff.added.length
                          ? `${fileDiff.added.length} added`
                          : null,
                        fileDiff.removed.length
                          ? `${fileDiff.removed.length} removed`
                          : null,
                        fileDiff.changed.length
                          ? `${fileDiff.changed.length} changed`
                          : null,
                        fileDiff.unchanged.length
                          ? `${fileDiff.unchanged.length} unchanged`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </p>

                {left && right && path && (
                  <VersionDiff
                    leftLabel={`v${left.version_number}`}
                    rightLabel={`v${right.version_number}`}
                    path={path}
                    leftText={path in left.files ? (left.files[path] ?? "") : null}
                    rightText={
                      path in right.files ? (right.files[path] ?? "") : null
                    }
                  />
                )}
              </div>
            ) : (
              <p className="text-xs italic text-muted-foreground">
                A diff needs two versions. Save an edit and this compares them.
              </p>
            )}

            <p className="text-xs italic text-muted-foreground">
              Comparisons here are between stored versions of this layer only.
              The comparison against what the runner ships is in the
              &quot;Published default&quot; panel below — and only when a
              runner has published its embedded copy to this account.
            </p>

            <ul className="space-y-2" data-testid="unit-version-list">
              {versions.map((version) => {
                const isHead = version.version_number === headVersion;
                const fileCount = Object.keys(version.files ?? {}).length;
                return (
                  <li
                    key={version.id}
                    className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2"
                    data-testid={`unit-version-${version.version_number}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                          v{version.version_number}
                        </span>
                        {isHead && (
                          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-200">
                            Current
                          </span>
                        )}
                        {version.restored_from !== null && (
                          <span
                            className="rounded-md border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-200"
                            title={`This version's files were copied from v${version.restored_from} by a revert.`}
                          >
                            Restored from v{version.restored_from}
                          </span>
                        )}
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {fileCount} file{fileCount === 1 ? "" : "s"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(version.created_at)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {version.change_description || "No change description."}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-sm shrink-0"
                      disabled={reverting || isHead || readOnly}
                      onClick={() => onRevert(version.version_number)}
                      title={
                        readOnly
                          ? "Writing a fleet default requires a superuser"
                          : isHead
                            ? "Already the current version"
                            : `Write v${version.version_number}'s files as a new version`
                      }
                      data-testid={`unit-revert-${version.version_number}`}
                    >
                      {reverting ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="size-3.5" />
                      )}
                      Revert to this
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
