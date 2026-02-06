/**
 * TemplateCandidateCard Component
 *
 * Individual card for displaying a template candidate in the review grid.
 * Shows thumbnail with detected boundary overlay, confidence score, and actions.
 */

import React from "react";
import { Check, X, Edit2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  TemplateCandidate,
  CandidateStatus,
} from "@/services/template-capture-service";

export interface TemplateCandidateCardProps {
  candidate: TemplateCandidate;
  isSelected?: boolean;
  onSelect?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  showActions?: boolean;
  thumbnailUrl?: string;
}

function getStatusColor(status: CandidateStatus): string {
  switch (status) {
    case "approved":
      return "bg-green-500/10 text-green-600 border-green-500/30";
    case "rejected":
      return "bg-red-500/10 text-red-600 border-red-500/30";
    case "modified":
      return "bg-blue-500/10 text-blue-600 border-blue-500/30";
    default:
      return "bg-yellow-500/10 text-yellow-600 border-yellow-500/30";
  }
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "text-green-600";
  if (confidence >= 0.5) return "text-yellow-600";
  return "text-red-600";
}

export function TemplateCandidateCard({
  candidate,
  isSelected = false,
  onSelect,
  onApprove,
  onReject,
  onEdit,
  onDelete,
  showActions = true,
  thumbnailUrl,
}: TemplateCandidateCardProps) {
  const { primary_boundary } = candidate;
  const imageUrl =
    thumbnailUrl || candidate.thumbnail_url || candidate.pixel_data_url;

  return (
    <div
      className={cn(
        "relative group rounded-lg border-2 transition-all cursor-pointer overflow-hidden",
        "hover:shadow-md bg-card",
        isSelected
          ? "border-primary shadow-lg ring-2 ring-primary/20"
          : "border-border hover:border-primary/50"
      )}
      onClick={onSelect}
    >
      {/* Status Badge */}
      <Badge
        variant="outline"
        className={cn(
          "absolute top-2 left-2 z-10 text-xs",
          getStatusColor(candidate.status)
        )}
      >
        {candidate.status}
      </Badge>

      {/* Confidence Badge */}
      <Badge
        variant="secondary"
        className={cn(
          "absolute top-2 right-2 z-10 text-xs",
          getConfidenceColor(candidate.confidence_score)
        )}
      >
        {Math.round(candidate.confidence_score * 100)}%
      </Badge>

      {/* Thumbnail with Boundary Overlay */}
      <div className="relative w-full aspect-video bg-muted">
        {imageUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`Template candidate ${candidate.id}`}
              className="w-full h-full object-contain"
              onError={(e) => {
                console.error(`[TemplateCandidateCard] Failed to load image:`, {
                  id: candidate.id,
                  url: imageUrl,
                });
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
            {/* Boundary Overlay */}
            <svg
              className="absolute inset-0 w-full h-full pointer-events-none"
              viewBox={`0 0 ${primary_boundary.width + 20} ${primary_boundary.height + 20}`}
              preserveAspectRatio="xMidYMid meet"
            >
              <rect
                x="10"
                y="10"
                width={primary_boundary.width}
                height={primary_boundary.height}
                fill="none"
                stroke="rgba(59, 130, 246, 0.8)"
                strokeWidth="2"
                strokeDasharray="4 2"
              />
            </svg>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            No preview
          </div>
        )}
      </div>

      {/* Info Section */}
      <div className="p-3 space-y-2">
        {/* Element Type */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium capitalize">
            {candidate.element_type}
          </span>
          <span className="text-xs text-muted-foreground">
            {primary_boundary.width} x {primary_boundary.height}
          </span>
        </div>

        {/* Click Position */}
        <div className="text-xs text-muted-foreground">
          Click: ({candidate.click_x}, {candidate.click_y})
        </div>

        {/* Detection Strategy */}
        <Badge variant="outline" className="text-xs">
          {primary_boundary.strategy}
        </Badge>

        {/* Application Name */}
        {candidate.application_name && (
          <div
            className="text-xs text-muted-foreground truncate"
            title={candidate.application_name}
          >
            {candidate.application_name}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      {showActions && candidate.status === "pending" && (
        <div
          className={cn(
            "absolute bottom-0 left-0 right-0 p-2 bg-background/90 backdrop-blur-sm",
            "flex items-center justify-center gap-2",
            "opacity-0 group-hover:opacity-100 transition-opacity"
          )}
        >
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-green-600 hover:bg-green-50 hover:text-green-700"
            onClick={(e) => {
              e.stopPropagation();
              onApprove?.();
            }}
          >
            <Check className="h-4 w-4 mr-1" />
            Approve
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={(e) => {
              e.stopPropagation();
              onReject?.();
            }}
          >
            <X className="h-4 w-4 mr-1" />
            Reject
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={(e) => {
              e.stopPropagation();
              onEdit?.();
            }}
          >
            <Edit2 className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Delete Button (always visible on hover for non-pending) */}
      {showActions && candidate.status !== "pending" && (
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "absolute bottom-2 right-2 h-8 w-8 p-0",
            "opacity-0 group-hover:opacity-100 transition-opacity",
            "text-muted-foreground hover:text-red-600"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.();
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
