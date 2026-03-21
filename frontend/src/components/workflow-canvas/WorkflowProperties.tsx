"use client";

import React, { useCallback } from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { Separator } from "@/components/ui/separator";
import { useWorkflowTags } from "./_hooks/use-workflow-tags";
import { useWorkflowVariables } from "./_hooks/use-workflow-variables";
import { MetadataSection } from "./_components/MetadataSection";
import { SettingsSection } from "./_components/SettingsSection";
import { VariablesSection } from "./_components/VariablesSection";
import { TagsSection } from "./_components/TagsSection";
import { GraphExecutionSection } from "./_components/GraphExecutionSection";
import { WorkflowStatisticsSection } from "./_components/WorkflowStatisticsSection";
import { createLogger } from "@/lib/logger";

const log = createLogger("WorkflowProperties");

export interface WorkflowPropertiesProps {
  className?: string;
}

export const WorkflowProperties: React.FC<WorkflowPropertiesProps> = ({
  className = "",
}) => {
  const workflow = useCanvasStore((state) => state.workflow);
  const tags = useWorkflowTags();
  const variables = useWorkflowVariables();

  const updateMetadata = useCallback((key: string, value: unknown) => {
    log.debug("Update metadata:", key, value);
  }, []);

  const updateSettings = useCallback((key: string, value: unknown) => {
    log.debug("Update settings:", key, value);
  }, []);

  if (!workflow) {
    return (
      <div className={`p-4 text-text-muted text-sm ${className}`}>
        No workflow loaded
      </div>
    );
  }

  return (
    <div className={`overflow-y-auto ${className}`}>
      <div className="p-4 space-y-6">
        <MetadataSection workflow={workflow} onUpdate={updateMetadata} />

        <Separator className="bg-border-default" />

        <SettingsSection workflow={workflow} onUpdate={updateSettings} />

        <Separator className="bg-border-default" />

        <VariablesSection
          workflow={workflow}
          newVarName={variables.newVarName}
          setNewVarName={variables.setNewVarName}
          newVarValue={variables.newVarValue}
          setNewVarValue={variables.setNewVarValue}
          newVarScope={variables.newVarScope}
          setNewVarScope={variables.setNewVarScope}
          onAdd={variables.addVariable}
          onRemove={variables.removeVariable}
        />

        <Separator className="bg-border-default" />

        <TagsSection
          workflow={workflow}
          newTag={tags.newTag}
          setNewTag={tags.setNewTag}
          onAdd={tags.addTag}
          onRemove={tags.removeTag}
        />

        <Separator className="bg-border-default" />

        {workflow.connections &&
          Object.keys(workflow.connections).length > 0 && (
            <>
              <GraphExecutionSection workflow={workflow} />
              <Separator className="bg-border-default" />
            </>
          )}

        <WorkflowStatisticsSection workflow={workflow} />
      </div>
    </div>
  );
};
