"use client";

import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Trash2, Clock, CheckCircle2, XCircle } from "lucide-react";

interface ExtractionSummary {
  id: string;
  source_urls: string[];
  status: string;
  stats: {
    pages_extracted?: number;
    states_found?: number;
  };
  created_at: string;
}

interface ExtractionHistorySidebarProps {
  extractions: ExtractionSummary[] | undefined;
  activeExtractionId: string | null;
  isDeletingAll: boolean;
  onSelectExtraction: (extractionId: string) => void;
  onDeleteExtraction: (extractionId: string) => void;
  onDeleteAllExtractions: () => void;
}

export function ExtractionHistorySidebar({
  extractions,
  activeExtractionId,
  isDeletingAll,
  onSelectExtraction,
  onDeleteExtraction,
  onDeleteAllExtractions,
}: ExtractionHistorySidebarProps) {
  return (
    <div className="explorer-panel explorer-panel-primary h-full">
      <div className="explorer-panel-header">
        <div className="flex items-center gap-2 flex-1">
          <Clock className="h-4 w-4 text-brand-primary" />
          <span className="explorer-panel-header-title">History</span>
        </div>
        {extractions && extractions.length > 0 && (
          <DestructiveButton
            size="sm"
            onClick={onDeleteAllExtractions}
            disabled={isDeletingAll}
            className="text-red-400/60 hover:text-red-400 hover:bg-red-500/10 h-8 px-2 text-[10px] font-mono"
          >
            {isDeletingAll ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3 mr-1" />
            )}
            PURGE
          </DestructiveButton>
        )}
      </div>

      <ScrollArea className="explorer-panel-content">
        <div className="p-4 space-y-3">
          {extractions && extractions.length > 0 ? (
            <div className="space-y-2">
              {extractions.map((extraction) => {
                const isSelected = activeExtractionId === extraction.id;
                const status = extraction.status;
                return (
                  <div
                    key={extraction.id}
                    className={`
                      p-3 rounded-lg border transition-all cursor-pointer group relative
                      ${
                        isSelected
                          ? "explorer-panel-item-selected"
                          : "explorer-panel-item"
                      }
                    `}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectExtraction(extraction.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectExtraction(extraction.id);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between mb-2 gap-2">
                      <div
                        className={`font-mono text-xs truncate transition-colors ${isSelected ? "text-brand-primary" : "text-text-secondary group-hover:text-brand-primary"}`}
                      >
                        {extraction.source_urls[0]}
                        {extraction.source_urls.length > 1 &&
                          ` +${extraction.source_urls.length - 1}`}
                      </div>
                      <div className="shrink-0">
                        {status === "completed" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-brand-success" />
                        ) : status === "failed" ? (
                          <XCircle className="w-3.5 h-3.5 text-red-500" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 text-brand-primary animate-spin" />
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 mb-2">
                      <span className="badge badge-primary text-[9px] px-1.5 py-0">
                        {extraction.stats.pages_extracted || 0} PG
                      </span>
                      <span className="badge badge-secondary text-[9px] px-1.5 py-0">
                        {extraction.stats.states_found || 0} ST
                      </span>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="text-caption font-mono italic">
                        {new Date(extraction.created_at).toLocaleDateString(
                          [],
                          { month: "short", day: "numeric" }
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 text-red-400/50 hover:text-red-400 hover:bg-red-500/10 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteExtraction(extraction.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <Clock className="empty-state-icon" />
              <p className="text-caption font-mono uppercase tracking-widest">
                Archive Empty
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
