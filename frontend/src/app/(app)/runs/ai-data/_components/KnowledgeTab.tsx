"use client";

import { useTaskRunKnowledge, type Finding } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { Brain } from "lucide-react";
import { getSeverityBadge } from "./utils";

export function KnowledgeTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunKnowledge(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        Loading knowledge...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        Error loading knowledge: {error}
      </div>
    );
  }

  const findings = data?.findings ?? [];
  const observations = data?.observations ?? [];
  const hypotheses = data?.hypotheses ?? [];

  if (
    findings.length === 0 &&
    observations.length === 0 &&
    hypotheses.length === 0
  ) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Brain className="size-10 mx-auto mb-3 opacity-40" />
        <p className="text-sm">No knowledge entries for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {findings.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Findings ({findings.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                    Severity
                  </th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                    Category
                  </th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                    Title
                  </th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                    File
                  </th>
                  <th className="text-left py-2 px-3 text-muted-foreground font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {findings.map((finding: Finding) => (
                  <tr
                    key={finding.id}
                    className="border-b border-border hover:bg-muted/50"
                  >
                    <td className="py-2.5 px-3">
                      {getSeverityBadge(finding.severity)}
                    </td>
                    <td className="py-2.5 px-3 text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        {finding.category}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      <div
                        data-content-role="label"
                        data-content-label="finding title"
                        className="text-foreground font-medium"
                      >
                        {finding.title}
                      </div>
                      <div
                        data-content-role="description"
                        data-content-label="finding description"
                        className="text-muted-foreground text-xs mt-0.5 line-clamp-2"
                      >
                        {finding.description}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground max-w-[200px] truncate">
                      {finding.file_path
                        ? `${finding.file_path}${finding.line_number ? `:${finding.line_number}` : ""}`
                        : "-"}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge variant="secondary" className="text-xs">
                        {finding.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {observations.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Observations ({observations.length})
          </h3>
          <div className="space-y-2">
            {observations.map((obs, idx) => (
              <div
                key={idx}
                className="bg-muted/50 border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground"
              >
                {obs}
              </div>
            ))}
          </div>
        </div>
      )}

      {hypotheses.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Hypotheses ({hypotheses.length})
          </h3>
          <div className="space-y-2">
            {hypotheses.map((hyp, idx) => (
              <div
                key={idx}
                className="bg-muted/50 border border-border rounded-lg px-4 py-3 text-sm text-muted-foreground italic"
              >
                {hyp}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
