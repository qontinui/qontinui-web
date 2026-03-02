"use client";

import { Plus, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { TestSuite } from "@/services/workflow-testing-service";
import type { TestSuiteManagerProps } from "./test-suite-manager-types";
import { useTestSuiteManager } from "./_hooks/useTestSuiteManager";
import { SuiteCard } from "./_components/SuiteCard";
import { SuiteSearchFilter } from "./_components/SuiteSearchFilter";
import { SuiteEditorDialog } from "./_components/SuiteEditorDialog";

export type { TestSuiteManagerProps };

export function TestSuiteManager({
  workflows,
  testSuites,
  testCases,
  onCreateSuite,
  onUpdateSuite,
  onDeleteSuite,
  onRunSuite,
  className,
}: TestSuiteManagerProps) {
  const {
    searchQuery,
    setSearchQuery,
    filterTags,
    selectedSuite,
    isCreating,
    isEditing,
    runningSuites,
    allTags,
    filteredSuites,
    getSuiteStatistics,
    handleCreateSuite,
    handleEditSuite,
    handleDeleteSuite,
    handleRunSuite,
    toggleFilterTag,
    closeDialog,
  } = useTestSuiteManager(testSuites, testCases, onDeleteSuite, onRunSuite);

  const handleDialogSave = (suite: Partial<TestSuite>) => {
    if (isEditing && selectedSuite) {
      onUpdateSuite(selectedSuite.id, suite);
    } else {
      onCreateSuite(suite as TestSuite);
    }
    closeDialog();
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Test Suites</CardTitle>
              <CardDescription>
                Organize and run collections of test cases
              </CardDescription>
            </div>
            <Button onClick={handleCreateSuite}>
              <Plus />
              New Suite
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Search and filters */}
      <SuiteSearchFilter
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        allTags={allTags}
        filterTags={filterTags}
        onToggleFilterTag={toggleFilterTag}
      />

      {/* Test suites list */}
      <div className="space-y-4">
        {filteredSuites.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="size-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">
                No test suites found
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery || filterTags.length > 0
                  ? "Try adjusting your search or filters"
                  : "Create your first test suite to get started"}
              </p>
              {!searchQuery && filterTags.length === 0 && (
                <Button onClick={handleCreateSuite}>
                  <Plus />
                  Create Test Suite
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredSuites.map((suite) => (
            <SuiteCard
              key={suite.id}
              suite={suite}
              stats={getSuiteStatistics(suite)}
              isRunning={runningSuites.has(suite.id)}
              onRun={handleRunSuite}
              onEdit={handleEditSuite}
              onDelete={handleDeleteSuite}
            />
          ))
        )}
      </div>

      {/* Create/Edit dialog */}
      {(isCreating || isEditing) && (
        <SuiteEditorDialog
          suite={isEditing ? selectedSuite : undefined}
          testCases={testCases}
          workflows={workflows}
          onSave={handleDialogSave}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
