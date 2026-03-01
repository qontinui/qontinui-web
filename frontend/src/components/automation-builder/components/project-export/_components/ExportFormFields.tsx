import React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ExportFormFieldsProps {
  exportName: string;
  description: string;
  onExportNameChange: (name: string) => void;
  onDescriptionChange: (desc: string) => void;
}

export function ExportFormFields({
  exportName,
  description,
  onExportNameChange,
  onDescriptionChange,
}: ExportFormFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="exportName">Project Name</Label>
        <Input
          id="exportName"
          value={exportName}
          onChange={(e) => onExportNameChange(e.target.value)}
          placeholder="Enter project name"
          className="bg-surface-canvas border-border-default"
          data-ui-id="automation-export-name-input"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Add a description for this export..."
          className="bg-surface-canvas border-border-default min-h-[80px]"
          data-ui-id="automation-export-description-input"
        />
      </div>
    </>
  );
}
