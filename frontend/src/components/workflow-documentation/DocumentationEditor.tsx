"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  WorkflowDocumentation,
  WorkflowDocumentationService,
} from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link2,
  Image,
  Table,
  FileCode,
  Sparkles,
  Save,
  X,
  Download,
  Search,
  Eye,
  Plus,
  CheckCircle2,
  Clock,
  FileText,
  GitBranch,
  Calculator,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  const [content, setContent] = useState(documentation?.content || "");
  const [searchQuery, setSearchQuery] = useState("");
  const [showPreview, setShowPreview] = useState(true);
  const [autoSaveStatus, setAutoSaveStatus] = useState<
    "saved" | "saving" | "unsaved"
  >("saved");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout>();

  const docService = WorkflowDocumentationService.getInstance();
  const templates = docService.getTemplates();

  // Auto-save functionality
  useEffect(() => {
    if (content !== documentation?.content) {
      setAutoSaveStatus("unsaved");

      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      autoSaveTimeoutRef.current = setTimeout(() => {
        setAutoSaveStatus("saving");
        // Save to localStorage as draft
        localStorage.setItem(`doc-draft-${workflow.id}`, content);
        setTimeout(() => setAutoSaveStatus("saved"), 500);
      }, 2000);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [content, documentation, workflow.id]);

  // Load draft on mount
  useEffect(() => {
    const draft = localStorage.getItem(`doc-draft-${workflow.id}`);
    if (draft && !documentation?.content) {
      setContent(draft);
    }
  }, [workflow.id, documentation]);

  // Insert text at cursor position
  const insertAtCursor = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = content.substring(0, start);
      const after = content.substring(end);

      setContent(before + text + after);

      // Set cursor position after inserted text
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
      }, 0);
    },
    [content]
  );

  // Wrap selected text with formatting
  const wrapSelection = useCallback(
    (prefix: string, suffix: string = prefix) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);
      const before = content.substring(0, start);
      const after = content.substring(end);

      const newText = `${before}${prefix}${selectedText}${suffix}${after}`;
      setContent(newText);

      // Restore selection
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, end + prefix.length);
      }, 0);
    },
    [content]
  );

  // Markdown toolbar actions
  const toolbarActions = {
    bold: () => wrapSelection("**"),
    italic: () => wrapSelection("*"),
    code: () => wrapSelection("`"),
    h1: () => insertAtCursor("# "),
    h2: () => insertAtCursor("## "),
    h3: () => insertAtCursor("### "),
    unorderedList: () => insertAtCursor("- "),
    orderedList: () => insertAtCursor("1. "),
    link: () => wrapSelection("[", "](url)"),
    image: () => insertAtCursor("![alt text](image-url)"),
    table: () =>
      insertAtCursor(
        "\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n"
      ),
    codeBlock: () => insertAtCursor("\n```\ncode here\n```\n"),
    mermaidDiagram: () =>
      insertAtCursor("\n```mermaid\ngraph TD\n    A[Start] --> B[End]\n```\n"),
  };

  // Insert workflow elements
  const insertWorkflowElement = {
    actionsList: () => {
      const list = workflow.actions
        .map(
          (action, idx) =>
            `${idx + 1}. **${action.name || action.id}** (\`${action.type}\`)`
        )
        .join("\n");
      insertAtCursor(`\n## Actions\n\n${list}\n`);
    },
    variablesTable: () => {
      const table = docService.generateVariablesTable(workflow);
      insertAtCursor(`\n${table}\n`);
    },
    flowchart: () => {
      const flowchart = docService.generateFlowchart(workflow);
      insertAtCursor(`\n${flowchart}\n`);
    },
    complexityMetrics: () => {
      const metrics = docService.generateDependenciesList(workflow);
      insertAtCursor(`\n${metrics}\n`);
    },
    dependencies: () => {
      const deps = docService.generateDependenciesList(workflow);
      insertAtCursor(`\n${deps}\n`);
    },
  };

  // Apply template
  const applyTemplate = (templateName: string) => {
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
  };

  // Export functionality
  const handleExport = (format: "markdown" | "html") => {
    const blob = new Blob([content], {
      type: format === "html" ? "text/html" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${workflow.name}-docs.${format === "html" ? "html" : "md"}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Search in documentation (currently unused but kept for future implementation)
  // const highlightedContent = searchQuery
  //   ? content.replace(new RegExp(searchQuery, "gi"), (match) => `**${match}**`)
  //   : content;

  // Generate preview content (simplified - in real implementation would use react-markdown)
  const generatePreview = () => {
    // This is a simplified preview. In production, use react-markdown with:
    // - remark-gfm for GitHub Flavored Markdown
    // - rehype-highlight for syntax highlighting
    // - rehype-mermaid for Mermaid diagrams
    return content.split("\n").map((line, idx) => {
      // Headers
      if (line.startsWith("### ")) {
        return (
          <h3 key={idx} className="text-lg font-semibold mt-4 mb-2">
            {line.slice(4)}
          </h3>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h2 key={idx} className="text-xl font-semibold mt-6 mb-3">
            {line.slice(3)}
          </h2>
        );
      }
      if (line.startsWith("# ")) {
        return (
          <h1 key={idx} className="text-2xl font-bold mt-8 mb-4">
            {line.slice(2)}
          </h1>
        );
      }

      // Lists
      if (line.startsWith("- ")) {
        return (
          <li key={idx} className="ml-4 list-disc">
            {line.slice(2)}
          </li>
        );
      }

      // Code blocks
      if (line.startsWith("```")) {
        return (
          <div
            key={idx}
            className="bg-muted p-2 rounded my-2 font-mono text-sm"
          >
            {line}
          </div>
        );
      }

      // Regular paragraph
      if (line.trim()) {
        return (
          <p key={idx} className="mb-2">
            {line}
          </p>
        );
      }

      return <br key={idx} />;
    });
  };

  // Extract table of contents from content
  const extractTOC = () => {
    const lines = content.split("\n");
    const headers: Array<{ level: number; text: string; id: string }> = [];

    lines.forEach((line, idx) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1]!.length;
        const text = match[2]!.trim();
        const id = `heading-${idx}`;
        headers.push({ level, text, id });
      }
    });

    return headers;
  };

  const toc = extractTOC();

  const handleSave = () => {
    onSave(content);
    localStorage.removeItem(`doc-draft-${workflow.id}`);
    setAutoSaveStatus("saved");
  };

  return (
    <div className={cn("flex flex-col h-full bg-background", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-4 flex-1">
          <div>
            <h2 className="text-lg font-semibold">Edit Documentation</h2>
            <p className="text-sm text-muted-foreground">{workflow.name}</p>
          </div>

          {/* Template Selector */}
          <Select value={selectedTemplate} onValueChange={applyTemplate}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Apply template..." />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.name} value={template.name}>
                  {template.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Auto-save indicator */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {autoSaveStatus === "saved" && (
              <>
                <CheckCircle2 className="size-4 text-green-500" />
                <span>Saved</span>
              </>
            )}
            {autoSaveStatus === "saving" && (
              <>
                <Clock className="size-4 animate-spin" />
                <span>Saving...</span>
              </>
            )}
            {autoSaveStatus === "unsaved" && (
              <>
                <Clock className="size-4" />
                <span>Unsaved changes</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onGenerateAuto}>
            <Sparkles className="size-4" />
            Auto-generate
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowPreview(!showPreview)}
          >
            <Eye className="size-4" />
            {showPreview ? "Hide" : "Show"} Preview
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="size-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => handleExport("markdown")}>
                Export as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport("html")}>
                Export as HTML
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator orientation="vertical" className="h-6" />

          <Button variant="outline" size="sm" onClick={onCancel}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Save className="size-4" />
            Save
          </Button>
        </div>
      </div>

      {/* Markdown Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b bg-muted/30">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.bold}
            title="Bold"
            className="size-8"
          >
            <Bold className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.italic}
            title="Italic"
            className="size-8"
          >
            <Italic className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.code}
            title="Inline code"
            className="size-8"
          >
            <Code className="size-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.h1}
            title="Heading 1"
            className="size-8"
          >
            <Heading1 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.h2}
            title="Heading 2"
            className="size-8"
          >
            <Heading2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.h3}
            title="Heading 3"
            className="size-8"
          >
            <Heading3 className="size-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.unorderedList}
            title="Bullet list"
            className="size-8"
          >
            <List className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.orderedList}
            title="Numbered list"
            className="size-8"
          >
            <ListOrdered className="size-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6" />

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.link}
            title="Insert link"
            className="size-8"
          >
            <Link2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.image}
            title="Insert image"
            className="size-8"
          >
            <Image className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.table}
            title="Insert table"
            className="size-8"
          >
            <Table className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toolbarActions.codeBlock}
            title="Code block"
            className="size-8"
          >
            <FileCode className="size-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6" />

        {/* Insert Workflow Elements */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8">
              <Plus className="size-4" />
              Insert
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={insertWorkflowElement.actionsList}>
              <FileText className="size-4 mr-2" />
              Actions List
            </DropdownMenuItem>
            <DropdownMenuItem onClick={insertWorkflowElement.variablesTable}>
              <Table className="size-4 mr-2" />
              Variables Table
            </DropdownMenuItem>
            <DropdownMenuItem onClick={insertWorkflowElement.dependencies}>
              <GitBranch className="size-4 mr-2" />
              Dependencies
            </DropdownMenuItem>
            <DropdownMenuItem onClick={insertWorkflowElement.flowchart}>
              <GitBranch className="size-4 mr-2" />
              Flowchart (Mermaid)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={insertWorkflowElement.complexityMetrics}>
              <Calculator className="size-4 mr-2" />
              Complexity Metrics
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={toolbarActions.mermaidDiagram}>
              <GitBranch className="size-4 mr-2" />
              Custom Mermaid Diagram
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative w-64">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search in documentation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8"
          />
        </div>
      </div>

      {/* Editor and Preview */}
      <div className="flex flex-1 min-h-0">
        {/* Table of Contents */}
        {toc.length > 0 && (
          <div className="w-48 border-r bg-muted/20">
            <div className="p-3 border-b">
              <h3 className="font-semibold text-sm">Contents</h3>
            </div>
            <ScrollArea className="h-full">
              <div className="p-2 space-y-1">
                {toc.map((item, idx) => (
                  <button
                    key={idx}
                    className={cn(
                      "w-full text-left text-sm px-2 py-1 rounded hover:bg-accent transition-colors",
                      item.level === 1 && "font-semibold",
                      item.level === 2 && "pl-4",
                      item.level === 3 && "pl-6 text-muted-foreground",
                      item.level > 3 && "pl-8 text-muted-foreground text-xs"
                    )}
                    onClick={() => {
                      // Scroll to heading in editor
                      const textarea = textareaRef.current;
                      if (textarea) {
                        const index = content.indexOf(item.text);
                        if (index !== -1) {
                          textarea.focus();
                          textarea.setSelectionRange(index, index);
                        }
                      }
                    }}
                  >
                    {item.text}
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

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

        {/* Preview */}
        {showPreview && (
          <>
            <Separator orientation="vertical" />
            <div className="flex-1 flex flex-col min-w-0">
              <div className="p-3 border-b bg-muted/20">
                <h3 className="font-semibold text-sm">Preview</h3>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
                  {generatePreview()}
                </div>
              </ScrollArea>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
