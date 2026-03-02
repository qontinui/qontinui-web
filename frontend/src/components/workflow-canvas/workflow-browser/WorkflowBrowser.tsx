import React, { useState, useCallback } from "react";
import type { WorkflowBrowserProps } from "./types";
import { useWorkflowLoader } from "./_hooks/useWorkflowLoader";
import { useWorkflowFiltering } from "./_hooks/useWorkflowFiltering";
import { useBulkOperations } from "./_hooks/useBulkOperations";
import { useWorkflowActions } from "./_hooks/useWorkflowActions";
import { useKeyboardShortcuts } from "./_hooks/useKeyboardShortcuts";
import { BrowserHeader } from "./_components/BrowserHeader";
import { FolderSidebar } from "./_components/FolderSidebar";
import { AdvancedSearch } from "../../workflow-organization/AdvancedSearch";
import { QuickFiltersBar, Toolbar } from "./SelectionManager";
import { Canvas } from "./Canvas";

export function WorkflowBrowser({
  onOpen,
  onClose,
  open,
}: WorkflowBrowserProps) {
  const [showFolderTree, setShowFolderTree] = useState(true);

  const {
    workflows,
    folders,
    loading,
    savedFilters,
    handleSaveFilter,
    loadWorkflows,
  } = useWorkflowLoader(open);

  const {
    viewMode,
    setViewMode,
    selectedFolderId,
    setSelectedFolderId,
    activeQuickFilter,
    setActiveQuickFilter,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    groupBy,
    setGroupBy,
    columns,
    showAdvancedSearch,
    setShowAdvancedSearch,
    sortedWorkflows,
    groupedWorkflows,
    visibleColumns,
    handleColumnVisibilityChange,
    handleSearchResults,
    handleClearFilters,
  } = useWorkflowFiltering(workflows);

  const {
    bulkSelectMode,
    selectedWorkflowIds,
    handleToggleSelectWorkflow,
    handleToggleSelectAll,
    handleBulkDelete,
    handleBulkMoveToFolder,
    handleBulkExport,
    handleToggleBulkSelect,
    handleClearSelection,
  } = useBulkOperations(workflows, sortedWorkflows, loadWorkflows);

  const { handleOpenWorkflow, handleDuplicateWorkflow, handleDeleteWorkflow } =
    useWorkflowActions(onOpen, onClose, loadWorkflows);

  const onExitBulkSelect = useCallback(() => {
    handleClearSelection();
    handleToggleBulkSelect();
  }, [handleClearSelection, handleToggleBulkSelect]);

  useKeyboardShortcuts({
    open,
    bulkSelectMode,
    selectedCount: selectedWorkflowIds.size,
    onToggleSelectAll: handleToggleSelectAll,
    onBulkDelete: handleBulkDelete,
    onShowAdvancedSearch: () => setShowAdvancedSearch(true),
    onExitBulkSelect,
    onClose,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card rounded-lg shadow-xl w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col border">
        <BrowserHeader
          workflowCount={sortedWorkflows.length}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          columns={columns}
          onColumnVisibilityChange={handleColumnVisibilityChange}
          showFolderTree={showFolderTree}
          onToggleFolderTree={() => setShowFolderTree(!showFolderTree)}
          showAdvancedSearch={showAdvancedSearch}
          onToggleAdvancedSearch={() =>
            setShowAdvancedSearch(!showAdvancedSearch)
          }
          bulkSelectMode={bulkSelectMode}
          onToggleBulkSelect={handleToggleBulkSelect}
          onClose={onClose}
        />

        <div className="flex flex-1 overflow-hidden">
          {showFolderTree && (
            <FolderSidebar
              folders={folders}
              workflows={workflows.map((w) => w.workflow)}
              selectedFolderId={selectedFolderId}
              onSelectFolder={setSelectedFolderId}
              onReload={loadWorkflows}
            />
          )}

          <div className="flex-1 flex flex-col overflow-hidden">
            {showAdvancedSearch && (
              <div className="border-b">
                <AdvancedSearch
                  workflows={workflows.map((w) => w.workflow)}
                  folders={folders}
                  onSearch={handleSearchResults}
                  onSaveFilter={handleSaveFilter}
                  savedFilters={savedFilters}
                />
              </div>
            )}

            <QuickFiltersBar
              activeQuickFilter={activeQuickFilter}
              onQuickFilterChange={setActiveQuickFilter}
            />

            <Toolbar
              bulkSelectMode={bulkSelectMode}
              selectedCount={selectedWorkflowIds.size}
              totalCount={sortedWorkflows.length}
              folders={folders}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              sortOrder={sortOrder}
              onSortOrderToggle={() =>
                setSortOrder(sortOrder === "asc" ? "desc" : "asc")
              }
              groupBy={groupBy}
              onGroupByChange={setGroupBy}
              onMoveToFolder={handleBulkMoveToFolder}
              onExport={handleBulkExport}
              onBulkDelete={handleBulkDelete}
              onClearSelection={handleClearSelection}
              onToggleSelectAll={handleToggleSelectAll}
            />

            <Canvas
              loading={loading}
              groupedWorkflows={groupedWorkflows}
              sortedWorkflowCount={sortedWorkflows.length}
              viewMode={viewMode}
              groupBy={groupBy}
              visibleColumns={visibleColumns}
              bulkSelectMode={bulkSelectMode}
              selectedWorkflowIds={selectedWorkflowIds}
              selectedFolderId={selectedFolderId}
              onToggleSelectWorkflow={handleToggleSelectWorkflow}
              onOpenWorkflow={handleOpenWorkflow}
              onDuplicateWorkflow={handleDuplicateWorkflow}
              onDeleteWorkflow={handleDeleteWorkflow}
              onClearFilters={handleClearFilters}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
