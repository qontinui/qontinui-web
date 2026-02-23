"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus,
  ChevronDown,
  Trash2,
  Loader2,
  Calendar,
  Layers,
} from "lucide-react";
import type { WorkflowSequenceSummary } from "@/lib/api/workflow-sequences";

interface SavedSequenceSelectorProps {
  sequences: WorkflowSequenceSummary[] | null;
  isLoading: boolean;
  activeSequenceId: string | null;
  onLoad: (sequenceId: string) => void;
  onNew: () => void;
  onDelete: (sequenceId: string) => void;
}

export function SavedSequenceSelector({
  sequences,
  isLoading,
  activeSequenceId,
  onLoad,
  onNew,
  onDelete,
}: SavedSequenceSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 mb-4">
        <Loader2 className="size-4 animate-spin text-text-muted" />
        <span className="text-sm text-text-muted">Loading sequences...</span>
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="text-xs"
          onClick={() => setIsOpen(!isOpen)}
        >
          <Layers className="size-3.5 mr-1" />
          Saved Sequences
          {sequences && sequences.length > 0 && (
            <span className="ml-1 text-text-muted">({sequences.length})</span>
          )}
          <ChevronDown
            className={`size-3.5 ml-1 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </Button>
        <Button variant="outline" size="sm" className="text-xs" onClick={onNew}>
          <Plus className="size-3.5 mr-1" />
          New Sequence
        </Button>
      </div>

      {isOpen && (
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="p-3 space-y-1">
            {!sequences || sequences.length === 0 ? (
              <p className="text-xs text-text-muted text-center py-3">
                No saved sequences yet
              </p>
            ) : (
              sequences.map((seq) => (
                <div
                  key={seq.id}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-all ${
                    activeSequenceId === seq.id
                      ? "bg-brand-primary/10 border border-brand-primary/30"
                      : "hover:bg-surface-hover border border-transparent"
                  }`}
                  onClick={() => {
                    onLoad(seq.id);
                    setIsOpen(false);
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {seq.name}
                      </span>
                      {seq.has_schedule && (
                        <Calendar className="size-3 text-brand-primary shrink-0" />
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted">
                      {seq.workflow_count} workflow
                      {seq.workflow_count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-text-muted hover:text-red-400 hover:bg-red-400/10 shrink-0"
                    disabled={deletingId === seq.id}
                    onClick={async (e) => {
                      e.stopPropagation();
                      setDeletingId(seq.id);
                      try {
                        await onDelete(seq.id);
                      } finally {
                        setDeletingId(null);
                      }
                    }}
                  >
                    {deletingId === seq.id ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <Trash2 className="size-3" />
                    )}
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
