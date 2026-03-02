"use client";

import React from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, Settings } from "lucide-react";
import { useWorkflowBuilder } from "./WorkflowBuilderContext";
import { PromptTemplateEditor } from "./PromptTemplateEditor";
import {
  WORKFLOW_SETTINGS_CONFIG,
  getVisibleSections,
} from "@qontinui/workflow-utils";
import { SectionBlock } from "./_components/settings-panel/SectionBlock";

const SELECT_CLASS =
  "w-full h-9 px-3 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-200 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-600";

export function SettingsPanel() {
  const { state, updateWorkflow, features } = useWorkflowBuilder();
  const workflow = state.workflow;
  const [isOpen, setIsOpen] = React.useState(true);
  const [isPromptTemplateOpen, setIsPromptTemplateOpen] = React.useState(false);

  const visibleSections = getVisibleSections(
    WORKFLOW_SETTINGS_CONFIG,
    features
  );

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none">
            {isOpen ? (
              <ChevronDown className="w-4 h-4 text-zinc-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            )}
            <Settings className="w-4 h-4 text-zinc-400" />
            <span className="text-sm font-medium text-zinc-300">
              Workflow Settings
            </span>
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-3">
            {visibleSections.map((section) => (
              <SectionBlock
                key={section.id}
                section={section}
                workflow={workflow}
                updateWorkflow={updateWorkflow}
                selectClass={SELECT_CLASS}
                onOpenPromptTemplate={() => setIsPromptTemplateOpen(true)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </div>

      <PromptTemplateEditor
        isOpen={isPromptTemplateOpen}
        onClose={() => setIsPromptTemplateOpen(false)}
      />
    </Collapsible>
  );
}
