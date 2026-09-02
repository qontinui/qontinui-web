"use client";

import { useMemo } from "react";
import { collapseContext, computeLineDiff, type DiffOp } from "../_lib/line-diff";

interface VersionDiffProps {
  leftLabel: string;
  rightLabel: string;
  /** The file this diff is for — a unit is a MAP, so a diff is always per-file. */
  path: string;
  /** `null` when the file does not exist on that side (added / removed). */
  leftText: string | null;
  rightText: string | null;
}

const OP_CLASS: Record<DiffOp, string> = {
  add: "bg-green-500/10 text-green-500",
  remove: "bg-red-500/10 text-red-500",
  context: "text-muted-foreground",
};

const OP_MARK: Record<DiffOp, string> = {
  add: "+",
  remove: "-",
  context: " ",
};

/**
 * Unified line diff of ONE FILE between two STORED VERSIONS.
 *
 * Per-file by construction: a version stores a `files` map, so "the diff
 * between v3 and v4" is a set of per-path diffs, not one. A file present on
 * only one side is stated as added or removed rather than diffed against a
 * fabricated empty side.
 *
 * Deliberately version-to-version only. A "diff against the shipped default"
 * is not computable here: the embedded text exists solely inside the runner
 * binary (`include_str!`) and the backend stores no copy of it, so there is no
 * baseline to put on the left-hand side.
 */
export function VersionDiff({
  leftLabel,
  rightLabel,
  path,
  leftText,
  rightText,
}: VersionDiffProps) {
  const diff = useMemo(
    () => computeLineDiff(leftText ?? "", rightText ?? ""),
    [leftText, rightText]
  );
  const rendered = useMemo(() => collapseContext(diff.lines, 3), [diff.lines]);

  if (leftText === null || rightText === null) {
    const verb = leftText === null ? "added in" : "removed in";
    const other = leftText === null ? rightLabel : leftLabel;
    return (
      <p
        className="text-sm italic text-muted-foreground"
        data-testid="unit-diff-file-absent"
      >
        <span className="font-mono">{path}</span> was {verb} {other} — it exists
        on only one side, so there is nothing to compare line by line.
      </p>
    );
  }

  if (diff.identical) {
    return (
      <p
        className="text-sm italic text-muted-foreground"
        data-testid="unit-diff-identical"
      >
        <span className="font-mono">{path}</span> is identical in {leftLabel} and{" "}
        {rightLabel}.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="unit-diff">
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{path}</span> ·{" "}
        <span className="font-mono">{leftLabel}</span> →{" "}
        <span className="font-mono">{rightLabel}</span> ·{" "}
        <span className="text-green-500">+{diff.added}</span>{" "}
        <span className="text-red-500">-{diff.removed}</span>
      </p>
      {diff.degraded && (
        <p className="text-xs italic text-muted-foreground">
          This file is large enough that lines are compared by position rather
          than aligned, so the diff may show more changes than the minimal one
          would.
        </p>
      )}
      <pre className="max-h-[28rem] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
        {rendered.map((entry, index) =>
          "elided" in entry ? (
            <div
              key={`elided-${index}`}
              className="py-1 italic text-muted-foreground/60"
            >
              ⋯ {entry.elided} unchanged line{entry.elided === 1 ? "" : "s"}
            </div>
          ) : (
            <div
              key={`line-${index}`}
              className={`flex gap-3 ${OP_CLASS[entry.op]}`}
            >
              <span className="w-10 shrink-0 select-none text-right opacity-60">
                {entry.leftNumber ?? ""}
              </span>
              <span className="w-10 shrink-0 select-none text-right opacity-60">
                {entry.rightNumber ?? ""}
              </span>
              <span className="shrink-0 select-none">{OP_MARK[entry.op]}</span>
              <span className="whitespace-pre-wrap break-words">
                {entry.text || " "}
              </span>
            </div>
          )
        )}
      </pre>
    </div>
  );
}
