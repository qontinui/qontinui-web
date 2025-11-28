/**
 * Example Usage of Workflow Documentation Components
 *
 * This file demonstrates how to integrate the documentation components
 * into your workflow editor or viewer pages.
 */

"use client";

import { useState, useEffect } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  DocumentationEditor,
  DocumentationViewer,
  ActionCommentsPanel,
} from "@/components/workflow-documentation";
import {
  WorkflowDocumentationService,
  WorkflowDocumentation,
  ActionComment,
} from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileText, MessageSquare, Edit, Eye, Sparkles } from "lucide-react";
import { toast } from "sonner";

// ============================================================================
// Example 1: Simple Documentation Editor/Viewer
// ============================================================================

export function SimpleDocumentationView({ workflow }: { workflow: Workflow }) {
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [documentation, setDocumentation] =
    useState<WorkflowDocumentation | null>(null);

  const docService = WorkflowDocumentationService.getInstance();

  useEffect(() => {
    const doc = docService.getDocumentation(workflow.id);
    setDocumentation(doc);
  }, [workflow.id]);

  const handleSave = (content: string) => {
    try {
      if (documentation) {
        const updated = docService.updateDocumentation(
          workflow.id,
          content,
          "Updated documentation"
        );
        setDocumentation(updated);
      } else {
        const created = docService.createDocumentation(workflow.id, content);
        setDocumentation(created);
      }
      setMode("view");
      toast.success("Documentation saved successfully");
    } catch (error) {
      toast.error("Failed to save documentation");
      console.error(error);
    }
  };

  const handleGenerateAuto = () => {
    try {
      const content = docService.generateDocumentation(workflow);
      const doc = docService.createDocumentation(workflow.id, content);
      setDocumentation(doc);
      setMode("view");
      toast.success("Documentation generated successfully");
    } catch (error) {
      toast.error("Failed to generate documentation");
      console.error(error);
    }
  };

  if (!documentation && mode === "view") {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <FileText className="size-16 mx-auto text-muted-foreground" />
          <h3 className="text-lg font-semibold">No Documentation Yet</h3>
          <p className="text-sm text-muted-foreground">
            Create documentation for this workflow to help your team understand
            its purpose.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button onClick={() => setMode("edit")}>
              <Edit className="size-4" />
              Write Documentation
            </Button>
            <Button variant="outline" onClick={handleGenerateAuto}>
              <Sparkles className="size-4" />
              Auto-Generate
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full">
      {mode === "view" && documentation ? (
        <DocumentationViewer
          workflow={workflow}
          documentation={documentation}
          onEdit={() => setMode("edit")}
        />
      ) : (
        <DocumentationEditor
          workflow={workflow}
          documentation={documentation || undefined}
          onSave={handleSave}
          onCancel={() => setMode("view")}
          onGenerateAuto={handleGenerateAuto}
        />
      )}
    </div>
  );
}

// ============================================================================
// Example 2: Tabbed View with Comments
// ============================================================================

