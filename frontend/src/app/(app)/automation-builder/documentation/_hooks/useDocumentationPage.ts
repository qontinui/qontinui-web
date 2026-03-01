import { useState, useMemo } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  WorkflowDocumentation,
  WorkflowDocumentationService,
} from "@/services/workflow-documentation-service";
import {
  DocumentationNode,
  DocumentationFilter,
  generateMockWorkflows,
  buildDocumentationTree,
  calculateDocStats,
} from "../documentation-utils";

export function useDocumentationPage() {
  const docService = WorkflowDocumentationService.getInstance();

  const [workflows] = useState<Workflow[]>(() => generateMockWorkflows());
  const [selectedNode, setSelectedNode] = useState<DocumentationNode | null>(
    null
  );
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [filter, setFilter] = useState<DocumentationFilter>({
    status: "all",
    recentlyUpdated: false,
    searchQuery: "",
  });
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const docsMap = useMemo(() => {
    const map = new Map<string, WorkflowDocumentation>();
    workflows.forEach((wf) => {
      const doc = docService.getDocumentation(wf.id);
      if (doc) {
        map.set(wf.id, doc);
      }
    });
    return map;
  }, [workflows, docService]);

  const tree = useMemo(
    () => buildDocumentationTree(workflows, docsMap),
    [workflows, docsMap]
  );

  const stats = useMemo(
    () => calculateDocStats(workflows, docsMap),
    [workflows, docsMap]
  );

  const selectedWorkflow = selectedNode?.workflow || null;
  const selectedDocumentation = selectedWorkflow
    ? docService.getDocumentation(selectedWorkflow.id)
    : null;

  const handleSelectNode = (node: DocumentationNode) => {
    setSelectedNode(node);
    setMode("view");
  };

  const handleSaveDocumentation = (content: string) => {
    if (!selectedWorkflow) return;

    if (selectedDocumentation) {
      docService.updateDocumentation(selectedWorkflow.id, content);
    } else {
      docService.createDocumentation(selectedWorkflow.id, content);
    }

    setMode("view");
    window.location.reload();
  };

  const handleGenerateAuto = () => {
    if (!selectedWorkflow) return;

    const generated = docService.generateDocumentation(selectedWorkflow);
    docService.createDocumentation(selectedWorkflow.id, generated);
    setMode("view");
    window.location.reload();
  };

  const handleDeleteDocumentation = () => {
    if (!selectedWorkflow) return;
    docService.deleteDocumentation(selectedWorkflow.id);
    setShowDeleteDialog(false);
    setMode("view");
    window.location.reload();
  };

  const handleExportAll = () => {
    const exportData: Record<
      string,
      { documentation: WorkflowDocumentation; workflowName: string }
    > = {};
    workflows.forEach((wf) => {
      const doc = docService.getDocumentation(wf.id);
      if (doc) {
        exportData[wf.id] = {
          documentation: doc,
          workflowName: wf.name,
        };
      }
    });

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `documentation-export-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importData = JSON.parse(text) as Record<
          string,
          { documentation: WorkflowDocumentation; workflowName: string }
        >;

        let importedCount = 0;
        Object.entries(importData).forEach(([workflowId, data]) => {
          const workflow = workflows.find(
            (wf) => wf.id === workflowId || wf.name === data.workflowName
          );
          if (workflow) {
            const existing = docService.getDocumentation(workflow.id);
            if (existing) {
              docService.updateDocumentation(
                workflow.id,
                data.documentation.content,
                "Imported from file"
              );
            } else {
              docService.createDocumentation(
                workflow.id,
                data.documentation.content,
                {
                  format: data.documentation.format,
                  tags: data.documentation.tags,
                }
              );
            }
            importedCount++;
          }
        });

        alert(`Successfully imported ${importedCount} documentation entries.`);
        window.location.reload();
      } catch (err) {
        alert(
          `Failed to import documentation: ${err instanceof Error ? err.message : "Unknown error"}`
        );
      }
    };
    input.click();
  };

  const handleGenerateAll = () => {
    workflows.forEach((wf) => {
      if (!docService.getDocumentation(wf.id)) {
        const generated = docService.generateDocumentation(wf);
        docService.createDocumentation(wf.id, generated);
      }
    });
    window.location.reload();
  };

  return {
    workflows,
    selectedNode,
    mode,
    setMode,
    filter,
    setFilter,
    showDeleteDialog,
    setShowDeleteDialog,
    tree,
    stats,
    selectedWorkflow,
    selectedDocumentation,
    handleSelectNode,
    handleSaveDocumentation,
    handleGenerateAuto,
    handleDeleteDocumentation,
    handleExportAll,
    handleImport,
    handleGenerateAll,
  };
}
