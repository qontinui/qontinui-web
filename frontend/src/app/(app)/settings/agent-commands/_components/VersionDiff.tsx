"use client";

import { useMemo } from "react";
import {
  collapseContext,
  computeLineDiff,
  type DiffOp,
} from "../_lib/line-diff";

interface VersionDiffProps {
  leftLabel: string;
  rightLabel: string;
  leftBody: string;
  rightBody: string;
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
 * Unified line diff between two STORED VERSIONS.
 *
 * Deliberately version-to-version only. A "diff against the shipped default"
 * is not computable here: the default bodies exist solely inside the runner
 * binary (`include_str!`) and the backend stores no copy of them, so there is
 * no baseline to put on the left-hand side. Rendering an empty or reconstructed
 * "default" side would be a fabricated comparison, so the page says the
 * baseline is unavailable instead.
 */
export function VersionDiff({
  leftLabel,
  rightLabel,
  leftBody,
  rightBody,
}: VersionDiffProps) {
  const diff = useMemo(
    () => computeLineDiff(leftBody, rightBody),
    [leftBody, rightBody]
  );
  const rendered = useMemo(() => collapseContext(diff.lines, 3), [diff.lines]);

  if (diff.identical) {
    return (
      <p
        className="text-sm text-muted-foreground italic"
        data-testid="agent-command-diff-identical"
      >
        {leftLabel} and {rightLabel} have identical bodies.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="agent-command-diff">
      <p className="text-xs text-muted-foreground">
        <span className="font-mono">{leftLabel}</span> →{" "}
        <span className="font-mono">{rightLabel}</span> ·{" "}
        <span className="text-green-500">+{diff.added}</span>{" "}
        <span className="text-red-500">-{diff.removed}</span>
      </p>
      {diff.degraded && (
        <p className="text-xs text-muted-foreground italic">
          These bodies are large enough that lines are compared by position
          rather than aligned, so the diff may show more changes than the
          minimal one would.
        </p>
      )}
      <pre className="max-h-[28rem] overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs leading-relaxed">
        {rendered.map((entry, index) =>
          "elided" in entry ? (
            <div
              key={`elided-${index}`}
              className="text-muted-foreground/60 italic py-1"
            >
              ⋯ {entry.elided} unchanged line{entry.elided === 1 ? "" : "s"}
            </div>
          ) : (
            <div
              key={`line-${index}`}
              className={`flex gap-3 ${OP_CLASS[entry.op]}`}
            >
              <span className="w-10 shrink-0 text-right select-none opacity-60">
                {entry.leftNumber ?? ""}
              </span>
              <span className="w-10 shrink-0 text-right select-none opacity-60">
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
