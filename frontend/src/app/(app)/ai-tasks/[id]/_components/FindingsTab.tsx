import { CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { SeverityIcon, FindingStatusBadge } from "./StatusIndicators";
import type { TaskRunFinding } from "@/types/task-runs";

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

interface FindingsTabProps {
  findings: TaskRunFinding[] | undefined;
  isExpanded: (id: string) => boolean;
  onToggle: (id: string) => void;
  onStatusChange: (findingId: string, newStatus: string) => void;
}

export function FindingsTab({
  findings,
  isExpanded,
  onToggle,
  onStatusChange,
}: FindingsTabProps) {
  if (!findings || findings.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
        <p>No findings reported for this task</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {SEVERITY_ORDER.map((severity) => {
        const severityFindings = findings.filter(
          (f) => f.severity === severity
        );
        if (severityFindings.length === 0) return null;

        return (
          <div key={severity}>
            <div className="flex items-center gap-2 mb-3">
              <SeverityIcon severity={severity} />
              <h3 className="font-medium capitalize">
                {severity} ({severityFindings.length})
              </h3>
            </div>
            <div className="space-y-2">
              {severityFindings.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  isExpanded={isExpanded(finding.id)}
                  onToggle={() => onToggle(finding.id)}
                  onStatusChange={onStatusChange}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface FindingCardProps {
  finding: TaskRunFinding;
  isExpanded: boolean;
  onToggle: () => void;
  onStatusChange: (findingId: string, newStatus: string) => void;
}

function FindingCard({
  finding,
  isExpanded,
  onToggle,
  onStatusChange,
}: FindingCardProps) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <SeverityIcon severity={finding.severity} />
          <div>
            <div className="font-medium">{finding.title}</div>
            <div className="text-sm text-muted-foreground">
              {finding.category || "General"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <FindingStatusBadge status={finding.status} />
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </button>
      {isExpanded && (
        <div className="border-t border-border p-4 bg-muted/50 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-1">
              Description
            </h4>
            <p className="text-sm text-foreground">{finding.description}</p>
          </div>
          {finding.resolution && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Resolution
              </h4>
              <p className="text-sm text-foreground">{finding.resolution}</p>
            </div>
          )}
          {finding.file_path && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                Location
              </h4>
              <code className="text-sm text-primary bg-primary/10 px-2 py-1 rounded">
                {finding.file_path}
                {finding.line_number && `:${finding.line_number}`}
              </code>
            </div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <span className="text-sm text-muted-foreground">Status:</span>
            <select
              value={finding.status}
              onChange={(e) => onStatusChange(finding.id, e.target.value)}
              className="bg-background border border-border rounded px-2 py-1 text-sm"
            >
              <option value="detected">Detected</option>
              <option value="in_progress">In Progress</option>
              <option value="needs_input">Needs Input</option>
              <option value="resolved">Resolved</option>
              <option value="wont_fix">Won&apos;t Fix</option>
              <option value="deferred">Deferred</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
