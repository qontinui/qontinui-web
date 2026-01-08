"use client";

import React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Settings, CheckCircle, Flag } from "lucide-react";
import { GlobalExpectationsEditor } from "./GlobalExpectationsEditor";
import { SuccessCriteriaEditor } from "./SuccessCriteriaEditor";
import { CheckpointListEditor } from "./CheckpointListEditor";
import type { WorkflowExpectations } from "@/lib/expectations/types";

interface ExpectationsPanelProps {
  expectations: WorkflowExpectations | undefined;
  onChange: (expectations: WorkflowExpectations) => void;
  availableCheckpoints?: string[];
  availableStates?: string[];
}

/**
 * Main expectations panel that combines all expectation editors
 *
 * Features tabbed interface for:
 * - Global Expectations (workflow-level settings)
 * - Success Criteria (validation rules)
 * - Checkpoints (named validation points)
 *
 * This is the primary interface for configuring workflow expectations
 * in the automation builder.
 */
export function ExpectationsPanel({
  expectations,
  onChange,
  availableCheckpoints = [],
  availableStates = [],
}: ExpectationsPanelProps) {
  const current = expectations || {};

  // Extract checkpoint names from checkpoints object
  const checkpointNames = current.checkpoints
    ? Object.keys(current.checkpoints)
    : [];

  // Combine provided checkpoint names with defined checkpoint names
  const allCheckpoints = Array.from(
    new Set([...availableCheckpoints, ...checkpointNames])
  );

  return (
    <div className="h-full flex flex-col bg-surface-canvas border-l border-border-subtle">
      <Tabs defaultValue="global" className="flex flex-col h-full">
        {/* Tab Headers */}
        <div className="border-b border-border-subtle px-4 pt-4">
          <TabsList className="w-full grid grid-cols-3 bg-surface-raised/50">
            <TabsTrigger
              value="global"
              className="flex items-center gap-2 text-xs"
            >
              <Settings className="w-3 h-3" />
              Global
            </TabsTrigger>
            <TabsTrigger
              value="success"
              className="flex items-center gap-2 text-xs"
            >
              <CheckCircle className="w-3 h-3" />
              Success
            </TabsTrigger>
            <TabsTrigger
              value="checkpoints"
              className="flex items-center gap-2 text-xs"
            >
              <Flag className="w-3 h-3" />
              Checkpoints
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Global Expectations Tab */}
          <TabsContent value="global" className="p-4 m-0">
            <GlobalExpectationsEditor
              expectations={current.global}
              onChange={(global) =>
                onChange({
                  ...current,
                  global,
                })
              }
            />
          </TabsContent>

          {/* Success Criteria Tab */}
          <TabsContent value="success" className="p-4 m-0">
            <SuccessCriteriaEditor
              criteria={current.success_criteria}
              onChange={(success_criteria) =>
                onChange({
                  ...current,
                  success_criteria,
                })
              }
              availableCheckpoints={allCheckpoints}
              availableStates={availableStates}
            />
          </TabsContent>

          {/* Checkpoints Tab */}
          <TabsContent value="checkpoints" className="p-4 m-0">
            <CheckpointListEditor
              checkpoints={current.checkpoints}
              onChange={(checkpoints) =>
                onChange({
                  ...current,
                  checkpoints,
                })
              }
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
