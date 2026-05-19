"use client";

/**
 * AlertCard — render a single `coord.alerts` row.
 *
 * Plan `2026-05-19-coordinator-production-readiness.md` Phase 2 (Wave 2).
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export interface CoordAlertRow {
  id?: number | string;
  alert_key: string;
  severity?: string;
  kind?: string;
  device_id?: string | null;
  summary?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  occurrences?: number;
  resolved_at?: string | null;
  detail?: Record<string, unknown>;
}

function severityVariant(
  sev?: string
): "default" | "destructive" | "secondary" | "outline" {
  switch ((sev ?? "").toLowerCase()) {
    case "critical":
      return "destructive";
    case "warning":
      return "default";
    case "info":
      return "secondary";
    default:
      return "outline";
  }
}

export function AlertCard({ alert }: { alert: CoordAlertRow }) {
  return (
    <Card
      data-testid="coord-alert-card"
      className={alert.resolved_at ? "opacity-60" : undefined}
    >
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge variant={severityVariant(alert.severity)}>
            {alert.severity ?? "info"}
          </Badge>
          {alert.kind && (
            <Badge variant="outline" className="text-xs">
              {alert.kind}
            </Badge>
          )}
          <span className="font-mono text-xs">{alert.alert_key}</span>
          {alert.resolved_at && (
            <Badge variant="secondary" className="text-xs">
              resolved
            </Badge>
          )}
          {alert.occurrences != null && alert.occurrences > 1 && (
            <Badge variant="outline" className="text-xs">
              ×{alert.occurrences}
            </Badge>
          )}
        </div>
        {alert.summary && (
          <p className="text-sm text-foreground">{alert.summary}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {alert.first_seen_at && (
            <span>first {alert.first_seen_at}</span>
          )}
          {alert.last_seen_at && <span>last {alert.last_seen_at}</span>}
          {alert.device_id && (
            <span>device {alert.device_id.slice(0, 8)}…</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
