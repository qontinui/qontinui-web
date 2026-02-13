"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";
import type { State } from "@/stores/automation";

interface StateHeaderProps {
  state: State;
  updateState: (updates: Partial<State>) => void;
}

export function StateHeader({ state, updateState }: StateHeaderProps) {
  return (
    <>
      <CardHeader className="pb-1 flex-shrink-0 px-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-brand-primary">
            State Properties
          </CardTitle>
          <details className="group">
            <summary className="flex items-center gap-1 cursor-pointer text-xs text-text-muted hover:text-brand-primary transition-colors list-none py-1 px-2 bg-surface-raised/30 rounded">
              <span className="font-medium">Options</span>
              <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
            </summary>
            <div className="absolute right-0 mt-1 p-3 space-y-3 bg-surface-raised border border-border-default rounded-lg shadow-lg z-10 w-64">
              <div className="space-y-1">
                <Label className="text-xs text-text-muted">Description</Label>
                <Textarea
                  value={state.description}
                  onChange={(e) => updateState({ description: e.target.value })}
                  className="bg-transparent border-border-default"
                  rows={2}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="initial-state"
                  checked={state.initial || false}
                  onCheckedChange={(checked) =>
                    updateState({ initial: checked as boolean })
                  }
                  className="border-border-subtle data-[state=checked]:bg-brand-primary data-[state=checked]:border-brand-primary"
                />
                <Label
                  htmlFor="initial-state"
                  className="text-xs text-text-muted cursor-pointer"
                >
                  Initial State
                </Label>
              </div>
            </div>
          </details>
        </div>
      </CardHeader>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Label className="text-xs text-text-muted whitespace-nowrap">
          State Name
        </Label>
        <Input
          value={state.name}
          onChange={(e) => updateState({ name: e.target.value })}
          className="bg-transparent border-border-default h-7 text-sm"
        />
      </div>
    </>
  );
}
