"use client";

import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ClipboardCopy,
  Server,
  TriangleAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  EnvironmentDrift,
  KeyDelta,
  MachineDriftReport,
  SectionDrift,
  Severity,
} from "@/services/devenv-api";
import { CopyCanonicalButton } from "./CopyCanonicalDialog";
import { buildRemediation, remediationToManifest } from "./copy-canonical";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

/** Map a severity to a badge variant; in-sync gets the success variant. */
function severityVariant(severity: Severity, inSync: boolean): BadgeVariant {
  if (inSync) return "success";
  switch (severity) {
    case "critical":
      return "destructive";
    case "warning":
      return "warning";
    case "info":
    default:
      return "secondary";
  }
}

function severityLabel(report: MachineDriftReport): string {
  if (report.in_sync) return "in sync";
  return report.severity;
}

/** Per-delta color class keyed by severity (text only — used inside rows). */
function deltaSeverityClass(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "text-destructive";
    case "warning":
      return "text-warning";
    case "info":
    default:
      return "text-muted-foreground";
  }
}

function statusLabel(status: KeyDelta["status"]): string {
  switch (status) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "changed":
    default:
      return "Changed";
  }
}

interface DriftMatrixProps {
  drift: EnvironmentDrift;
}

/**
 * Renders the environment-level drift rollup: an overall severity badge plus
 * one expandable card per non-canonical machine. Each machine card shows its
 * section rows; expanding a section reveals the individual key deltas
 * (status + expected vs actual), colored by severity.
 */
export function DriftMatrix({ drift }: DriftMatrixProps) {
  const canonical = drift.canonical_machine_name ?? "canonical";
  // Machines with a copyable (additive) remediation vs canonical. A report can
  // be "not in sync" yet have nothing to copy (only extra keys), so key off the
  // remediation, not report.in_sync.
  const copyable = drift.reports
    .map((report) => ({ report, rem: buildRemediation(report) }))
    .filter(({ rem }) => !rem.inSync);

  const copyAllDrifted = async () => {
    const manifest = copyable
      .map(
        ({ rem }) => `# ===== ${rem.machineName} =====\n${remediationToManifest(rem)}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(manifest);
      toast.success(
        `Copied remediation for ${copyable.length} machine${
          copyable.length === 1 ? "" : "s"
        }`
      );
    } catch {
      toast.error("Failed to copy — copy per-machine instead");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium">Overall</span>
          <Badge variant={severityVariant(drift.severity, drift.in_sync)}>
            {drift.in_sync ? "in sync" : drift.severity}
          </Badge>
          <span className="text-xs text-muted-foreground truncate">
            {drift.reports.length}{" "}
            {drift.reports.length === 1 ? "machine" : "machines"} compared vs{" "}
            <span className="font-medium">{canonical}</span>
          </span>
        </div>
        {copyable.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={copyAllDrifted}
          >
            <ClipboardCopy className="size-4" />
            Copy all drifted ({copyable.length})
          </Button>
        )}
      </div>

      {drift.reports.length === 0 ? (
        <div className="rounded-lg border border-border p-8 text-center">
          <CheckCircle2 className="size-8 mx-auto mb-2 text-success" />
          <p className="text-sm text-muted-foreground">
            No other machines report a config for this environment yet. Drift is
            measured against the canonical machine once others enroll.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {drift.reports.map((report) => (
            <MachineDriftCard
              key={report.machine_id ?? report.machine_name ?? "unknown"}
              report={report}
              canonicalName={drift.canonical_machine_name}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MachineDriftCard({
  report,
  canonicalName,
}: {
  report: MachineDriftReport;
  canonicalName: string | null;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Server className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium truncate">
            {report.machine_name ?? "Unknown machine"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {report.in_sync ? (
            <CheckCircle2 className="size-4 text-success" />
          ) : report.severity === "critical" ? (
            <CircleAlert className="size-4 text-destructive" />
          ) : (
            <TriangleAlert className="size-4 text-warning" />
          )}
          <Badge variant={severityVariant(report.severity, report.in_sync)}>
            {severityLabel(report)}
          </Badge>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {!report.has_config && (
          <p className="text-xs text-warning">
            This machine has not reported a config for this environment.
          </p>
        )}

        {report.schema_version_mismatch && (
          <p className="text-xs text-warning">
            Schema version mismatch — expected{" "}
            <span className="font-mono">
              {report.expected_schema_version ?? "?"}
            </span>
            , got{" "}
            <span className="font-mono">
              {report.actual_schema_version ?? "?"}
            </span>
            .
          </p>
        )}

        {report.in_sync && report.sections.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Fully in sync with the canonical machine.
          </p>
        ) : (
          <>
            {/* in_sync with deltas still listed means every difference is
                repo-derived — real, but not this machine's state. Say so, or
                the panel reads as contradicting the in-sync badge. */}
            {report.in_sync && (
              <p className="text-xs text-muted-foreground">
                In sync with the canonical machine — the differences below are
                repo-derived, not machine state.
              </p>
            )}
            {report.sections.map((section) => (
              <SectionRow key={section.section} section={section} />
            ))}
          </>
        )}

        {report.has_config && (
          <div className="pt-1">
            <CopyCanonicalButton
              report={report}
              canonicalName={canonicalName}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SectionRow({ section }: { section: SectionDrift }) {
  const [open, setOpen] = useState(false);
  const driftCount = section.deltas.length;

  return (
    <div className="rounded-md border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="text-sm font-mono truncate">{section.section}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground">
            {driftCount} {driftCount === 1 ? "delta" : "deltas"}
          </span>
          <Badge variant={severityVariant(section.severity, false)}>
            {section.severity}
          </Badge>
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {section.process_scoped && (
            <p className="text-xs text-muted-foreground">
              This section reflects the environment of the process that captured
              it, so differences here may be process-scope artifacts rather than
              real drift.
            </p>
          )}
          {section.deltas.length === 0 ? (
            <p className="text-xs text-muted-foreground">No deltas.</p>
          ) : (
            section.deltas.map((delta) => (
              <DeltaRow key={delta.key} delta={delta} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function DeltaRow({ delta }: { delta: KeyDelta }) {
  return (
    <div className="rounded-sm bg-muted/30 px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono font-medium truncate">
          {delta.key}
          {delta.derived && (
            <span
              className="ml-1.5 font-sans font-normal text-muted-foreground"
              title="Read from the repo the capturing binary was built from, not from this machine — it converges by pulling the repo, never by an apply."
            >
              (repo-derived)
            </span>
          )}
        </span>
        <span
          className={`text-[10px] uppercase tracking-wide font-semibold ${deltaSeverityClass(
            delta.severity
          )}`}
        >
          {statusLabel(delta.status)}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
        <div className="min-w-0">
          <span className="text-muted-foreground">expected: </span>
          <span className="font-mono break-all">
            {delta.expected ?? "—"}
          </span>
        </div>
        <div className="min-w-0">
          <span className="text-muted-foreground">actual: </span>
          <span className={`font-mono break-all ${deltaSeverityClass(delta.severity)}`}>
            {delta.actual ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
