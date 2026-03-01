"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { DocumentationEditor } from "@/components/workflow-documentation/DocumentationEditor";
import { DocumentationViewer } from "@/components/workflow-documentation/DocumentationViewer";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText,
  Plus,
  Sparkles,
  Download,
  Upload,
  Eye,
  Edit,
  Trash2,
  MoreVertical,
  History,
} from "lucide-react";
import { RequireProject } from "@/components/require-project";
import { toast } from "sonner";
import { DocumentationNavigator } from "./_components/DocumentationNavigator";
import { DocumentationDashboard } from "./_components/DocumentationDashboard";
import { WorkflowInfoPanel } from "./_components/WorkflowInfoPanel";
import { useDocumentationPage } from "./_hooks/useDocumentationPage";

export default function DocumentationPage() {
  const router = useRouter();
  const {
    workflows,
    mode,
    setMode,
    filter,
    setFilter,
    showDeleteDialog,
    setShowDeleteDialog,
    tree,
    stats,
    selectedNode,
    selectedWorkflow,
    selectedDocumentation,
    handleSelectNode,
    handleSaveDocumentation,
    handleGenerateAuto,
    handleDeleteDocumentation,
    handleExportAll,
    handleImport,
    handleGenerateAll,
  } = useDocumentationPage();

  return (
    <RequireProject pageName="Documentation">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold">Project Documentation</h1>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="border-border hover:border-primary hover:text-primary bg-transparent"
              onClick={() => setMode("edit")}
            >
              <Plus className="size-4 mr-2" />
              New Documentation
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border hover:border-primary hover:text-primary bg-transparent"
              onClick={handleGenerateAll}
            >
              <Sparkles className="size-4 mr-2" />
              Generate All Docs
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border hover:border-green-500 hover:text-green-500 bg-transparent"
              onClick={handleExportAll}
            >
              <Download className="size-4 mr-2" />
              Export Documentation
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-border hover:border-yellow-500 hover:text-yellow-500 bg-transparent"
              onClick={handleImport}
            >
              <Upload className="size-4 mr-2" />
              Import Documentation
            </Button>
          </div>
        </div>

        {/* Three Column Layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left Sidebar - Documentation Navigator (20%) */}
          <div className="w-[20%] min-w-[250px] max-w-[350px]">
            <DocumentationNavigator
              tree={tree}
              selectedNodeId={selectedNode?.id || null}
              onSelectNode={handleSelectNode}
              filter={filter}
              onFilterChange={setFilter}
            />
          </div>

          {/* Center Column - Viewer/Editor (50%) */}
          <div className="flex-1 flex flex-col min-w-0">
            {!selectedWorkflow && (
              <DocumentationDashboard
                stats={stats}
                workflows={workflows}
                onSelectWorkflow={(wf) => {
                  const node = tree
                    .find((n) => n.id === "workflows")
                    ?.children?.flatMap((folder) => folder.children || [])
                    .find((n) => n.workflow?.id === wf.id);
                  if (node) {
                    handleSelectNode(node);
                  }
                }}
              />
            )}

            {selectedWorkflow && (
              <>
                {/* Tabs */}
                <div className="flex items-center gap-4 px-4 py-3 border-b border-border bg-muted/50">
                  <Button
                    size="sm"
                    variant={mode === "view" ? "default" : "ghost"}
                    onClick={() => setMode("view")}
                    disabled={!selectedDocumentation}
                  >
                    <Eye className="size-4 mr-2" />
                    View
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "edit" ? "default" : "ghost"}
                    onClick={() => setMode("edit")}
                  >
                    <Edit className="size-4 mr-2" />
                    Edit
                  </Button>

                  <div className="flex-1" />

                  {selectedDocumentation && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="ghost">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setMode("edit")}>
                          <Edit className="size-4 mr-2" />
                          Edit Documentation
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleGenerateAuto}>
                          <Sparkles className="size-4 mr-2" />
                          Regenerate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem>
                          <Download className="size-4 mr-2" />
                          Export
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <History className="size-4 mr-2" />
                          Version History
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setShowDeleteDialog(true)}
                          className="text-red-400 focus:text-red-400"
                        >
                          <Trash2 className="size-4 mr-2" />
                          Delete Documentation
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0">
                  {mode === "view" && selectedDocumentation && (
                    <DocumentationViewer
                      workflow={selectedWorkflow}
                      documentation={selectedDocumentation}
                      onEdit={() => setMode("edit")}
                    />
                  )}

                  {mode === "edit" && (
                    <DocumentationEditor
                      workflow={selectedWorkflow}
                      documentation={selectedDocumentation || undefined}
                      onSave={handleSaveDocumentation}
                      onCancel={() => setMode("view")}
                      onGenerateAuto={handleGenerateAuto}
                    />
                  )}

                  {mode === "view" && !selectedDocumentation && (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center p-8 max-w-md">
                        <FileText className="size-16 mx-auto mb-4 text-muted-foreground" />
                        <h3 className="text-xl font-semibold mb-2">
                          No Documentation Yet
                        </h3>
                        <p className="text-muted-foreground mb-6">
                          This workflow doesn&apos;t have documentation yet.
                          Create documentation to help others understand how it
                          works.
                        </p>
                        <div className="flex gap-3 justify-center">
                          <Button
                            onClick={() => setMode("edit")}
                            className="bg-primary hover:bg-primary/80 text-primary-foreground"
                          >
                            <Edit className="size-4 mr-2" />
                            Create Documentation
                          </Button>
                          <Button
                            variant="outline"
                            onClick={handleGenerateAuto}
                            className="border-primary text-primary hover:bg-primary/20"
                          >
                            <Sparkles className="size-4 mr-2" />
                            Auto-Generate
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Right Sidebar - Workflow Info (30%) */}
          {selectedWorkflow && (
            <div className="w-[30%] min-w-[300px] max-w-[400px]">
              <WorkflowInfoPanel
                workflow={selectedWorkflow}
                onEdit={() =>
                  router.push(
                    `/automation-builder?workflow=${selectedWorkflow.id}`
                  )
                }
                onRun={() => {
                  router.push(
                    `/automation-builder?workflow=${selectedWorkflow.id}&mode=run`
                  );
                  toast.info("Opening workflow in run mode");
                }}
                onViewTests={() =>
                  router.push(
                    `/automation-builder/testing?workflow=${selectedWorkflow.id}`
                  )
                }
                onViewMetrics={() =>
                  router.push(
                    `/automation-builder/analytics?workflow=${selectedWorkflow.id}`
                  )
                }
              />
            </div>
          )}
        </div>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent className="bg-muted border-border">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Documentation</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete the documentation for &quot;
                {selectedWorkflow?.name}&quot;? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-transparent border-border">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteDocumentation}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </RequireProject>
  );
}
