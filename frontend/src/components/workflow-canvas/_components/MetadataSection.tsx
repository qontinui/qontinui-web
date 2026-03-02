"use client";

import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileText } from "lucide-react";
import type {
  WorkflowSectionProps,
  UpdateMetadataFn,
} from "./WorkflowPropertiesTypes";

interface MetadataSectionProps extends WorkflowSectionProps {
  onUpdate: UpdateMetadataFn;
}

export const MetadataSection: React.FC<MetadataSectionProps> = ({
  workflow,
  onUpdate,
}) => {
  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <FileText className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-text-secondary">
          Workflow Metadata
        </h3>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Name</Label>
          <Input
            value={workflow.name}
            onChange={(e) => onUpdate("name", e.target.value)}
            className="bg-transparent border-border-default text-text-secondary"
            placeholder="My Workflow"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Version</Label>
          <Input
            value={workflow.version}
            onChange={(e) => onUpdate("version", e.target.value)}
            className="bg-transparent border-border-default text-text-secondary"
            placeholder="1.0.0"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Description</Label>
          <Textarea
            value={workflow.metadata?.description || ""}
            onChange={(e) => onUpdate("description", e.target.value)}
            className="bg-transparent border-border-default text-text-secondary min-h-[80px]"
            placeholder="Describe what this workflow does..."
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-text-muted">Author</Label>
          <Input
            value={workflow.metadata?.author || ""}
            onChange={(e) => onUpdate("author", e.target.value)}
            className="bg-transparent border-border-default text-text-secondary"
            placeholder="Your name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Created</Label>
            <div className="text-sm text-text-secondary">
              {workflow.metadata?.created
                ? new Date(
                    workflow.metadata.created as string
                  ).toLocaleDateString()
                : "Unknown"}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-text-muted">Updated</Label>
            <div className="text-sm text-text-secondary">
              {workflow.metadata?.updated
                ? new Date(
                    workflow.metadata.updated as string
                  ).toLocaleDateString()
                : "Unknown"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
