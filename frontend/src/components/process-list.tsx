"use client";

import { useState, DragEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Trash2,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { useAutomation } from "@/contexts/automation-context";
import { DeleteCategoryDialog } from "@/components/delete-category-dialog";
import { DeleteWorkflowDialog } from "@/components/delete-process-dialog";

interface Process {
  id: string;
  name: string;
  description: string;
  category?: string;
  actions: Action[];
}

interface Action {
  id: string;
  type: string;
  config: Record<string, unknown>;
}

interface ProcessListProps {
  processes: Process[];
  selectedProcess: Process | null;
  onSelectProcess: (process: Process) => void;
  onDeleteProcess: (processId: string) => void;
  onUpdateProcess?: (process: Process) => void;
  onCreateProcess?: (category: string) => void;
}

export function ProcessList({
  processes,
  selectedProcess,
  onSelectProcess,
  onDeleteProcess,
  onUpdateProcess,
  onCreateProcess,
}: ProcessListProps) {
  const { categories, addCategory, deleteCategory } = useAutomation();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set()
  );
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showNewCategoryInput, setShowNewCategoryInput] = useState(false);
  const [draggedProcess, setDraggedProcess] = useState<Process | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [deleteCategoryDialog, setDeleteCategoryDialog] = useState<{
    open: boolean;
    category: string;
    processes: Process[];
  }>({ open: false, category: "", processes: [] });
  const [deleteWorkflowDialog, setDeleteWorkflowDialog] = useState<{
    open: boolean;
    processId: string;
    processName: string;
  }>({ open: false, processId: "", processName: "" });

  // Default categories
  const defaultCategories = ["Main", "Transitions"];

  // Get all unique categories from processes
  const processCategories = [
    ...new Set(processes.map((p) => p.category || "Main")),
  ];

  // Combine all categories (default, custom from context, and those from processes)
  const allCategories = [
    ...new Set([...defaultCategories, ...categories, ...processCategories]),
  ];

  // Group processes by category
  const processesByCategory = processes.reduce(
    (acc, process) => {
      const category = process.category || "Main";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(process);
      return acc;
    },
    {} as Record<string, Process[]>
  );

  const handleDelete = (processId: string, processName: string) => {
    setDeleteWorkflowDialog({
      open: true,
      processId,
      processName,
    });
  };

  const handleConfirmDelete = () => {
    const { processId, processName } = deleteWorkflowDialog;
    onDeleteProcess(processId);
    toast.success("Workflow deleted", {
      description: `"${processName}" has been removed.`,
    });
    setDeleteWorkflowDialog({ open: false, processId: "", processName: "" });
  };

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleAddCategory = () => {
    if (newCategoryName && !allCategories.includes(newCategoryName)) {
      addCategory(newCategoryName);
      setNewCategoryName("");
      setShowNewCategoryInput(false);
      toast.success("Category created", {
        description: `"${newCategoryName}" has been added.`,
      });
    }
  };

  const handleDeleteCategory = (category: string) => {
    const processesInCategory = processesByCategory[category] || [];
    if (processesInCategory.length > 0) {
      // Show dialog for categories with processes
      setDeleteCategoryDialog({
        open: true,
        category,
        processes: processesInCategory,
      });
    } else {
      // Directly delete empty categories
      deleteCategory(category);
      toast.success("Category deleted", {
        description: `"${category}" has been deleted.`,
      });
    }
  };

  const handleDeleteAllProcesses = () => {
    const { category, processes: processesInCategory } = deleteCategoryDialog;
    // Delete all processes in this category
    processesInCategory.forEach((process) => {
      onDeleteProcess(process.id);
    });
    // Delete the category
    deleteCategory(category);
    toast.success("Category deleted", {
      description: `"${category}" and all its processes have been deleted.`,
    });
    setDeleteCategoryDialog({ open: false, category: "", processes: [] });
  };

  const handleMoveToMain = () => {
    const { category, processes: processesInCategory } = deleteCategoryDialog;
    // Move all processes in this category to "Main"
    processesInCategory.forEach((process) => {
      if (onUpdateProcess) {
        onUpdateProcess({ ...process, category: "Main" });
      }
    });
    // Delete the category
    deleteCategory(category);
    toast.success("Category deleted", {
      description: `"${category}" has been deleted. All processes moved to Main.`,
    });
    setDeleteCategoryDialog({ open: false, category: "", processes: [] });
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, process: Process) => {
    setDraggedProcess(process);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggedProcess(null);
    setDragOverCategory(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleCategoryDragEnter = (category: string) => {
    setDragOverCategory(category);
  };

  const handleCategoryDragLeave = () => {
    setDragOverCategory(null);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, category: string) => {
    e.preventDefault();
    e.stopPropagation();

    if (draggedProcess && onUpdateProcess) {
      const updatedProcess = { ...draggedProcess, category };
      onUpdateProcess(updatedProcess);
      toast.success("Workflow moved", {
        description: `"${draggedProcess.name}" moved to ${category}`,
      });
    }

    setDraggedProcess(null);
    setDragOverCategory(null);
  };

  const renderProcess = (process: Process) => {
    return (
      <Card
        key={process.id}
        draggable
        onDragStart={(e) => handleDragStart(e, process)}
        onDragEnd={handleDragEnd}
        className={`cursor-pointer transition-all hover:border-[#00D9FF]/50 !py-0 !gap-0 ${
          selectedProcess?.id === process.id
            ? "border-[#00D9FF] bg-[#00D9FF]/10"
            : "border-gray-700 bg-[#27272A]"
        } ${draggedProcess?.id === process.id ? "opacity-50" : ""}`}
        onClick={() => onSelectProcess(process)}
      >
        <CardContent className="py-1 px-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex-1 min-w-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <h4 className="font-medium text-xs truncate">
                    {process.name}
                  </h4>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{process.name}</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="flex items-center gap-1 ml-2">
              <Badge variant="secondary" className="text-[10px] h-4 px-1">
                {process.actions.length}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-4 w-4 p-0 text-gray-400 hover:text-red-400"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(process.id, process.name);
                }}
              >
                <Trash2 className="w-2.5 h-2.5" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <TooltipProvider>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wide">
            Process Library
          </h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-1.5 text-gray-400 hover:text-[#00D9FF] flex items-center gap-1"
            onClick={() => setShowNewCategoryInput(true)}
            title="Add new category"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <Plus className="w-3 h-3" />
          </Button>
        </div>

        {showNewCategoryInput && (
          <div className="flex gap-1">
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCategory();
                if (e.key === "Escape") {
                  setNewCategoryName("");
                  setShowNewCategoryInput(false);
                }
              }}
              placeholder="Category name..."
              className="h-7 text-xs bg-transparent border-gray-700"
              autoFocus
            />
            <Button size="sm" className="h-7 px-2" onClick={handleAddCategory}>
              Add
            </Button>
          </div>
        )}

        <div className="space-y-2">
          {allCategories.map((category) => {
            const categoryProcesses = processesByCategory[category] || [];
            const isDefault = defaultCategories.includes(category);
            const isCollapsed = collapsedCategories.has(category);
            const isCustom = !isDefault;

            return (
              <div
                key={category}
                className={`space-y-1 rounded-lg transition-all ${
                  dragOverCategory === category
                    ? "bg-[#00D9FF]/10 ring-2 ring-[#00D9FF]/50"
                    : ""
                }`}
                onDragOver={handleDragOver}
                onDragEnter={() => handleCategoryDragEnter(category)}
                onDragLeave={handleCategoryDragLeave}
                onDrop={(e) => handleDrop(e, category)}
              >
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 p-0 px-1 text-gray-400 hover:text-white flex-1 justify-start"
                    onClick={() => toggleCategory(category)}
                  >
                    {isCollapsed ? (
                      <>
                        <ChevronRight className="w-3 h-3 mr-1" />
                        <Folder className="w-3 h-3 mr-1" />
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-3 h-3 mr-1" />
                        <FolderOpen className="w-3 h-3 mr-1" />
                      </>
                    )}
                    <span className="text-xs font-medium">
                      {category} ({categoryProcesses.length})
                    </span>
                  </Button>
                  <div className="flex items-center gap-1">
                    {onCreateProcess && (
                      <Button
                        size="sm"
                        className="h-6 w-6 p-0 bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                        onClick={() => onCreateProcess(category)}
                        title={`Create new process in ${category}`}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    )}
                    <div className="w-5" />
                    {isCustom ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-gray-400 hover:text-red-400"
                        onClick={() => handleDeleteCategory(category)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    ) : (
                      <div className="h-6 w-6" />
                    )}
                  </div>
                </div>

                {!isCollapsed && (
                  <div className="ml-4 space-y-1">
                    {categoryProcesses.length === 0 ? (
                      <div className="text-xs text-gray-500 italic py-2">
                        Drop processes here
                      </div>
                    ) : (
                      categoryProcesses.map(renderProcess)
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Uncategorized processes */}
          {Object.keys(processesByCategory).some(
            (cat) => !allCategories.includes(cat)
          ) && (
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Uncategorized</div>
              <div className="ml-4 space-y-1">
                {processes
                  .filter(
                    (p) => p.category && !allCategories.includes(p.category)
                  )
                  .map(renderProcess)}
              </div>
            </div>
          )}
        </div>

        <DeleteCategoryDialog
          open={deleteCategoryDialog.open}
          categoryName={deleteCategoryDialog.category}
          processCount={deleteCategoryDialog.processes.length}
          processNames={deleteCategoryDialog.processes.map((p) => p.name)}
          onClose={() =>
            setDeleteCategoryDialog({
              open: false,
              category: "",
              processes: [],
            })
          }
          onDeleteAll={handleDeleteAllProcesses}
          onMoveToMain={handleMoveToMain}
        />

        <DeleteWorkflowDialog
          open={deleteWorkflowDialog.open}
          workflowName={deleteWorkflowDialog.processName}
          onClose={() =>
            setDeleteWorkflowDialog({
              open: false,
              processId: "",
              processName: "",
            })
          }
          onConfirm={handleConfirmDelete}
        />
      </div>
    </TooltipProvider>
  );
}
