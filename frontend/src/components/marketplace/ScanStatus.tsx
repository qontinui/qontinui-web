/**
 * Shared pieces for rendering a package version's security scan. What a scan
 * SAYS is decided by `scanDisplay` (`@/types/code-packages`); this module only
 * maps its tone to an icon and colours, and lists the served issues, so the
 * install dialog, the package sidebar and the package header agree.
 */

import { AlertTriangle, CheckCircle2, Clock, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  PackageScanIssue,
  ScanDisplay,
  ScanTone,
} from "@/types/code-packages";

/** The UI Bridge id every rendered scan status carries. */
export const SCAN_STATUS_BRIDGE_ID = "marketplace.scan-status";

/** Border/background classes for a surface showing a scan of this tone. */
export const SCAN_TONE_SURFACE: Record<ScanTone, string> = {
  success: "border-green-500/50 bg-green-950/20",
  warning: "border-yellow-500/50 bg-yellow-950/20",
  danger: "border-red-500/50 bg-red-950/20",
  neutral: "border-border bg-muted/50",
};

/** Text colour for a scan label of this tone. */
export const SCAN_TONE_TEXT: Record<ScanTone, string> = {
  success: "text-green-500",
  warning: "text-yellow-500",
  danger: "text-red-500",
  neutral: "text-muted-foreground",
};

export function ScanIcon({
  display,
  className,
}: {
  display: ScanDisplay;
  className?: string;
}) {
  const classes = cn(
    "w-4 h-4 flex-shrink-0",
    SCAN_TONE_TEXT[display.tone],
    className
  );
  switch (display.tone) {
    case "success":
      return <CheckCircle2 className={classes} aria-hidden />;
    case "warning":
    case "danger":
      return <AlertTriangle className={classes} aria-hidden />;
    default:
      return display.status === "unknown" ? (
        <HelpCircle className={classes} aria-hidden />
      ) : (
        <Clock className={classes} aria-hidden />
      );
  }
}

/** The served scan issues, one line each. Renders nothing for none. */
export function ScanIssueList({ issues }: { issues: PackageScanIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1">
      {issues.map((issue, index) => (
        <li key={index} className="text-xs">
          <Badge
            variant={
              issue.severity === "critical" || issue.severity === "high"
                ? "destructive"
                : "secondary"
            }
            className="mr-2"
          >
            {issue.severity}
          </Badge>
          <span className="text-muted-foreground">
            {issue.line_number !== undefined && `Line ${issue.line_number}: `}
            {issue.description}
          </span>
        </li>
      ))}
    </ul>
  );
}
