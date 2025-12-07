/**
 * TestSuiteManager - Component for managing test suites
 *
 * Features:
 * - List of test suites with statistics
 * - Create new suite
 * - Add/remove test cases from suite
 * - Suite details (name, description, tags)
 * - Run entire suite
 * - Filter and search suites
 * - Suite settings (execution order, stop on failure)
 * - Keyboard shortcuts support
 */

"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  Play,
  Edit,
  Search,
  Filter,
  X,
  Settings,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TestSuite, TestCase } from "@/services/workflow-testing-service";
import type { Workflow } from "@/lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface TestSuiteManagerProps {
  workflows: Workflow[];
  testSuites: TestSuite[];
  testCases: TestCase[];
  onCreateSuite: (suite: TestSuite) => void;
  onUpdateSuite: (id: string, updates: Partial<TestSuite>) => void;
  onDeleteSuite: (id: string) => void;
  onRunSuite: (id: string) => void;
  className?: string;
}

interface SuiteStatistics {
  totalTests: number;
  passRate: number;
  lastRun?: string;
}

// ============================================================================
// Component
// ============================================================================

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
  // ========================================================================
  // State
  // ========================================================================

  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterTags, setFilterTags] = React.useState<string[]>([]);
  const [selectedSuite, setSelectedSuite] = React.useState<TestSuite | null>(
    null
  );
  const [isCreating, setIsCreating] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [runningSuites, setRunningSuites] = React.useState<Set<string>>(
    new Set()
  );

  // ========================================================================
  // Computed values
  // ========================================================================

  const allTags = React.useMemo(() => {
    const tags = new Set<string>();
    testSuites.forEach((suite) => {
      suite.tags?.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags);
  }, [testSuites]);

  const filteredSuites = React.useMemo(() => {
    return testSuites.filter((suite) => {
      // Search filter
      const matchesSearch =
        !searchQuery ||
        suite.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        suite.description?.toLowerCase().includes(searchQuery.toLowerCase());

      // Tag filter
      const matchesTags =
        filterTags.length === 0 ||
        filterTags.some((tag) => suite.tags?.includes(tag));

      return matchesSearch && matchesTags;
    });
  }, [testSuites, searchQuery, filterTags]);

  const getSuiteStatistics = React.useCallback(
    (suite: TestSuite): SuiteStatistics => {
      const suiteTestCases = testCases.filter((tc) =>
        suite.testCaseIds.includes(tc.id)
      );

      // Calculate actual pass rate from test results
      let passedCount = 0;
      let totalWithResults = 0;

      suiteTestCases.forEach((testCase) => {
        // Get the most recent test result for each test case
        const testResults = testCase.metadata?.testResults as any[] | undefined;
        if (testResults && testResults.length > 0) {
          const latestResult = testResults[0]; // Results are stored most recent first
          totalWithResults++;
          if (latestResult.passed) {
            passedCount++;
          }
        }
      });

      // Calculate pass rate (0 if no test results exist)
      const passRate =
        totalWithResults > 0 ? (passedCount / totalWithResults) * 100 : 0;

      return {
        totalTests: suiteTestCases.length,
        passRate,
        lastRun: suite.metadata?.lastRun,
      };
    },
    [testCases]
  );

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleCreateSuite = React.useCallback(() => {
    setIsCreating(true);
  }, []);

  const handleEditSuite = React.useCallback((suite: TestSuite) => {
    setSelectedSuite(suite);
    setIsEditing(true);
  }, []);

  const handleDeleteSuite = React.useCallback(
    (suiteId: string) => {
      if (confirm("Are you sure you want to delete this test suite?")) {
        onDeleteSuite(suiteId);
      }
    },
    [onDeleteSuite]
  );

  const handleRunSuite = React.useCallback(
    (suiteId: string) => {
      setRunningSuites((prev) => new Set(prev).add(suiteId));
      onRunSuite(suiteId);
      // Simulate completion after 2 seconds
      setTimeout(() => {
        setRunningSuites((prev) => {
          const next = new Set(prev);
          next.delete(suiteId);
          return next;
        });
      }, 2000);
    },
    [onRunSuite]
  );

  const toggleFilterTag = React.useCallback((tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  // ========================================================================
  // Render
  // ========================================================================

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
      <Card>
        <CardContent className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search test suites..."
              className="pl-9"
            />
          </div>

          {/* Tag filters */}
          {allTags.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Filter className="size-4" />
                Filter by tags
              </Label>
              <div className="flex flex-wrap gap-2">
                {allTags.map((tag) => (
                  <Badge
                    key={tag}
                    variant={filterTags.includes(tag) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleFilterTag(tag)}
                  >
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

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
          filteredSuites.map((suite) => {
            const stats = getSuiteStatistics(suite);
            const isRunning = runningSuites.has(suite.id);

            return (
              <Card key={suite.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle>{suite.name}</CardTitle>
                      {suite.description && (
                        <CardDescription>{suite.description}</CardDescription>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleRunSuite(suite.id)}
                        variant="secondary"
                        size="sm"
                        disabled={isRunning}
                      >
                        {isRunning ? (
                          <>
                            <Loader2 className="animate-spin" />
                            Running
                          </>
                        ) : (
                          <>
                            <Play />
                            Run
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => handleEditSuite(suite)}
                        variant="outline"
                        size="sm"
                      >
                        <Edit />
                      </Button>
                      <Button
                        onClick={() => handleDeleteSuite(suite.id)}
                        variant="ghost"
                        size="sm"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    {/* Total tests */}
                    <div className="flex items-center gap-2">
                      <FileText className="size-4 text-muted-foreground" />
                      <div>
                        <p className="text-2xl font-bold">{stats.totalTests}</p>
                        <p className="text-xs text-muted-foreground">
                          Total Tests
                        </p>
                      </div>
                    </div>

                    {/* Pass rate */}
                    <div className="flex items-center gap-2">
                      {stats.passRate >= 80 ? (
                        <CheckCircle2 className="size-4 text-green-500" />
                      ) : stats.passRate >= 50 ? (
                        <Clock className="size-4 text-yellow-500" />
                      ) : (
                        <XCircle className="size-4 text-red-500" />
                      )}
                      <div>
                        <p className="text-2xl font-bold">
                          {stats.passRate > 0
                            ? `${stats.passRate.toFixed(0)}%`
                            : "N/A"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Pass Rate
                        </p>
                      </div>
                    </div>

                    {/* Last run */}
                    <div className="flex items-center gap-2">
                      <Clock className="size-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">
                          {stats.lastRun
                            ? new Date(stats.lastRun).toLocaleDateString()
                            : "Never"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Last Run
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Settings */}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <Badge variant="outline">
                      {suite.executionOrder === "parallel"
                        ? "Parallel"
                        : "Sequential"}
                    </Badge>
                    {suite.stopOnFailure && (
                      <Badge variant="outline">Stop on Failure</Badge>
                    )}
                  </div>

                  {/* Tags */}
                  {suite.tags && suite.tags.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-4">
                      {suite.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Create/Edit dialog */}
      {(isCreating || isEditing) && (
        <SuiteEditorDialog
          suite={isEditing ? selectedSuite : undefined}
          testCases={testCases}
          workflows={workflows}
          onSave={(suite) => {
            if (isEditing && selectedSuite) {
              onUpdateSuite(selectedSuite.id, suite);
            } else {
              onCreateSuite(suite as TestSuite);
            }
            setIsCreating(false);
            setIsEditing(false);
            setSelectedSuite(null);
          }}
          onCancel={() => {
            setIsCreating(false);
            setIsEditing(false);
            setSelectedSuite(null);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Suite Editor Dialog
// ============================================================================

interface SuiteEditorDialogProps {
  suite?: TestSuite | null;
  testCases: TestCase[];
  workflows: Workflow[];
  onSave: (suite: Partial<TestSuite>) => void;
  onCancel: () => void;
}

function SuiteEditorDialog({
  suite,
  testCases,
  workflows,
  onSave,
  onCancel,
}: SuiteEditorDialogProps) {
  const [name, setName] = React.useState(suite?.name || "");
  const [description, setDescription] = React.useState(
    suite?.description || ""
  );
  const [selectedTestCaseIds, setSelectedTestCaseIds] = React.useState<
    string[]
  >(suite?.testCaseIds || []);
  const [executionOrder, setExecutionOrder] = React.useState<
    "parallel" | "sequential"
  >(suite?.executionOrder || "sequential");
  const [stopOnFailure, setStopOnFailure] = React.useState(
    suite?.stopOnFailure || false
  );
  const [tags, setTags] = React.useState<string[]>(suite?.tags || []);
  const [newTag, setNewTag] = React.useState("");
  const [filterWorkflow, setFilterWorkflow] = React.useState<string>("");

  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const filteredTestCases = React.useMemo(() => {
    if (!filterWorkflow) return testCases;
    return testCases.filter((tc) => tc.workflowId === filterWorkflow);
  }, [testCases, filterWorkflow]);

  const validate = () => {
    const newErrors: Record<string, string> = {};

    if (!name.trim()) {
      newErrors.name = "Suite name is required";
    }

    if (selectedTestCaseIds.length === 0) {
      newErrors.testCases = "At least one test case is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const suiteData: Partial<TestSuite> = {
      id: suite?.id || `suite-${Date.now()}`,
      name,
      description: description || undefined,
      testCaseIds: selectedTestCaseIds,
      executionOrder,
      stopOnFailure,
      tags,
      metadata: {
        ...suite?.metadata,
        created: suite?.metadata?.created || new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    onSave(suiteData);
  };

  const toggleTestCase = (testCaseId: string) => {
    setSelectedTestCaseIds((prev) =>
      prev.includes(testCaseId)
        ? prev.filter((id) => id !== testCaseId)
        : [...prev, testCaseId]
    );
  };

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags((prev) => [...prev, newTag.trim()]);
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  };

  return (
    <Dialog open onOpenChange={onCancel}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {suite ? "Edit Test Suite" : "Create Test Suite"}
          </DialogTitle>
          <DialogDescription>
            Configure your test suite settings and select test cases
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="suite-name">
              Suite Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="suite-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Login Flow Tests"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="suite-description">Description</Label>
            <Textarea
              id="suite-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe this test suite..."
              rows={3}
            />
          </div>

          <Separator />

          {/* Settings */}
          <div className="space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings className="size-4" />
              Execution Settings
            </h3>

            {/* Execution order */}
            <div className="space-y-2">
              <Label htmlFor="execution-order">Execution Order</Label>
              <Select
                value={executionOrder}
                onValueChange={(value) =>
                  setExecutionOrder(value as "parallel" | "sequential")
                }
              >
                <SelectTrigger id="execution-order">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequential">Sequential</SelectItem>
                  <SelectItem value="parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Sequential runs tests one after another, parallel runs them
                simultaneously
              </p>
            </div>

            {/* Stop on failure */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="stop-on-failure"
                checked={stopOnFailure}
                onChange={(e) => setStopOnFailure(e.target.checked)}
                className="size-4 rounded border-input"
              />
              <Label htmlFor="stop-on-failure">
                Stop execution on first failure
              </Label>
            </div>
          </div>

          <Separator />

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="suite-tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="suite-tags"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
                placeholder="Add tag..."
              />
              <Button onClick={addTag} variant="outline" size="sm">
                <Plus />
                Add
              </Button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="ml-1 hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Test cases */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">
                Test Cases <span className="text-destructive">*</span>
              </h3>
              <div className="text-sm text-muted-foreground">
                {selectedTestCaseIds.length} selected
              </div>
            </div>

            {/* Filter by workflow */}
            <div className="space-y-2">
              <Label htmlFor="filter-workflow">Filter by Workflow</Label>
              <Select value={filterWorkflow} onValueChange={setFilterWorkflow}>
                <SelectTrigger id="filter-workflow">
                  <SelectValue placeholder="All workflows" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All workflows</SelectItem>
                  {workflows.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Test case list */}
            <div className="border rounded-md max-h-64 overflow-y-auto">
              {filteredTestCases.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No test cases available
                </div>
              ) : (
                <div className="divide-y">
                  {filteredTestCases.map((testCase) => {
                    const workflow = workflows.find(
                      (w) => w.id === testCase.workflowId
                    );
                    const isSelected = selectedTestCaseIds.includes(
                      testCase.id
                    );

                    return (
                      <label
                        key={testCase.id}
                        className="flex items-center gap-3 p-3 hover:bg-accent cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTestCase(testCase.id)}
                          className="size-4 rounded border-input"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">
                            {testCase.name}
                          </p>
                          <p className="text-sm text-muted-foreground truncate">
                            {workflow?.name}
                          </p>
                        </div>
                        {!testCase.enabled && (
                          <Badge variant="outline">Disabled</Badge>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            {errors.testCases && (
              <p className="text-sm text-destructive">{errors.testCases}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            <X />
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save />
            Save Suite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
