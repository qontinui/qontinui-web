import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { Vendor } from "@/app/(app)/overview/types";

interface SourceFreshnessProps {
  vendor: Vendor;
}

export function SourceFreshness({ vendor }: SourceFreshnessProps) {
  const Icon =
    vendor.status === "Failed"
      ? AlertCircle
      : vendor.status === "Connected"
        ? CheckCircle2
        : Clock;

  const statusText =
    vendor.status === "Manual"
      ? "Manual entry"
      : vendor.status === "Recurring"
        ? vendor.description || "Recurring charge"
        : vendor.status === "Connected"
          ? `Imported ${vendor.lastSyncDate ? "recently" : "—"}`
          : "Last import failed";

  const statusColor =
    vendor.status === "Failed"
      ? "text-destructive"
      : vendor.status === "Connected"
        ? "text-primary"
        : "text-muted-foreground";

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 size-5 flex-shrink-0 ${statusColor}`} />
          <div className="min-w-0">
            <h4 className="text-sm font-medium">{vendor.name}</h4>
            <p className="text-sm text-muted-foreground">{statusText}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
