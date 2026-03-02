"use client";

import React, { useState, useRef, useCallback } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  WorkflowDocumentation,
  WorkflowDocumentationService,
} from "@/services/workflow-documentation-service";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useDocumentationEditor } from "./_hooks/useDocumentationEditor";
import { useEditorActions } from "./_hooks/useEditorActions";
import { EditorHeader } from "./_components/EditorHeader";
import { EditorToolbar } from "./_components/EditorToolbar";
import { TableOfContents, extractTOC } from "./_components/TableOfContents";
import { MarkdownPreview } from "./_components/MarkdownPreview";

// ============================================================================
// Props
// ============================================================================

export interface DocumentationEditorProps {
  workflow: Workflow;
  documentation?: WorkflowDocumentation;
  onSave: (content: string) => void;
  onCancel: () => void;
  onGenerateAuto: () => void;
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

export function DocumentationEditor({
  workflow,
  documentation,
  onSave,
  onCancel,
  onGenerateAuto,
  className,
}: DocumentationEditorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { content, setContent, autoSaveStatus, handleSave } =
    useDocumentationEditor(workflow.id, documentation);

  const { toolbarActions, insertWorkflowElement } = useEditorActions(
    content,
    setContent,
    textareaRef
  );

  const docService = WorkflowDocumentationService.getInstance();
  const templates = docService.getTemplates();

  const applyTemplate = useCallback(
    (templateName: string) => {
      const template = templates.find((t) => t.name === templateName);
      if (template) {
        let templateContent = template.content;
        templateContent = templateContent.replace(
          /{workflow\.name}/g,
          workflow.name
        );
        templateContent = templateContent.replace(
          /{workflow\.description}/g,
          workflow.description || ""
        );
        templateContent = templateContent.replace(
          /{workflow\.version}/g,
          workflow.version
        );
        setContent(templateContent);
        setSelectedTemplate(templateName);
      }
    },
    [
      templates,
      workflow.name,
      workflow.description,
      workflow.version,
      setContent,
    ]
  );

  const handleExport = useCallback(
    (format: "markdown" | "html") => {
      const blob = new Blob([content], {
        type: format === "html" ? "text/html" : "text/markdown",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${workflow.name}-docs.${format === "html" ? "html" : "md"}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [content, workflow.name]
  );

  const toc = extractTOC(content);
  const workflowElements = insertWorkflowElement(workflow);

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      <EditorHeader
        workflowName={workflow.name}
        autoSaveStatus={autoSaveStatus}
        showPreview={showPreview}
        selectedTemplate={selectedTemplate}
        templates={templates}
        onTogglePreview={() => setShowPreview(!showPreview)}
        onApplyTemplate={applyTemplate}
        onExport={handleExport}
        onGenerateAuto={onGenerateAuto}
        onCancel={onCancel}
        onSave={() => handleSave(onSave)}
      />

      <EditorToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        toolbarActions={toolbarActions}
        workflowElementActions={workflowElements}
      />

      {/* Editor and Preview */}
      <div className="flex flex-1 min-h-0">
        <TableOfContents
          items={toc}
          content={content}
          textareaRef={textareaRef}
        />

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          <ScrollArea className="flex-1">
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Start writing your documentation in Markdown..."
              className="min-h-full w-full border-0 rounded-none resize-none font-mono text-sm p-4 focus-visible:ring-0"
              style={{ minHeight: "100%" }}
            />
          </ScrollArea>
        </div>

        {showPreview && <MarkdownPreview content={content} />}
      </div>
    </div>
  );
}
