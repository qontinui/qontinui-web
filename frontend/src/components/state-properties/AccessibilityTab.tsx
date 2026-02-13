"use client";

import React from "react";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Accessibility } from "lucide-react";
import { TabsContent } from "@/components/ui/tabs";
import type { State } from "@/stores/automation";

interface AccessibilityTabProps {
  state: State;
}

export function AccessibilityTab({ state }: AccessibilityTabProps) {
  return (
    <TabsContent
      value="accessibility"
      className="flex-1 flex flex-col min-h-0 p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <Label className="text-xs text-purple-500">
          Accessibility Selectors
        </Label>
        <Badge className="bg-purple-500/20 text-purple-500 text-xs px-2 border border-purple-500/30">
          {state.stateImages?.filter((img) => img.accessibilitySelector)
            .length || 0}
        </Badge>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto scrollbar-dark pr-2">
        <div className="p-3 bg-surface-raised/50 border border-purple-500/30 rounded-lg space-y-3">
          <div className="flex items-center gap-2">
            <Accessibility className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-medium">
              AI-Optimized Element Selection
            </span>
          </div>
          <p className="text-xs text-text-muted">
            Use accessibility selectors for ref-based element targeting
            (@e1, @e2, etc.). Configure selectors per StateImage in the
            Images tab, or capture the accessibility tree from a connected
            browser.
          </p>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="p-2 bg-surface-canvas/50 rounded border border-border-subtle">
              <div className="text-xs font-medium text-purple-400">
                Total StateImages
              </div>
              <div className="text-lg font-semibold">
                {state.stateImages?.length || 0}
              </div>
            </div>
            <div className="p-2 bg-surface-canvas/50 rounded border border-border-subtle">
              <div className="text-xs font-medium text-purple-400">
                With Accessibility
              </div>
              <div className="text-lg font-semibold">
                {state.stateImages?.filter(
                  (img) => img.searchMode === "accessibility"
                ).length || 0}
              </div>
            </div>
          </div>
        </div>

        {/* List StateImages with accessibility search mode */}
        {state.stateImages?.filter(
          (img) => img.searchMode === "accessibility"
        ).length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-text-secondary">
              StateImages using Accessibility Mode
            </Label>
            {state.stateImages
              .filter((img) => img.searchMode === "accessibility")
              .map((img) => (
                <div
                  key={img.id}
                  className="p-2 bg-surface-canvas/50 rounded border border-purple-500/20 flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Accessibility className="w-3 h-3 text-purple-400" />
                    <span className="text-sm">{img.name}</span>
                  </div>
                  {img.accessibilitySelector?.ref && (
                    <Badge
                      variant="outline"
                      className="text-xs font-mono"
                    >
                      {img.accessibilitySelector.ref}
                    </Badge>
                  )}
                  {img.accessibilitySelector?.role && (
                    <Badge variant="outline" className="text-xs">
                      {Array.isArray(img.accessibilitySelector.role)
                        ? img.accessibilitySelector.role.join(", ")
                        : img.accessibilitySelector.role}
                    </Badge>
                  )}
                </div>
              ))}
          </div>
        )}

        {/* Instructions for no accessibility configured */}
        {state.stateImages?.filter(
          (img) => img.searchMode === "accessibility"
        ).length === 0 && (
          <div className="p-4 border border-dashed border-purple-500/30 rounded-lg text-center">
            <Accessibility className="w-8 h-8 text-purple-500/50 mx-auto mb-2" />
            <p className="text-sm text-text-muted">
              No StateImages configured for accessibility mode.
            </p>
            <p className="text-xs text-text-muted mt-1">
              Set &quot;Search Mode&quot; to &quot;Accessibility&quot; on
              a StateImage in the Images tab.
            </p>
          </div>
        )}
      </div>
    </TabsContent>
  );
}
