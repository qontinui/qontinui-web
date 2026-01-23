"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  AlertCircle,
  Eye,
  Search,
  CheckCircle,
  Archive,
  XCircle,
  ArrowRight,
  Clock,
  User,
} from "lucide-react";
import {
  Deficiency,
  DeficiencyStatus,
  WORKFLOW_TRANSITIONS,
  STATUS_CONFIG,
  DeficiencyActivity,
} from "@/types/deficiency";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DeficiencyWorkflowProps {
  deficiency: Deficiency;
  activities?: DeficiencyActivity[];
  onStatusChange?: (newStatus: DeficiencyStatus) => Promise<void>;
  className?: string;
}

const STATUS_ICONS = {
  AlertCircle,
  Eye,
  Search,
  CheckCircle,
  Archive,
  XCircle,
};

/**
 * DeficiencyWorkflow - Status workflow UI for deficiency lifecycle management
 *
 * Features:
 * - Visual status badges with colors
 * - Workflow state transitions (new → acknowledged → investigating → fixed → closed)
 * - Status change actions with validation
 * - Activity timeline showing status change history
 * - User information for each status change
 */
export function DeficiencyWorkflow({
  deficiency,
  activities = [],
  onStatusChange,
  className,
}: DeficiencyWorkflowProps) {
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<DeficiencyStatus | null>(
    null
  );

  const currentStatus = deficiency.status;
  const allowedTransitions = WORKFLOW_TRANSITIONS[currentStatus] || [];
  const config = STATUS_CONFIG[currentStatus];
  const IconComponent = STATUS_ICONS[config.icon as keyof typeof STATUS_ICONS];

  const handleStatusChange = async () => {
    if (!selectedStatus || !onStatusChange) return;

    setIsChangingStatus(true);
    try {
      await onStatusChange(selectedStatus);
      toast.success(`Status changed to ${STATUS_CONFIG[selectedStatus].label}`);
      setSelectedStatus(null);
    } catch (error) {
      toast.error("Failed to change status");
      console.error("Status change error:", error);
    } finally {
      setIsChangingStatus(false);
    }
  };

  const statusActivities = activities
    .filter((a) => a.action === "status_changed")
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

  return (
    <Card className={cn("w-full", className)} data-ui-id="testing-deficiency-workflow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconComponent className="h-5 w-5" />
          Workflow Status
        </CardTitle>
        <CardDescription>
          Track and manage the deficiency lifecycle
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Status */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Current Status</label>
          <Badge
            className={cn(
              "text-base px-4 py-2",
              config.bgColor,
              config.color,
              "border"
            )}
          >
            <IconComponent className="h-4 w-4 mr-2" />
            {config.label}
          </Badge>
        </div>

        {/* Status Change */}
        {allowedTransitions.length > 0 && onStatusChange && (
          <>
            <Separator />
            <div className="space-y-4">
              <label className="text-sm font-medium">Change Status</label>
              <div className="flex gap-2">
                <Select
                  value={selectedStatus || ""}
                  onValueChange={(value) =>
                    setSelectedStatus(value as DeficiencyStatus)
                  }
                >
                  <SelectTrigger className="flex-1" data-ui-id="testing-deficiency-workflow-status-select">
                    <SelectValue placeholder="Select new status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {allowedTransitions.map((status) => {
                      const statusConfig = STATUS_CONFIG[status];
                      const StatusIcon =
                        STATUS_ICONS[
                          statusConfig.icon as keyof typeof STATUS_ICONS
                        ];
                      return (
                        <SelectItem key={status} value={status}>
                          <div className="flex items-center gap-2">
                            <StatusIcon className="h-4 w-4" />
                            {statusConfig.label}
                          </div>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleStatusChange}
                  disabled={!selectedStatus || isChangingStatus}
                  size="default"
                  data-ui-id="testing-deficiency-workflow-update-btn"
                >
                  {isChangingStatus ? (
                    "Updating..."
                  ) : (
                    <>
                      <ArrowRight className="h-4 w-4 mr-2" />
                      Update
                    </>
                  )}
                </Button>
              </div>
              {selectedStatus && (
                <p className="text-xs text-muted-foreground">
                  This will move the deficiency from{" "}
                  <span className="font-medium">{config.label}</span> to{" "}
                  <span className="font-medium">
                    {STATUS_CONFIG[selectedStatus].label}
                  </span>
                </p>
              )}
            </div>
          </>
        )}

        {/* Status History */}
        {statusActivities.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <label className="text-sm font-medium">Status History</label>
              <div className="space-y-2">
                {statusActivities.map((activity) => {
                  const oldStatus = activity.details.old_value as
                    | DeficiencyStatus
                    | undefined;
                  const newStatus = activity.details
                    .new_value as DeficiencyStatus;
                  const newConfig = STATUS_CONFIG[newStatus];
                  const NewIcon =
                    STATUS_ICONS[newConfig.icon as keyof typeof STATUS_ICONS];

                  return (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 text-sm"
                    >
                      <NewIcon
                        className={cn("h-4 w-4 mt-0.5", newConfig.color)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {oldStatus && (
                            <>
                              <span className="text-muted-foreground">
                                {STATUS_CONFIG[oldStatus].label}
                              </span>
                              <ArrowRight className="h-3 w-3 text-muted-foreground" />
                            </>
                          )}
                          <span className={cn("font-medium", newConfig.color)}>
                            {newConfig.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {activity.user_name}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(activity.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Workflow Guide */}
        <Separator />
        <div className="space-y-2">
          <label className="text-sm font-medium">Workflow Guide</label>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              <strong>New:</strong> Initial state when deficiency is reported
            </p>
            <p>
              <strong>Acknowledged:</strong> Team has reviewed and confirmed the
              issue
            </p>
            <p>
              <strong>Investigating:</strong> Actively working on root cause
              analysis
            </p>
            <p>
              <strong>Fixed:</strong> Issue has been resolved and ready for
              verification
            </p>
            <p>
              <strong>Closed:</strong> Fix has been verified and deployed
            </p>
            <p>
              <strong>Won&apos;t Fix:</strong> Issue will not be addressed (by
              design, out of scope, etc.)
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
