"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StateTemplate } from "../types";

export interface TemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: StateTemplate[];
  onCreateFromTemplate: (template: StateTemplate) => void;
}

export function TemplateDialog({
  open,
  onOpenChange,
  templates,
  onCreateFromTemplate,
}: TemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create from Template</DialogTitle>
          <DialogDescription>
            Choose a template to quickly create a new state
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          {templates.map((template) => (
            <Card
              key={template.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => onCreateFromTemplate(template)}
            >
              <CardHeader>
                <CardTitle className="text-sm">{template.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {template.description}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
