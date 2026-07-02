"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { ClipboardCopy, Copy, Download, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MachineDriftReport } from "@/services/devenv-api";
import {
  buildRemediation,
  remediationToJson,
  remediationToManifest,
} from "./copy-canonical";

interface CopyCanonicalButtonProps {
  report: MachineDriftReport;
  canonicalName: string | null;
}

/**
 * Per-machine "Copy from <canonical>" action. Derives the additive remediation
 * (make this machine match the canonical one) from its drift report and lets
 * the operator copy/download it as a manifest or JSON to apply on the box.
 * Renders nothing when the machine is already in sync (no changes to copy).
 */
export function CopyCanonicalButton({
  report,
  canonicalName,
}: CopyCanonicalButtonProps) {
  const rem = useMemo(() => buildRemediation(report), [report]);
  const canonical = canonicalName ?? "canonical";

  if (rem.inSync) return null;

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Failed to copy — select and copy manually");
    }
  };

  const download = () => {
    const blob = new Blob([remediationToJson(rem)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `copy-${canonical}-to-${rem.machineName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <Copy className="size-4" />
          Copy from {canonical}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="size-5" />
            Copy {canonical} → {rem.machineName}
          </DialogTitle>
          <DialogDescription>
            {rem.itemCount} {rem.itemCount === 1 ? "change" : "changes"} to make{" "}
            {rem.machineName} match {canonical}. Apply these on the machine — its
            agent re-reports and drift clears. Extra keys it already has are left
            untouched.
          </DialogDescription>
        </DialogHeader>

        {rem.secretCount > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
            <ShieldAlert className="size-4 shrink-0 text-warning mt-0.5" />
            <p className="text-xs text-foreground">
              {rem.secretCount} secret{rem.secretCount === 1 ? "" : "s"} can&apos;t
              be copied — secret values are never stored, only their presence. Set
              those by hand on {rem.machineName}.
            </p>
          </div>
        )}

        {report.schema_version_mismatch && (
          <p className="text-xs text-warning">
            Schema versions differ (canonical{" "}
            {report.expected_schema_version ?? "?"}, {rem.machineName}{" "}
            {report.actual_schema_version ?? "?"}). Update the agent so the
            contract lines up.
          </p>
        )}

        <ScrollArea className="max-h-72 rounded-md border border-border">
          <div className="p-3 space-y-3">
            {rem.sections.map((s) => (
              <div key={s.section} className="space-y-1">
                <p className="text-xs font-mono font-semibold text-muted-foreground">
                  [{s.section}]
                </p>
                {s.items.map((item) => (
                  <div
                    key={item.key}
                    className="pl-2 text-xs font-mono break-all"
                  >
                    {item.secret ? (
                      <span className="text-muted-foreground">
                        {item.key} ={" "}
                        <span className="italic">set manually (secret)</span>
                      </span>
                    ) : (
                      <span>
                        {item.key} ={" "}
                        <span className="text-foreground">{item.value}</span>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(remediationToManifest(rem), "Manifest")}
          >
            <ClipboardCopy className="size-4" />
            Copy manifest
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => copy(remediationToJson(rem), "JSON")}
          >
            <Copy className="size-4" />
            Copy JSON
          </Button>
          <Button variant="brand-primary" size="sm" onClick={download}>
            <Download className="size-4" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
