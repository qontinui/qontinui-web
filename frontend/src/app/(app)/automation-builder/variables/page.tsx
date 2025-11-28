/**
 * Global Variables Page
 *
 * Main page for managing project-scoped global variables.
 * Provides CRUD operations, search/filter, import/export, and bulk operations.
 */

"use client";

import React, { useState, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { VariableTable } from "@/components/variables/VariableTable";
import { VariableEditorDialog } from "@/components/variables/VariableEditorDialog";
import { RequireProject } from "@/components/require-project";
import { useGlobalVariables } from "@/hooks/useGlobalVariables";
import {
  Plus,
  Download,
  Upload,
  Trash2,
  Search,
  MoreVertical,
  FileJson,
  AlertCircle,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import type {
  GlobalVariable,
  CreateVariableRequest,
  UpdateVariableRequest,
  VariableImportExport,
} from "@/types/variables";
import { formatDistanceToNow } from "date-fns";

export default function VariablesPage() {
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedVariables, setSelectedVariables] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingVariable, setEditingVariable] = useState<GlobalVariable | null>(
    null
  );
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingVariable, setDeletingVariable] = useState<string | null>(null);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  // Fetch variables using React Query hook
  const {
    variables,
    isLoading,
    error,
    createVariable,
    updateVariable,
    deleteVariable,
    deleteMultiple,
    refetch,
  } = useGlobalVariables({
    projectId: projectId || "",
    enabled: !!projectId,
  });

  // Filter variables based on search
  const filteredVariables = useMemo(() => {
    if (!searchQuery.trim()) return variables;

    const query = searchQuery.toLowerCase();
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(query) ||
        v.description?.toLowerCase().includes(query) ||
        v.type.toLowerCase().includes(query)
    );
  }, [variables, searchQuery]);

  // Handle create new variable
  const handleCreateNew = () => {
    setEditingVariable(null);
    setEditorOpen(true);
  };

  // Handle edit variable
  const handleEdit = (variable: GlobalVariable) => {
    setEditingVariable(variable);
    setEditorOpen(true);
  };

  // Handle duplicate variable
  const handleDuplicate = (variable: GlobalVariable) => {
    // Create a copy with a new name
    const baseName = variable.name;
    let copyNumber = 1;
    let newName = `${baseName}_copy`;

    while (variables.some((v) => v.name === newName)) {
      copyNumber++;
      newName = `${baseName}_copy${copyNumber}`;
    }

    createVariable({
      name: newName,
      value: variable.value,
      description: variable.description,
    });
  };

  // Handle save (create or update)
  const handleSave = async (
    data: CreateVariableRequest | UpdateVariableRequest,
    originalName?: string
  ) => {
    if (originalName) {
      // Update existing
      await updateVariable(originalName, data as UpdateVariableRequest);
    } else {
      // Create new
      await createVariable(data as CreateVariableRequest);
    }
  };

  // Handle delete single variable
  const handleDeleteSingle = (name: string) => {
    setDeletingVariable(name);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteSingle = async () => {
    if (deletingVariable) {
      await deleteVariable(deletingVariable);
      setDeleteDialogOpen(false);
      setDeletingVariable(null);
    }
  };

  // Handle bulk delete
  const handleBulkDelete = () => {
    if (selectedVariables.length > 0) {
      setBulkDeleteDialogOpen(true);
    }
  };

  const confirmBulkDelete = async () => {
    await deleteMultiple(selectedVariables);
    setSelectedVariables([]);
    setBulkDeleteDialogOpen(false);
  };

  // Handle export to JSON
  const handleExport = () => {
    const exportData: VariableImportExport = {
      version: "1.0.0",
      exported_at: new Date().toISOString(),
      variables: variables,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `global-variables-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    toast.success("Variables exported successfully");
  };

  // Handle import from JSON
  const handleImport = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data: VariableImportExport = JSON.parse(text);

        if (!data.variables || !Array.isArray(data.variables)) {
          throw new Error("Invalid file format");
        }

        // Import variables one by one
        let imported = 0;
        let skipped = 0;

        for (const variable of data.variables) {
          try {
            // Check if variable already exists
            const exists = variables.some((v) => v.name === variable.name);
            if (exists) {
              skipped++;
              continue;
            }

            await createVariable({
              name: variable.name,
              value: variable.value,
              description: variable.description,
            });
            imported++;
          } catch (error) {
            console.error(`Failed to import variable ${variable.name}:`, error);
            skipped++;
          }
        }

        toast.success(
          `Imported ${imported} variable(s)${skipped > 0 ? `, skipped ${skipped}` : ""}`
        );
      } catch (error) {
        console.error("Import failed:", error);
        toast.error(
          "Failed to import variables. Please check the file format."
        );
      }
    };
    input.click();
  };

  return (
    <RequireProject pageName="Global Variables">
      {/* Error state */}
      {error ? (
        <div className="container mx-auto py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <AlertCircle className="h-12 w-12 text-destructive mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                Error Loading Variables
              </h3>
              <p className="text-muted-foreground text-center max-w-md mb-4">
                {error.message}
              </p>
              <Button onClick={() => refetch()}>Retry</Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="container mx-auto py-8 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold">Global Variables</h1>
              <p className="text-muted-foreground mt-1">
                Manage variables shared across all workflows in this project
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleImport}>
                <Upload className="h-4 w-4 mr-2" />
                Import
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={variables.length === 0}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button onClick={handleCreateNew}>
                <Plus className="h-4 w-4 mr-2" />
                New Variable
              </Button>
            </div>
          </div>

          {/* Info Card */}
          <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                    About Global Variables
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    Global variables are accessible from all workflows in this
                    project. Use them to store configuration values, API keys,
                    or shared data. Variables support strings, numbers,
                    booleans, and complex JSON objects/arrays.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Total Variables</CardDescription>
                <CardTitle className="text-3xl">{variables.length}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Strings</CardDescription>
                <CardTitle className="text-3xl">
                  {variables.filter((v) => v.type === "string").length}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Numbers</CardDescription>
                <CardTitle className="text-3xl">
                  {variables.filter((v) => v.type === "number").length}
                </CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardDescription>Objects/Arrays</CardDescription>
                <CardTitle className="text-3xl">
                  {
                    variables.filter(
                      (v) => v.type === "object" || v.type === "array"
                    ).length
                  }
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {/* Search and actions */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search variables by name, type, or description..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {selectedVariables.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {selectedVariables.length} selected
                    </Badge>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleBulkDelete}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete Selected
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <VariableTable
                variables={filteredVariables}
                onEdit={handleEdit}
                onDelete={handleDeleteSingle}
                onDuplicate={handleDuplicate}
                selectedVariables={selectedVariables}
                onSelectionChange={setSelectedVariables}
                isLoading={isLoading}
              />
            </CardContent>
          </Card>

          {/* Variable Editor Dialog */}
          <VariableEditorDialog
            open={editorOpen}
            onOpenChange={setEditorOpen}
            onSave={handleSave}
            variable={editingVariable}
            existingNames={variables.map((v) => v.name)}
          />

          {/* Delete Single Confirmation */}
          <AlertDialog
            open={deleteDialogOpen}
            onOpenChange={setDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Variable?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete the variable &quot;
                  {deletingVariable}&quot;? This action cannot be undone and may
                  affect workflows that use this variable.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmDeleteSingle}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Bulk Delete Confirmation */}
          <AlertDialog
            open={bulkDeleteDialogOpen}
            onOpenChange={setBulkDeleteDialogOpen}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  Delete {selectedVariables.length} Variables?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete {selectedVariables.length}{" "}
                  selected variable(s)? This action cannot be undone and may
                  affect workflows that use these variables.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={confirmBulkDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete All
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </RequireProject>
  );
}
