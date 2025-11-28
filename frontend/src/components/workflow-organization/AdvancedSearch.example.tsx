/**
 * Advanced Search & Bulk Operations Example
 *
 * Demonstrates how to use AdvancedSearch and BulkOperations together
 * for powerful workflow management.
 */

import React, { useState } from "react";
import { AdvancedSearch } from "./AdvancedSearch";
import { BulkOperations } from "./BulkOperations";
import { WorkflowFolder, SearchFilter, SavedFilter } from "./types";
import { Workflow } from "../../lib/action-schema/action-types";

// ============================================================================
// Example Component
// ============================================================================

export function WorkflowManagementExample() {
  // State
  const [workflows, setWorkflows] = useState<Workflow[]>(EXAMPLE_WORKFLOWS);
  const [folders, setFolders] = useState<WorkflowFolder[]>(EXAMPLE_FOLDERS);
  const [filteredWorkflows, setFilteredWorkflows] =
    useState<Workflow[]>(workflows);
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  const [currentFilter, setCurrentFilter] = useState<SearchFilter>({});

  // Get selected workflow objects
  const selectedWorkflows = workflows.filter((w) =>
    selectedWorkflowIds.includes(w.id)
  );

  // Handlers
  const handleSearch = (results: Workflow[], filter: SearchFilter) => {
    setFilteredWorkflows(results);
    setCurrentFilter(filter);
  };

  const handleSaveFilter = (name: string, filter: SearchFilter) => {
    const newFilter: SavedFilter = {
      id: `filter-${Date.now()}`,
      name,
      filter,
      createdAt: new Date(),
    };
    setSavedFilters([...savedFilters, newFilter]);
  };

  const handleMoveToFolder = (folderId: string) => {
    setWorkflows(
      workflows.map((w) =>
        selectedWorkflowIds.includes(w.id) ? ({ ...w, folderId } as any) : w
      )
    );
    setSelectedWorkflowIds([]);
  };

  const handleAddTags = (tags: string[]) => {
    setWorkflows(
      workflows.map((w) => {
        if (selectedWorkflowIds.includes(w.id)) {
          const existingTags = w.tags || [];
          const newTags = Array.from(new Set([...existingTags, ...tags]));
          return { ...w, tags: newTags };
        }
        return w;
      })
    );
    setSelectedWorkflowIds([]);
  };

  const handleRemoveTags = (tags: string[]) => {
    setWorkflows(
      workflows.map((w) => {
        if (selectedWorkflowIds.includes(w.id)) {
          const newTags = (w.tags || []).filter((t) => !tags.includes(t));
          return { ...w, tags: newTags };
        }
        return w;
      })
    );
    setSelectedWorkflowIds([]);
  };

  const handleChangeCategory = (category: string) => {
    setWorkflows(
      workflows.map((w) =>
        selectedWorkflowIds.includes(w.id) ? { ...w, category } : w
      )
    );
    setSelectedWorkflowIds([]);
  };

  const handleDelete = () => {
    setWorkflows(workflows.filter((w) => !selectedWorkflowIds.includes(w.id)));
    setSelectedWorkflowIds([]);
  };

  const handleExport = () => {
    const data = JSON.stringify(selectedWorkflows, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflows-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDuplicate = () => {
    const duplicates = selectedWorkflows.map((w) => ({
      ...w,
      id: `${w.id}-copy-${Date.now()}`,
      name: `${w.name} (Copy)`,
    }));
    setWorkflows([...workflows, ...duplicates]);
    setSelectedWorkflowIds([]);
  };

  const handleRunTests = () => {
    console.log(
      "Running tests for:",
      selectedWorkflows.map((w) => w.name)
    );
    // Implementation would trigger actual test execution
  };

  const toggleWorkflowSelection = (workflowId: string) => {
    if (selectedWorkflowIds.includes(workflowId)) {
      setSelectedWorkflowIds(
        selectedWorkflowIds.filter((id) => id !== workflowId)
      );
    } else {
      setSelectedWorkflowIds([...selectedWorkflowIds, workflowId]);
    }
  };

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Workflow Management</h1>
          <p className="text-muted-foreground">
            Search, filter, and manage workflows with powerful bulk operations
          </p>
        </div>

        {/* Advanced Search */}
        <AdvancedSearch
          workflows={workflows}
          folders={folders}
          onSearch={handleSearch}
          onSaveFilter={handleSaveFilter}
          savedFilters={savedFilters}
        />

        {/* Results Grid */}
        <div className="border rounded-lg bg-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              Workflows ({filteredWorkflows.length})
            </h2>
            <div className="text-sm text-muted-foreground">
              {selectedWorkflowIds.length > 0 &&
                `${selectedWorkflowIds.length} selected`}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkflows.map((workflow) => (
              <div
                key={workflow.id}
                className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                  selectedWorkflowIds.includes(workflow.id)
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/50"
                }`}
                onClick={() => toggleWorkflowSelection(workflow.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold">{workflow.name}</h3>
                  <input
                    type="checkbox"
                    checked={selectedWorkflowIds.includes(workflow.id)}
                    onChange={() => {}}
                    className="rounded"
                  />
                </div>
                {workflow.description && (
                  <p className="text-sm text-muted-foreground mb-2">
                    {workflow.description}
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  {workflow.tags?.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-secondary px-2 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                  {workflow.category && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                      {workflow.category}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {filteredWorkflows.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No workflows found matching your filters
            </div>
          )}
        </div>

        {/* Bulk Operations */}
        <BulkOperations
          selectedWorkflows={selectedWorkflows}
          folders={folders}
          onClearSelection={() => setSelectedWorkflowIds([])}
          onMoveToFolder={handleMoveToFolder}
          onAddTags={handleAddTags}
          onRemoveTags={handleRemoveTags}
          onChangeCategory={handleChangeCategory}
          onDelete={handleDelete}
          onExport={handleExport}
          onRunTests={handleRunTests}
          onDuplicate={handleDuplicate}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Example Data
// ============================================================================

const EXAMPLE_FOLDERS: WorkflowFolder[] = [
  {
    id: "folder-1",
    name: "Automation",
    parentId: null,
    color: "#3b82f6",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    order: 0,
  },
  {
    id: "folder-2",
    name: "Testing",
    parentId: null,
    color: "#10b981",
    createdAt: new Date("2024-01-02"),
    updatedAt: new Date("2024-01-02"),
    order: 1,
  },
  {
    id: "folder-3",
    name: "Utilities",
    parentId: null,
    color: "#f59e0b",
    createdAt: new Date("2024-01-03"),
    updatedAt: new Date("2024-01-03"),
    order: 2,
  },
];

const EXAMPLE_WORKFLOWS: Workflow[] = [
  {
    id: "workflow-1",
    name: "Login Flow",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "action-1",
        type: "FIND",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
      {
        id: "action-2",
        type: "CLICK",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
      {
        id: "action-3",
        type: "TYPE",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
    ],
    connections: { "action-1": ["action-2"], "action-2": ["action-3"] },
    category: "Main",
    description: "Automated login workflow",
    tags: ["authentication", "login"],
    metadata: {
      created: "2024-01-10T10:00:00Z",
      updated: "2024-01-15T14:30:00Z",
    },
  },
  {
    id: "workflow-2",
    name: "Data Processing",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "action-1",
        type: "MAP",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
      {
        id: "action-2",
        type: "FILTER",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
      {
        id: "action-3",
        type: "REDUCE",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
    ],
    connections: { "action-1": ["action-2"], "action-2": ["action-3"] },
    category: "Utility",
    description: "Process and transform data",
    tags: ["data", "processing", "utility"],
    metadata: {
      created: "2024-01-12T11:00:00Z",
      updated: "2024-01-16T09:15:00Z",
    },
  },
  {
    id: "workflow-3",
    name: "UI Test Suite",
    version: "1.0.0",
    format: "graph",
    actions: [
      {
        id: "action-1",
        type: "IF",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
      {
        id: "action-2",
        type: "FIND",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
      {
        id: "action-3",
        type: "CLICK",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
      {
        id: "action-4",
        type: "EXISTS",
        config: {} as any,
        position: { x: 0, y: 0 },
      },
    ],
    connections: {
      "action-1": ["action-2", "action-4"],
      "action-2": ["action-3"],
    },
    category: "Testing",
    description: "Comprehensive UI testing",
    tags: ["testing", "ui", "validation"],
    initialScreenshotId: "screenshot-1",
    metadata: {
      created: "2024-01-14T13:00:00Z",
      updated: "2024-01-18T16:45:00Z",
    },
  },
];

// ============================================================================
// Export for Storybook/Testing
// ============================================================================

export default {
  title: "Workflow Organization/Advanced Search & Bulk Operations",
  component: WorkflowManagementExample,
};
