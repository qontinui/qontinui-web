"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Target,
  Search,
  RefreshCw,
  Filter,
  Layers,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SearchMode } from "@/types/rag-testing";
import type { RAGElement } from "@/types/rag-builder";

interface SearchModePanelProps {
  isSegmentationOnly: boolean;
  searchMode: SearchMode;
  setSearchMode: (mode: SearchMode) => void;
  selectedElementIds: string[];
  setSelectedElementIds: (ids: string[]) => void;
  toggleElementSelection: (id: string) => void;
  elementSelectorOpen: boolean;
  setElementSelectorOpen: (open: boolean) => void;
  ragElements: RAGElement[];
  loadingElements: boolean;
}

export function SearchModePanel({
  isSegmentationOnly,
  searchMode,
  setSearchMode,
  selectedElementIds,
  setSelectedElementIds,
  toggleElementSelection,
  elementSelectorOpen,
  setElementSelectorOpen,
  ragElements,
  loadingElements,
}: SearchModePanelProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Search className="w-4 h-4" />
          Search Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isSegmentationOnly ? (
          <div className="p-3 rounded-lg bg-brand-primary/10 border border-brand-primary/30">
            <div className="flex items-center gap-2 mb-1">
              <Layers className="w-4 h-4 text-brand-primary" />
              <span className="text-sm font-medium text-brand-primary">
                Segmentation Only
              </span>
            </div>
            <p className="text-xs text-text-muted">
              No RAG elements configured. Segmentation will run without element
              matching.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant={searchMode === "filtered" ? "default" : "outline"}
              onClick={() => setSearchMode("filtered")}
              className="text-xs"
            >
              <Filter className="w-3 h-3 mr-1" />
              All Elements
            </Button>
            <Button
              size="sm"
              variant={searchMode === "specific" ? "default" : "outline"}
              onClick={() => setSearchMode("specific")}
              className="text-xs"
            >
              <Target className="w-3 h-3 mr-1" />
              Specific
            </Button>
          </div>
        )}

        {!isSegmentationOnly && searchMode === "specific" && (
          <div className="space-y-2">
            <Dialog
              open={elementSelectorOpen}
              onOpenChange={setElementSelectorOpen}
            >
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full border-border-default hover:border-brand-primary justify-between"
                >
                  <span>
                    {selectedElementIds.length > 0
                      ? `${selectedElementIds.length} selected`
                      : "Select Elements"}
                  </span>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh]">
                <DialogHeader>
                  <DialogTitle>Select RAG Elements</DialogTitle>
                </DialogHeader>
                <ScrollArea className="h-[60vh] pr-4">
                  {loadingElements ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-6 h-6 animate-spin text-text-muted" />
                    </div>
                  ) : ragElements.length === 0 ? (
                    <div className="text-center py-8 text-text-muted">
                      No RAG elements found in this project
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {ragElements.map((element) => (
                        <div
                          key={element.id}
                          className={cn(
                            "flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors",
                            selectedElementIds.includes(element.id)
                              ? "border-brand-primary bg-brand-primary/10"
                              : "border-border-default hover:border-border-subtle"
                          )}
                          role="button"
                          tabIndex={0}
                          onClick={() => toggleElementSelection(element.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleElementSelection(element.id);
                            }
                          }}
                        >
                          <Checkbox
                            checked={selectedElementIds.includes(element.id)}
                            onCheckedChange={() =>
                              toggleElementSelection(element.id)
                            }
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">
                              {element.ocr_text ||
                                element.text_description?.slice(0, 50) ||
                                element.id}
                            </div>
                            {element.text_description && (
                              <div className="text-xs text-text-muted mt-1 line-clamp-2">
                                {element.text_description}
                              </div>
                            )}
                            <div className="flex gap-2 mt-2">
                              {element.element_type && (
                                <Badge variant="secondary" className="text-xs">
                                  {element.element_type}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
                <div className="flex justify-between items-center pt-4 border-t">
                  <span className="text-sm text-text-muted">
                    {selectedElementIds.length} selected
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedElementIds([])}
                    >
                      Clear
                    </Button>
                    <Button onClick={() => setElementSelectorOpen(false)}>
                      Done
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