export function TabbedDocumentationView({ workflow }: { workflow: Workflow }) {
  const [documentation, setDocumentation] =
    useState<WorkflowDocumentation | null>(null);
  const [comments, setComments] = useState<ActionComment[]>([]);
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const [mode, setMode] = useState<"view" | "edit">("view");

  const docService = WorkflowDocumentationService.getInstance();

  useEffect(() => {
    loadData();
  }, [workflow.id]);

  const loadData = () => {
    const doc = docService.getDocumentation(workflow.id);
    const cmts = docService.getAllActionComments(workflow.id);
    setDocumentation(doc);
    setComments(cmts);
  };

  const handleSave = (content: string) => {
    try {
      if (documentation) {
        const updated = docService.updateDocumentation(workflow.id, content);
        setDocumentation(updated);
      } else {
        const created = docService.createDocumentation(workflow.id, content);
        setDocumentation(created);
      }
      setMode("view");
      toast.success("Documentation saved");
    } catch (error) {
      toast.error("Failed to save");
    }
  };

  const handleAddComment = (actionId: string, comment: string) => {
    try {
      docService.addActionComment(workflow.id, actionId, comment);
      loadData();
      toast.success("Comment added");
    } catch (error) {
      toast.error("Failed to add comment");
    }
  };

  const handleUpdateComment = (commentId: string, comment: string) => {
    try {
      docService.updateActionComment(commentId, comment);
      loadData();
      toast.success("Comment updated");
    } catch (error) {
      toast.error("Failed to update comment");
    }
  };

  const handleDeleteComment = (commentId: string) => {
    try {
      docService.deleteActionComment(commentId);
      loadData();
      toast.success("Comment deleted");
    } catch (error) {
      toast.error("Failed to delete comment");
    }
  };

  return (
    <Tabs defaultValue="documentation" className="h-full flex flex-col">
      <TabsList className="w-full justify-start border-b rounded-none h-12 px-4">
        <TabsTrigger value="documentation" className="gap-2">
          <FileText className="size-4" />
          Documentation
        </TabsTrigger>
        <TabsTrigger value="comments" className="gap-2">
          <MessageSquare className="size-4" />
          Action Comments ({comments.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="documentation" className="flex-1 m-0">
        {mode === "view" && documentation ? (
          <DocumentationViewer
            workflow={workflow}
            documentation={documentation}
            onEdit={() => setMode("edit")}
          />
        ) : (
          <DocumentationEditor
            workflow={workflow}
            documentation={documentation || undefined}
            onSave={handleSave}
            onCancel={() => setMode("view")}
            onGenerateAuto={() => {
              const content = docService.generateDocumentation(workflow);
              handleSave(content);
            }}
          />
        )}
      </TabsContent>

      <TabsContent value="comments" className="flex-1 m-0">
        <ActionCommentsPanel
          workflow={workflow}
          comments={comments}
          selectedActionId={selectedActionId}
          onAddComment={handleAddComment}
          onUpdateComment={handleUpdateComment}
          onDeleteComment={handleDeleteComment}
        />
      </TabsContent>
    </Tabs>
  );
}

// ============================================================================
// Example 3: Split View with Documentation and Comments Side-by-Side
// ============================================================================

export function SplitDocumentationView({
  workflow,
  selectedActionId,
}: {
  workflow: Workflow;
  selectedActionId?: string;
}) {
  const [documentation, setDocumentation] =
    useState<WorkflowDocumentation | null>(null);
  const [comments, setComments] = useState<ActionComment[]>([]);
  const [mode, setMode] = useState<"view" | "edit">("view");

  const docService = WorkflowDocumentationService.getInstance();

  useEffect(() => {
    loadData();
  }, [workflow.id]);

  const loadData = () => {
    const doc = docService.getDocumentation(workflow.id);
    const cmts = docService.getAllActionComments(workflow.id);
    setDocumentation(doc);
    setComments(cmts);
  };

  const handleSave = (content: string) => {
    try {
      if (documentation) {
        const updated = docService.updateDocumentation(workflow.id, content);
        setDocumentation(updated);
      } else {
        const created = docService.createDocumentation(workflow.id, content);
        setDocumentation(created);
      }
      setMode("view");
      toast.success("Documentation saved");
    } catch (error) {
      toast.error("Failed to save");
    }
  };

  return (
    <div className="h-full flex">
      {/* Documentation - 2/3 width */}
      <div className="flex-[2] border-r">
        {mode === "view" && documentation ? (
          <DocumentationViewer
            workflow={workflow}
            documentation={documentation}
            onEdit={() => setMode("edit")}
          />
        ) : (
          <DocumentationEditor
            workflow={workflow}
            documentation={documentation || undefined}
            onSave={handleSave}
            onCancel={() => setMode("view")}
            onGenerateAuto={() => {
              const content = docService.generateDocumentation(workflow);
              handleSave(content);
            }}
          />
        )}
      </div>

      {/* Action Comments - 1/3 width */}
      <div className="flex-1">
        <ActionCommentsPanel
          workflow={workflow}
          comments={comments}
          selectedActionId={selectedActionId}
          onAddComment={(actionId, comment) => {
            docService.addActionComment(workflow.id, actionId, comment);
            loadData();
            toast.success("Comment added");
          }}
          onUpdateComment={(commentId, comment) => {
            docService.updateActionComment(commentId, comment);
            loadData();
            toast.success("Comment updated");
          }}
          onDeleteComment={(commentId) => {
            docService.deleteActionComment(commentId);
            loadData();
            toast.success("Comment deleted");
          }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Example 4: Documentation in a Modal/Dialog
// ============================================================================

export function DocumentationDialog({
  workflow,
  open,
  onOpenChange,
}: {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [documentation, setDocumentation] =
    useState<WorkflowDocumentation | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");

  const docService = WorkflowDocumentationService.getInstance();

  useEffect(() => {
    if (open) {
      const doc = docService.getDocumentation(workflow.id);
      setDocumentation(doc);
      setMode(doc ? "view" : "edit");
    }
  }, [open, workflow.id]);

  const handleSave = (content: string) => {
    try {
      if (documentation) {
        const updated = docService.updateDocumentation(workflow.id, content);
        setDocumentation(updated);
      } else {
        const created = docService.createDocumentation(workflow.id, content);
        setDocumentation(created);
      }
      setMode("view");
      toast.success("Documentation saved");
    } catch (error) {
      toast.error("Failed to save");
    }
  };

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "hidden"}`}>
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="fixed inset-4 bg-background border rounded-lg shadow-lg overflow-hidden flex flex-col">
        {mode === "view" && documentation ? (
          <DocumentationViewer
            workflow={workflow}
            documentation={documentation}
            onEdit={() => setMode("edit")}
          />
        ) : (
          <DocumentationEditor
            workflow={workflow}
            documentation={documentation || undefined}
            onSave={handleSave}
            onCancel={() => {
              if (documentation) {
                setMode("view");
              } else {
                onOpenChange(false);
              }
            }}
            onGenerateAuto={() => {
              const content = docService.generateDocumentation(workflow);
              handleSave(content);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Example 5: Documentation Button for Workflow Canvas
// ============================================================================

export function DocumentationButton({ workflow }: { workflow: Workflow }) {
  const [open, setOpen] = useState(false);
  const docService = WorkflowDocumentationService.getInstance();
  const hasDoc = docService.hasDocumentation(workflow.id);

  return (
    <>
      <Button
        variant={hasDoc ? "default" : "outline"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        <FileText className="size-4" />
        {hasDoc ? "View Documentation" : "Add Documentation"}
      </Button>

      <DocumentationDialog
        workflow={workflow}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
