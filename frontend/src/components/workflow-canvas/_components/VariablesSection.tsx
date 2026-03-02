"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Database, Plus, X } from "lucide-react";
import type { WorkflowSectionProps } from "./WorkflowPropertiesTypes";

interface VariablesSectionProps extends WorkflowSectionProps {
  newVarName: string;
  setNewVarName: (value: string) => void;
  newVarValue: string;
  setNewVarValue: (value: string) => void;
  newVarScope: "local" | "process" | "global";
  setNewVarScope: (value: "local" | "process" | "global") => void;
  onAdd: () => void;
  onRemove: (scope: string, name: string) => void;
}

export const VariablesSection: React.FC<VariablesSectionProps> = ({
  workflow,
  newVarName,
  setNewVarName,
  newVarValue,
  setNewVarValue,
  newVarScope,
  setNewVarScope,
  onAdd,
  onRemove,
}) => {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Database className="w-4 h-4 text-purple-400" />
        <h3 className="text-sm font-semibold text-text-secondary">Variables</h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex gap-2">
            <Select
              value={newVarScope}
              onValueChange={(v) =>
                setNewVarScope(v as "local" | "global" | "process")
              }
            >
              <SelectTrigger className="w-[120px] bg-transparent border-border-default text-text-secondary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-surface-raised border-border-default">
                <SelectItem value="local">Local</SelectItem>
                <SelectItem value="process">Workflow</SelectItem>
                <SelectItem value="global">Global</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={newVarName}
              onChange={(e) => setNewVarName(e.target.value)}
              placeholder="Variable name"
              className="flex-1 bg-transparent border-border-default text-text-secondary"
            />
          </div>
          <div className="flex gap-2">
            <Input
              value={newVarValue}
              onChange={(e) => setNewVarValue(e.target.value)}
              placeholder="Value"
              className="flex-1 bg-transparent border-border-default text-text-secondary"
            />
            <Button
              size="sm"
              onClick={onAdd}
              disabled={!newVarName.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {["local", "process", "global"].map((scope) => {
          const variables =
            workflow.variables?.[scope as keyof typeof workflow.variables];
          if (!variables || Object.keys(variables).length === 0) return null;

          return (
            <div key={scope} className="space-y-2">
              <Label className="text-xs text-text-muted capitalize">
                {scope} Variables
              </Label>
              <div className="space-y-1">
                {Object.entries(variables).map(([name, value]) => (
                  <div
                    key={name}
                    className="flex items-center justify-between p-2 rounded bg-surface-raised/50 border border-border-default"
                  >
                    <div className="flex-1">
                      <div className="text-xs font-mono text-text-secondary">
                        {name}
                      </div>
                      <div className="text-xs text-text-muted truncate">
                        {JSON.stringify(value)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemove(scope, name)}
                      className="h-6 w-6 p-0 hover:bg-red-900/20"
                    >
                      <X className="w-3 h-3 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
