/**
 * Folder Tree Example Usage
 *
 * Example showing how to integrate FolderTree into a workflow browser
 */

import React, { useState, useEffect } from "react";
import { FolderTree } from "./FolderTree";
import { useFolderManager } from "./useFolderManager";
import { WorkflowFolder } from "./types";
import { Workflow } from "../../lib/action-schema/action-types";
import { getWorkflowsInFolder } from "./folder-utils";
import { Card } from "../ui/card";
import { Button } from "../ui/button";
import { Download, Upload } from "lucide-react";

/**
 * Example: Workflow Browser with Folder Organization
 */
export function WorkflowBrowserExample() {
  // Example workflows
  const [workflows, setWorkflows] = useState<Workflow[]>([
    {
      id: "wf1",
      name: "Login Automation",
      version: "1.0.0",
      format: "graph",
      actions: [],
      connections: { flow: [], data: [] },
      category: "Authentication",
    } as Workflow,
    {
      id: "wf2",
      name: "Data Entry",
      version: "1.0.0",
      format: "graph",
      actions: [],
      connections: { flow: [], data: [] },
      category: "Forms",
    } as Workflow,
    {
      id: "wf3",
      name: "Report Generation",
      version: "1.0.0",
      format: "graph",
      actions: [],
      connections: { flow: [], data: [] },
    } as Workflow,
  ]);

  // Folder manager
  const { folders, createNewFolder, updateFolder, deleteFolder, moveFolder } =
    useFolderManager({
      initialFolders: [
        {
          id: "folder1",
          name: "Authentication",
          parentId: null,
          color: "#3b82f6",
          icon: "Shield",
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
          order: 0,
        },
        {
          id: "folder2",
          name: "Forms",
          parentId: null,
          color: "#10b981",
          icon: "Folder",
          createdAt: new Date("2024-01-02"),
          updatedAt: new Date("2024-01-02"),
          order: 1,
        },
        {
          id: "folder3",
          name: "Reports",
          parentId: null,
          color: "#f59e0b",
          createdAt: new Date("2024-01-03"),
          updatedAt: new Date("2024-01-03"),
          order: 2,
        },
        {
          id: "folder4",
          name: "User Management",
          parentId: "folder1",
          createdAt: new Date("2024-01-04"),
          updatedAt: new Date("2024-01-04"),
          order: 0,
        },
      ],
      onFoldersChange: (newFolders) => {
        // Persist to backend/localStorage
        console.log("Folders updated:", newFolders);
      },
    });

  // Selected folder
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Get workflows for selected folder
  const filteredWorkflows =
    selectedFolderId === null
      ? workflows
      : selectedFolderId === "uncategorized"
        ? workflows.filter((w) => !(w as { folderId?: string }).folderId)
        : getWorkflowsInFolder(selectedFolderId, workflows, folders, true);

  // Handle folder creation
  const handleCreateFolder = (name: string, parentId?: string | null) => {
    const newFolder = createNewFolder(name, parentId ?? null);
    if (newFolder) {
      console.log("Created folder:", newFolder);
    }
  };

  // Handle workflow move
  const handleMoveWorkflow = (workflowId: string, folderId: string | null) => {
    setWorkflows((prev) =>
      prev.map((w) => {
        if (w.id === workflowId) {
          return {
            ...w,
            folderId: folderId || undefined,
          } as Workflow;
        }
        return w;
      })
    );
  };

  // Export folders
  const handleExport = () => {
    const data = JSON.stringify(folders, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workflow-folders.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import folders
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const imported = JSON.parse(event.target?.result as string);
            // Validate and import
            console.log("Imported folders:", imported);
          } catch (error) {
            console.error("Failed to import folders:", error);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  return (
    <div className="flex h-screen">
      {/* Left sidebar - Folder Tree */}
      <div className="w-80 border-r flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Workflow Folders</h2>
          <div className="flex gap-2 mt-2">
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
            <Button variant="outline" size="sm" onClick={handleImport}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
          </div>
        </div>

        <FolderTree
          folders={folders}
          workflows={workflows}
          selectedFolderId={selectedFolderId}
          onSelectFolder={setSelectedFolderId}
          onCreateFolder={handleCreateFolder}
          onUpdateFolder={updateFolder}
          onDeleteFolder={deleteFolder}
          onMoveFolder={moveFolder}
          onMoveWorkflow={handleMoveWorkflow}
          className="flex-1"
        />
      </div>

      {/* Main content - Workflow List */}
      <div className="flex-1 p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">
            {selectedFolderId === null
              ? "All Workflows"
              : selectedFolderId === "uncategorized"
                ? "Uncategorized Workflows"
                : folders.find((f) => f.id === selectedFolderId)?.name ||
                  "Unknown Folder"}
          </h1>
          <p className="text-muted-foreground">
            {filteredWorkflows.length} workflow(s)
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkflows.map((workflow) => (
            <Card key={workflow.id} className="p-4">
              <h3 className="font-medium">{workflow.name}</h3>
              <p className="text-sm text-muted-foreground mt-1">
                {workflow.actions.length} actions
              </p>
              {workflow.description && (
                <p className="text-sm text-muted-foreground mt-2">
                  {workflow.description}
                </p>
              )}
            </Card>
          ))}
        </div>

        {filteredWorkflows.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p>No workflows in this folder</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Example: Simple Folder Tree Integration
 */
export function SimpleFolderTreeExample() {
  const [folders, setFolders] = useState<WorkflowFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  return (
    <div className="w-96 h-screen border">
      <FolderTree
        folders={folders}
        workflows={[]}
        selectedFolderId={selectedFolderId}
        onSelectFolder={setSelectedFolderId}
        onCreateFolder={(name, parentId) => {
          const newFolder: WorkflowFolder = {
            id: `folder_${Date.now()}`,
            name,
            parentId: parentId || null,
            createdAt: new Date(),
            updatedAt: new Date(),
            order: folders.length,
          };
          setFolders([...folders, newFolder]);
        }}
        onUpdateFolder={(id, updates) => {
          setFolders((prev) =>
            prev.map((f) => (f.id === id ? { ...f, ...updates } : f))
          );
        }}
        onDeleteFolder={(id) => {
          setFolders((prev) => prev.filter((f) => f.id !== id));
        }}
        onMoveFolder={(folderId, newParentId) => {
          setFolders((prev) =>
            prev.map((f) =>
              f.id === folderId ? { ...f, parentId: newParentId } : f
            )
          );
        }}
        onMoveWorkflow={(workflowId, folderId) => {
          console.log("Move workflow", workflowId, "to folder", folderId);
        }}
      />
    </div>
  );
}

/**
 * Example: Folder Tree with Persistence
 */
export function FolderTreeWithPersistence() {
  const [folders, setFolders] = useState<WorkflowFolder[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("workflow-folders");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFolders(
          parsed.map((f: unknown) => {
            const folder = f as { createdAt: string; updatedAt: string };
            return {
              ...(f as Record<string, unknown>),
              createdAt: new Date(folder.createdAt),
              updatedAt: new Date(folder.updatedAt),
            };
          })
        );
      } catch (error) {
        console.error("Failed to load folders:", error);
      }
    }
  }, []);

  // Save to localStorage on change
  useEffect(() => {
    if (folders.length > 0) {
      localStorage.setItem("workflow-folders", JSON.stringify(folders));
    }
  }, [folders]);

  const { createNewFolder, updateFolder, deleteFolder, moveFolder } =
    useFolderManager({
      initialFolders: folders,
      onFoldersChange: setFolders,
    });

  return (
    <FolderTree
      folders={folders}
      workflows={[]}
      selectedFolderId={selectedFolderId}
      onSelectFolder={setSelectedFolderId}
      onCreateFolder={(name, parentId) => {
        createNewFolder(name, parentId ?? null);
      }}
      onUpdateFolder={updateFolder}
      onDeleteFolder={deleteFolder}
      onMoveFolder={moveFolder}
      onMoveWorkflow={(workflowId, folderId) => {
        console.log("Move workflow", workflowId, "to folder", folderId);
      }}
    />
  );
}
