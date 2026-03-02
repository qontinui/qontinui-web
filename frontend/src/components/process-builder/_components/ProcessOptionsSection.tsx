"use client";

import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronRight } from "lucide-react";
import { IntegrationTestConfig } from "./IntegrationTestConfig";
import { TransitionConfig } from "./TransitionConfig";
import type { Workflow } from "@/lib/action-schema/action-types";

interface Screenshot {
  id: string;
  name: string;
}

interface State {
  id: string;
  name: string;
}

interface ProcessOptionsSectionProps {
  selectedProcess: Workflow;
  optionsExpanded: boolean;
  allCategories: string[];
  screenshots: Screenshot[];
  states: State[];
  onOptionsToggle: (open: boolean) => void;
  onUpdateProcess: (updated: Workflow) => void;
  onCreateOutgoingTransition: () => void;
  onCreateIncomingTransition: () => void;
}

export function ProcessOptionsSection({
  selectedProcess,
  optionsExpanded,
  allCategories,
  screenshots,
  states,
  onOptionsToggle,
  onUpdateProcess,
  onCreateOutgoingTransition,
  onCreateIncomingTransition,
}: ProcessOptionsSectionProps) {
  return (
    <details
      className="group"
      open={optionsExpanded}
      onToggle={(e) => onOptionsToggle((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex items-center justify-between cursor-pointer text-xs text-text-secondary hover:text-brand-primary transition-colors list-none py-1 px-2 bg-surface-raised/30 rounded">
        <span className="font-medium">Options</span>
        <ChevronRight className="w-3 h-3 group-open:rotate-90 transition-transform" />
      </summary>
      <div className="mt-2 space-y-3 pl-2 border-l-2 border-border-default">
        <Textarea
          value={selectedProcess.description}
          onChange={(e) => {
            const updated = {
              ...selectedProcess,
              description: e.target.value,
            };
            onUpdateProcess(updated);
          }}
          className="bg-transparent border-border-default focus:border-brand-primary"
          placeholder="Process description"
          rows={2}
        />

        <div className="flex items-center gap-2">
          <p className="text-sm text-text-muted">Category:</p>
          <Select
            value={selectedProcess.category || "Main"}
            onValueChange={(value) => {
              const updated = { ...selectedProcess, category: value };
              onUpdateProcess(updated);
            }}
          >
            <SelectTrigger className="w-48 bg-transparent border-border-default">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allCategories.map((category) => (
                <SelectItem
                  key={category}
                  value={category}
                  title={
                    category === "Main"
                      ? "Processes in the Main category are available for execution in the Qontinui-Runner desktop application"
                      : undefined
                  }
                >
                  {category}
                  {category === "Main" && (
                    <span className="ml-2 text-xs text-text-muted">
                      - Runner executable
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <IntegrationTestConfig
          selectedProcess={selectedProcess}
          screenshots={screenshots}
          states={states}
          onUpdateProcess={onUpdateProcess}
        />

        <TransitionConfig
          onCreateOutgoing={onCreateOutgoingTransition}
          onCreateIncoming={onCreateIncomingTransition}
        />
      </div>
    </details>
  );
}
