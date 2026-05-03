"use client";

/**
 * SpecDriftDetail — minimal renderer for semantic / structural drift entries
 * surfaced by the IR comparator (`compareSpecToRuntime`).
 *
 * Three kinds are handled:
 * - "missing-in-runtime": IR declared a state/transition the runtime doesn't have.
 * - "missing-in-ir":      runtime registered a state/transition the IR doesn't declare.
 * - "shape-mismatch":     IR + runtime agree on the id but disagree on a field.
 *
 * Forward-compatible: any unknown drift kind falls through to a generic
 * panel rather than throwing.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, FileCode, GitCompare } from "lucide-react";
import type { SpecDriftEntryView } from "./drift-api";

const KIND_LABEL: Record<SpecDriftEntryView["kind"], string> = {
  "missing-in-runtime": "Missing in runtime",
  "missing-in-ir": "Missing in IR",
  "shape-mismatch": "Shape mismatch",
};

const KIND_DESCRIPTION: Record<SpecDriftEntryView["kind"], string> = {
  "missing-in-runtime":
    "Declared in the spec but not registered in the running app.",
  "missing-in-ir":
    "Registered in the running app but not declared in the spec.",
  "shape-mismatch":
    "Both sides agree on the id but disagree on at least one field.",
};

export interface SpecDriftDetailProps {
  runId: string;
  entry: SpecDriftEntryView;
}

export function SpecDriftDetail({ runId, entry }: SpecDriftDetailProps) {
  void runId;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GitCompare className="size-4 text-muted-foreground" />
              <span className="font-mono">{entry.id}</span>
            </CardTitle>
            <Badge variant="outline">{KIND_LABEL[entry.kind]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {KIND_DESCRIPTION[entry.kind]}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <DetailField label="Detail" value={entry.detail} mono />

          {entry.sourcePredicate && (
            <DetailField
              label="Source predicate"
              value={entry.sourcePredicate}
              mono
            />
          )}

          {entry.sourceFile && (
            <div className="space-y-1">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Source file
              </div>
              <div className="flex items-center gap-2 text-sm font-mono">
                <FileCode className="size-3.5 text-muted-foreground" />
                <span>{entry.sourceFile}</span>
              </div>
            </div>
          )}

          {(entry.expected !== undefined || entry.observed !== undefined) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <ValueBlock label="Expected (IR)" value={entry.expected} />
              <ValueBlock label="Observed (runtime)" value={entry.observed} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
        <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
        <p>
          Semantic drift means the live app diverged from the authored spec. A
          fix in either the spec, the runtime registration, or the failing
          transition resolves it.
        </p>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={mono ? "text-sm font-mono break-words" : "text-sm"}>
        {value}
      </div>
    </div>
  );
}

function ValueBlock({ label, value }: { label: string; value: unknown }) {
  if (value === undefined) return null;
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="text-xs font-mono whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 max-h-48 overflow-auto">
        {text}
      </pre>
    </div>
  );
}

export default SpecDriftDetail;
