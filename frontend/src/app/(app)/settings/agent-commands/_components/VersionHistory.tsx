"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Loader2, RotateCcw } from "lucide-react";
import type { AgentCommandVersion } from "@/lib/api/agent-commands";
import { VersionDiff } from "./VersionDiff";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

interface VersionHistoryProps {
  commandName: string;
  versions: AgentCommandVersion[];
  loading: boolean;
  error: string | null;
  headVersion: number | null;
  reverting: boolean;
  onRevert: (versionNumber: number) => void;
}

/**
 * The append-only version chain, plus a version-to-version diff.
 *
 * Revert is presented as what the backend actually does — it APPENDS a new
 * version whose body equals the chosen one. Nothing is rewound and no history
 * row is removed, so the copy says "written as a new version" rather than
 * "roll back".
 */
export function VersionHistory({
  commandName,
  versions,
  loading,
  error,
  headVersion,
  reverting,
  onRevert,
}: VersionHistoryProps) {
  const [leftVersion, setLeftVersion] = useState<number | null>(null);
  const [rightVersion, setRightVersion] = useState<number | null>(null);

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
    const map = new Map<number, AgentCommandVersion>();
    for (const version of versions) map.set(version.version_number, version);
    return map;
  }, [versions]);

  const left = leftVersion !== null ? byNumber.get(leftVersion) : undefined;
  const right = rightVersion !== null ? byNumber.get(rightVersion) : undefined;

  return (
    <div className="card" data-testid="agent-command-version-history">
      <div className="card-header flex items-center gap-2">
        <History className="size-4 text-muted-foreground" />
        <span className="font-medium">Version history</span>
        <span className="text-xs text-muted-foreground">
          for /{commandName}
        </span>
      </div>

      <div className="card-content space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading version history…
          </div>
        )}

        {!loading && error && <p className="form-error">{error}</p>}

        {!loading && !error && versions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No versions stored yet. The first save creates version 1.
          </p>
        )}

        {!loading && !error && versions.length > 0 && (
          <>
            {/* Diff picker */}
            {versions.length >= 2 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div className="form-group">
                    <label
                      className="form-label"
                      htmlFor="agent-command-diff-left"
                    >
                      Compare
                    </label>
                    <select
                      id="agent-command-diff-left"
                      className="input"
                      value={leftVersion ?? ""}
                      onChange={(e) => setLeftVersion(Number(e.target.value))}
                      data-testid="agent-command-diff-left"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.version_number}>
                          v{v.version_number}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label
                      className="form-label"
                      htmlFor="agent-command-diff-right"
                    >
                      With
                    </label>
                    <select
                      id="agent-command-diff-right"
                      className="input"
                      value={rightVersion ?? ""}
                      onChange={(e) => setRightVersion(Number(e.target.value))}
                      data-testid="agent-command-diff-right"
                    >
                      {versions.map((v) => (
                        <option key={v.id} value={v.version_number}>
                          v{v.version_number}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {left && right && (
                  <VersionDiff
                    leftLabel={`v${left.version_number}`}
                    rightLabel={`v${right.version_number}`}
                    leftBody={left.body}
                    rightBody={right.body}
                  />
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                A diff needs two versions. Save an edit and this compares them.
              </p>
            )}

            {/* Honesty about the baseline we cannot compute. */}
            <p className="text-xs text-muted-foreground italic">
              Comparisons here are between stored versions only. There is no
              &quot;diff against the shipped default&quot;: the default body
              lives inside the runner binary and is never uploaded, so
              qontinui-web has no baseline to compare against.
            </p>

            {/* The chain */}
            <ul className="space-y-2" data-testid="agent-command-version-list">
              {versions.map((version) => {
                const isHead = version.version_number === headVersion;
                return (
                  <li
                    key={version.id}
                    className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2"
                    data-testid={`agent-command-version-${version.version_number}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="badge badge-secondary">
                          v{version.version_number}
                        </span>
                        {isHead && (
                          <span className="badge badge-success">
                            Current
                          </span>
                        )}
                        {version.restored_from !== null && (
                          <span
                            className="badge badge-warning"
                            title={`This version's body was copied from v${version.restored_from} by a revert.`}
                          >
                            Restored from v{version.restored_from}
                          </span>
                        )}
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
                      disabled={reverting || isHead}
                      onClick={() => onRevert(version.version_number)}
                      title={
                        isHead
                          ? "Already the current version"
                          : `Write v${version.version_number}'s body as a new version`
                      }
                      data-testid={`agent-command-revert-${version.version_number}`}
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
