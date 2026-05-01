"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PatternEditor } from "../PatternEditor";
import { CheckCircle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExtractedPattern } from "@/types/pattern-optimization";

interface PatternsTabProps {
  patterns: ExtractedPattern[];
  selectedPatterns: Set<string>;
  setSelectedPatterns: (patterns: Set<string>) => void;
  updatePattern: (patternId: string, customMask: string) => void;
}

export function PatternsTab({
  patterns,
  selectedPatterns,
  setSelectedPatterns,
  updatePattern,
}: PatternsTabProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span>Extracted Patterns</span>
          <span className="text-xs text-text-muted">
            {selectedPatterns.size} / {patterns.length} selected
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {patterns.length === 0 ? (
          <div className="text-center py-4 text-text-muted text-sm">
            No patterns extracted yet
          </div>
        ) : (
          <>
            <div className="flex gap-2 mb-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSelectedPatterns(new Set(patterns.map((p) => p.id)))
                }
                className="text-xs border-border-default hover:border-brand-primary"
              >
                Select All
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedPatterns(new Set())}
                className="text-xs border-border-default hover:border-red-500"
              >
                Clear Selection
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {patterns.map((pattern, idx) => {
                const isSelected = selectedPatterns.has(pattern.id);
                return (
                  <div
                    key={pattern.id}
                    className={cn(
                      "border rounded-lg p-2 transition-all",
                      isSelected
                        ? "border-brand-primary bg-brand-primary/10"
                        : "border-border-default"
                    )}
                  >
                    <div
                      role="option"
                      tabIndex={0}
                      aria-selected={isSelected}
                      className="cursor-pointer"
                      onClick={() => {
                        const newSelection = new Set(selectedPatterns);
                        if (isSelected) {
                          newSelection.delete(pattern.id);
                        } else {
                          newSelection.add(pattern.id);
                        }
                        setSelectedPatterns(newSelection);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          const ns = new Set(selectedPatterns);
                          if (isSelected) {
                            ns.delete(pattern.id);
                          } else {
                            ns.add(pattern.id);
                          }
                          setSelectedPatterns(ns);
                        }
                      }}
                    >
                      <div className="aspect-video bg-surface-raised rounded mb-2 flex items-center justify-center overflow-hidden">
                        {pattern.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element -- Base64 data URL from pattern extraction cannot use Next.js Image optimization
                          <img
                            src={
                              pattern.customMask
                                ? pattern.customMask
                                : pattern.imageUrl
                            }
                            alt={`Pattern ${idx + 1}`}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Layers className="w-8 h-8 text-text-muted" />
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">
                          Pattern {idx + 1}
                        </span>
                        {isSelected && (
                          <CheckCircle className="w-4 h-4 text-brand-primary" />
                        )}
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-border-default">
                      <PatternEditor
                        pattern={pattern}
                        onUpdatePattern={updatePattern}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border-default">
              <p className="text-xs text-text-muted mb-2">
                Select the patterns you want to include in the StateImage. At
                least one pattern must be selected.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
