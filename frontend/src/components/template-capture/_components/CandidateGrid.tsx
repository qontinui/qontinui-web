import React from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TemplateCandidateCard } from "../TemplateCandidateCard";
import type {
  TemplateCaptureService,
  TemplateCandidate,
} from "@/services/template-capture-service";

interface CandidateGridProps {
  candidates: TemplateCandidate[];
  selectedIds: Set<string>;
  processingIds: Set<string>;
  service: TemplateCaptureService;
  onToggleSelect: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (candidate: TemplateCandidate) => void;
  onImport: (candidate: TemplateCandidate) => void;
}

export function CandidateGrid({
  candidates,
  selectedIds,
  processingIds,
  service,
  onToggleSelect,
  onApprove,
  onReject,
  onDelete,
  onEdit,
  onImport,
}: CandidateGridProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {candidates.map((candidate) => (
        <div key={candidate.id} className="relative">
          {candidate.status === "pending" && (
            <button
              className={cn(
                "absolute -top-2 -left-2 z-20 h-6 w-6 rounded-full",
                "flex items-center justify-center",
                "border-2 bg-background shadow-sm",
                "transition-colors",
                selectedIds.has(candidate.id)
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30 hover:border-primary/50"
              )}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect(candidate.id);
              }}
            >
              {selectedIds.has(candidate.id) && <Check className="h-3 w-3" />}
            </button>
          )}

          {processingIds.has(candidate.id) && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 rounded-lg">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}

          <TemplateCandidateCard
            candidate={candidate}
            isSelected={selectedIds.has(candidate.id)}
            onSelect={() => {
              if (
                candidate.status === "approved" ||
                candidate.status === "modified"
              ) {
                onImport(candidate);
              } else if (candidate.status === "pending") {
                onEdit(candidate);
              }
            }}
            onApprove={() => onApprove(candidate.id)}
            onReject={() => onReject(candidate.id)}
            onEdit={() => onEdit(candidate)}
            onDelete={() => onDelete(candidate.id)}
            thumbnailUrl={service.getThumbnailUrl(candidate)}
          />
        </div>
      ))}
    </div>
  );
}
