"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DiscoveryTypeBadge } from "./DiscoveryTypeBadge";
import { DiscoveryReviewDialog } from "./DiscoveryReviewDialog";
import type { Discovery } from "@/types/discoveries";
import { cn } from "@/lib/utils";
import { Check, X, Server, FolderOpen, Calendar, Eye } from "lucide-react";

interface DiscoveryCardProps {
  discovery: Discovery;
  onAccept: (id: string, notes?: string) => Promise<void>;
  onReject: (id: string, notes?: string) => Promise<void>;
  isAccepting?: boolean;
  isRejecting?: boolean;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-green-500";
  if (confidence >= 0.5) return "text-yellow-500";
  return "text-orange-500";
}

export function DiscoveryCard({
  discovery,
  onAccept,
  onReject,
  isAccepting = false,
  isRejecting = false,
}: DiscoveryCardProps) {
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<"accept" | "reject">(
    "accept"
  );

  const handleAcceptClick = () => {
    setReviewAction("accept");
    setReviewDialogOpen(true);
  };

  const handleRejectClick = () => {
    setReviewAction("reject");
    setReviewDialogOpen(true);
  };

  const handleReviewSubmit = async (notes?: string) => {
    if (reviewAction === "accept") {
      await onAccept(discovery.id, notes);
    } else {
      await onReject(discovery.id, notes);
    }
    setReviewDialogOpen(false);
  };

  const isPending = discovery.status === "pending";
  const isProcessing = isAccepting || isRejecting;

  return (
    <>
      <Card
        className={cn(
          "bg-surface-raised border-border-subtle hover:border-border-default transition-all duration-200",
          !isPending && "opacity-75"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <DiscoveryTypeBadge type={discovery.discovery_type} />
                {discovery.status !== "pending" && (
                  <Badge
                    variant="outline"
                    className={cn(
                      discovery.status === "accepted"
                        ? "border-green-500/50 text-green-500"
                        : "border-red-500/50 text-red-500"
                    )}
                  >
                    {discovery.status === "accepted" ? "Accepted" : "Rejected"}
                  </Badge>
                )}
              </div>
              <CardTitle className="text-lg text-white truncate">
                {discovery.title}
              </CardTitle>
              {discovery.description && (
                <CardDescription className="mt-1 text-text-muted line-clamp-2">
                  {discovery.description}
                </CardDescription>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div
                className={cn(
                  "text-sm font-medium",
                  getConfidenceColor(discovery.confidence)
                )}
              >
                {Math.round(discovery.confidence * 100)}%
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-text-muted">
              <Server size={14} />
              <span className="truncate">
                {discovery.runner_name || "Unknown Runner"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-text-muted">
              <FolderOpen size={14} />
              <span className="truncate">
                {discovery.config_name || "Unknown Config"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-text-muted">
              <Eye size={14} />
              <span>
                {discovery.runs_observed}{" "}
                {discovery.runs_observed === 1 ? "run" : "runs"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-text-muted">
              <Calendar size={14} />
              <span className="truncate">
                {formatDate(discovery.created_at)}
              </span>
            </div>
          </div>

          {/* Evidence summary */}
          {discovery.evidence && (
            <div className="text-xs text-text-muted bg-surface-canvas/50 rounded-lg p-3">
              <div className="flex justify-between">
                <span>
                  First seen: {formatDate(discovery.evidence.first_seen)}
                </span>
                <span>
                  Last seen: {formatDate(discovery.evidence.last_seen)}
                </span>
              </div>
            </div>
          )}

          {/* User notes (if reviewed) */}
          {discovery.user_notes && (
            <div className="text-sm text-text-muted italic bg-surface-canvas/50 rounded-lg p-3 border-l-2 border-border-default">
              {discovery.user_notes}
            </div>
          )}

          {/* Action buttons */}
          {isPending && (
            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAcceptClick}
                disabled={isProcessing}
                className="flex-1 border-green-500/30 text-green-500 hover:bg-green-500/10 hover:border-green-500/50"
              >
                <Check size={14} className="mr-1" />
                Accept
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRejectClick}
                disabled={isProcessing}
                className="flex-1 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:border-red-500/50"
              >
                <X size={14} className="mr-1" />
                Reject
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <DiscoveryReviewDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        action={reviewAction}
        discovery={discovery}
        onSubmit={handleReviewSubmit}
        isSubmitting={isProcessing}
      />
    </>
  );
}
