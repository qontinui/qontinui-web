import { useState } from "react";
import type { FindingView } from "@/lib/task-run-mappers";
import { FindingCard } from "./FindingCard";

interface FindingsListProps {
  findings: FindingView[];
  onResolveFinding: (findingId: string, e: React.MouseEvent) => void;
}

export function FindingsList({
  findings,
  onResolveFinding,
}: FindingsListProps) {
  const [expandedFinding, setExpandedFinding] = useState<string | null>(null);

  if (findings.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No findings match the current filters.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {findings.map((finding) => (
        <FindingCard
          key={finding.id}
          finding={finding}
          isExpanded={expandedFinding === finding.id}
          onToggleExpand={() =>
            setExpandedFinding(
              expandedFinding === finding.id ? null : finding.id
            )
          }
          onResolve={onResolveFinding}
        />
      ))}
    </div>
  );
}
