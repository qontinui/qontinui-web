/**
 * TestCaseEditor - Component for creating and editing test cases
 *
 * Features:
 * - Test case name and description
 * - Input configuration (screenshots, states, variables)
 * - Expected outputs configuration
 * - Assertions builder with multiple types
 * - Run test functionality
 * - Save/cancel with validation
 * - Keyboard shortcuts support
 */

"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  Play,
  Save,
  X,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import type {
  TestCase,
  Assertion,
  AssertionType,
} from "@/services/workflow-testing-service";
import type { Workflow } from "@/lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

export interface TestCaseEditorProps {
  testCase?: TestCase;
  workflow: Workflow;
  onSave: (testCase: TestCase) => void;
  onCancel: () => void;
  className?: string;
}

interface ValidationErrors {
  name?: string;
  assertions?: string;
  [key: string]: string | undefined;
}

// ============================================================================
// Component
// ============================================================================

export function TestCaseEditor({
  testCase,
  workflow,
  onSave,
  onCancel,
  className,
}: TestCaseEditorProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [name, setName] = React.useState(testCase?.name || "");
  const [description, setDescription] = React.useState(
    testCase?.description || ""
  );
  const [enabled, setEnabled] = React.useState(testCase?.enabled !== false);

  // Input configuration
  const [initialScreenshots, setInitialScreenshots] = React.useState<string[]>(
    testCase?.config.initialState?.screenshots || []
  );
  const [initialStates, setInitialStates] = React.useState<string[]>(
    testCase?.config.initialState?.activeStates || []
  );
  const [inputVariables, setInputVariables] = React.useState<
    Record<string, unknown>
  >(testCase?.config.inputs || {});

  // Expected outputs
  const [expectedVariables, setExpectedVariables] = React.useState<
    Record<string, unknown>
  >(testCase?.config.initialState?.variables || {});
  const [expectedFinalAction, setExpectedFinalAction] = React.useState<string>(
    testCase?.config.expected?.finalActionId || ""
  );
  const [maxDuration, setMaxDuration] = React.useState<number>(
    testCase?.config.expected?.maxDuration || 30000
  );
  const [shouldSucceed, setShouldSucceed] = React.useState<boolean>(
    testCase?.config.expected?.shouldSucceed !== false
  );

  // Assertions
  const [assertions, setAssertions] = React.useState<Assertion[]>(
    testCase?.config.assertions || []
  );

  // Tags
  const [tags, setTags] = React.useState<string[]>(testCase?.config.tags || []);
  const [newTag, setNewTag] = React.useState("");

  // Timeout
  const [timeout, setTimeout] = React.useState<number>(
    testCase?.config.timeout || 60000
  );

  // UI state
  const [isRunning, setIsRunning] = React.useState(false);
  const [errors, setErrors] = React.useState<ValidationErrors>({});
  const [expandedSections, setExpandedSections] = React.useState({
    input: true,
    expected: true,
    assertions: true,
    advanced: false,
  });

  // ========================================================================
  // Validation
  // ========================================================================

  const validate = React.useCallback((): boolean => {
    const newErrors: ValidationErrors = {};

    if (!name.trim()) {
      newErrors.name = "Test name is required";
    }

    if (assertions.length === 0) {
      newErrors.assertions = "At least one assertion is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, assertions]);

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleSave = React.useCallback(() => {
    if (!validate()) {
      return;
    }

    const testCaseData: TestCase = {
      id: testCase?.id || `test-${Date.now()}`,
      name,
      description: description || undefined,
      workflowId: workflow.id,
      enabled,
      config: {
        inputs: inputVariables,
        initialState: {
          screenshots: initialScreenshots,
          activeStates: initialStates,
          variables: expectedVariables,
        },
        assertions,
        expected: {
          shouldSucceed,
          finalActionId: expectedFinalAction || undefined,
          maxDuration,
        },
        timeout,
        tags,
      },
      metadata: {
        ...testCase?.metadata,
        created: testCase?.metadata?.created || new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    onSave(testCaseData);
  }, [
    validate,
    testCase,
    name,
    description,
    workflow.id,
    enabled,
    inputVariables,
    initialScreenshots,
    initialStates,
    expectedVariables,
    assertions,
    shouldSucceed,
    expectedFinalAction,
    maxDuration,
    timeout,
    tags,
    onSave,
  ]);

  const handleRun = React.useCallback(async () => {
    if (!validate()) {
      return;
    }
    setIsRunning(true);

    try {
      // Build test case data
      const testCaseData: TestCase = {
        id: testCase?.id || `test-${Date.now()}`,
        name,
        description: description || undefined,
        workflowId: workflow.id,
        enabled,
        config: {
          inputs: inputVariables,
          initialState: {
            screenshots: initialScreenshots,
            activeStates: initialStates,
            variables: expectedVariables,
          },
          assertions,
          expected: {
            shouldSucceed,
            finalActionId: expectedFinalAction || undefined,
            maxDuration,
          },
          timeout,
          tags,
        },
        metadata: {
          ...testCase?.metadata,
          created: testCase?.metadata?.created || new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      };

      // Import the test runner API
      const { runWorkflowTest } = await import("@/lib/api/workflow-testing");

      // Get project ID from workflow or default
      const projectId = (workflow as { projectId?: string }).projectId || "default-project";

      // Execute the test
      const result = await runWorkflowTest(testCaseData, workflow, projectId);

      // Store result in test case metadata
      const existingResults =
        (testCase?.metadata?.testResults as unknown[]) || [];
      const updatedResults = [result, ...existingResults].slice(0, 100); // Keep last 100 results

      // Update test case with result
      testCaseData.metadata = {
        ...testCaseData.metadata,
        lastRun: result.endTime,
        testResults: updatedResults,
      };

      // Show result notification
      if (result.passed) {
        console.log("Test passed!", result);
        alert("Test passed! All assertions succeeded.");
      } else {
        console.error("Test failed!", result);
        alert(
          `Test failed: ${result.error || "Some assertions failed"}\n\nCheck console for details.`
        );
      }

      // Save the updated test case
      onSave(testCaseData);
    } catch (error) {
      console.error("Test execution failed:", error);
      alert(
        `Test execution failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      setIsRunning(false);
    }
  }, [
    validate,
    testCase,
    name,
    description,
    workflow,
    enabled,
    inputVariables,
    initialScreenshots,
    initialStates,
    expectedVariables,
    assertions,
    shouldSucceed,
    expectedFinalAction,
    maxDuration,
    timeout,
    tags,
    onSave,
  ]);

  // Assertions handlers
  const addAssertion = React.useCallback(() => {
    const newAssertion: Assertion = {
      id: `assertion-${Date.now()}`,
      type: "equals",
      description: "",
      path: "",
      expected: "",
    };
    setAssertions((prev) => [...prev, newAssertion]);
  }, []);

  const updateAssertion = React.useCallback(
    (id: string, updates: Partial<Assertion>) => {
      setAssertions((prev) =>
        prev.map((assertion) =>
          assertion.id === id ? { ...assertion, ...updates } : assertion
        )
      );
    },
    []
  );

  const removeAssertion = React.useCallback((id: string) => {
    setAssertions((prev) => prev.filter((assertion) => assertion.id !== id));
  }, []);

  // Variable handlers
  const addInputVariable = React.useCallback((key: string, value: unknown) => {
    setInputVariables((prev) => ({ ...prev, [key]: value }));
  }, []);

  const removeInputVariable = React.useCallback((key: string) => {
    setInputVariables((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const addExpectedVariable = React.useCallback(
    (key: string, value: unknown) => {
      setExpectedVariables((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const removeExpectedVariable = React.useCallback((key: string) => {
    setExpectedVariables((prev) => {
      const { [key]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  // Tag handlers
  const addTag = React.useCallback(() => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags((prev) => [...prev, newTag.trim()]);
      setNewTag("");
    }
  }, [newTag, tags]);

  const removeTag = React.useCallback((tag: string) => {
    setTags((prev) => prev.filter((t) => t !== tag));
  }, []);

  // Section toggle
  const toggleSection = React.useCallback(
    (section: keyof typeof expandedSections) => {
      setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
    },
    []
  );

  // ========================================================================
  // Keyboard shortcuts
  // ========================================================================

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
      // Escape to cancel
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
      // Ctrl/Cmd + Enter to run
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleRun();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleRun, onCancel]);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>{testCase ? "Edit Test Case" : "New Test Case"}</CardTitle>
          <CardDescription>
            Create test cases to validate your workflow behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Test Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Login with valid credentials"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="size-4" />
                {errors.name}
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this test validates..."
              rows={3}
            />
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label htmlFor="tags">Tags</Label>
            <div className="flex gap-2">
              <Input
                id="tags"
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
        </CardContent>
      </Card>

      {/* Input Configuration */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => toggleSection("input")}
        >
          <div className="flex items-center gap-2">
            {expandedSections.input ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <CardTitle>Input Configuration</CardTitle>
          </div>
          <CardDescription>
            Define initial state and input variables for the test
          </CardDescription>
        </CardHeader>
        {expandedSections.input && (
          <CardContent className="space-y-4">
            {/* Input Variables */}
            <div className="space-y-2">
              <Label>Input Variables</Label>
              <KeyValueEditor
                values={inputVariables}
                onAdd={addInputVariable}
                onRemove={removeInputVariable}
                placeholder="Add input variable..."
              />
            </div>

            <Separator />

            {/* Initial Screenshots */}
            <div className="space-y-2">
              <Label>Initial Screenshots (IDs)</Label>
              <ArrayEditor
                values={initialScreenshots}
                onChange={setInitialScreenshots}
                placeholder="Screenshot ID..."
              />
            </div>

            {/* Initial States */}
            <div className="space-y-2">
              <Label>Initial Active States (IDs)</Label>
              <ArrayEditor
                values={initialStates}
                onChange={setInitialStates}
                placeholder="State ID..."
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Expected Outputs */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => toggleSection("expected")}
        >
          <div className="flex items-center gap-2">
            {expandedSections.expected ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <CardTitle>Expected Outputs</CardTitle>
          </div>
          <CardDescription>
            Define expected behavior and outcomes
          </CardDescription>
        </CardHeader>
        {expandedSections.expected && (
          <CardContent className="space-y-4">
            {/* Should Succeed */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="shouldSucceed"
                checked={shouldSucceed}
                onChange={(e) => setShouldSucceed(e.target.checked)}
                className="size-4 rounded border-input"
              />
              <Label htmlFor="shouldSucceed">Workflow should succeed</Label>
            </div>

            {/* Expected Final Action */}
            <div className="space-y-2">
              <Label htmlFor="finalAction">Expected Final Action ID</Label>
              <Select
                value={expectedFinalAction}
                onValueChange={setExpectedFinalAction}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select action..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">None</SelectItem>
                  {workflow.actions.map((action) => (
                    <SelectItem key={action.id} value={action.id}>
                      {action.name || action.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Max Duration */}
            <div className="space-y-2">
              <Label htmlFor="maxDuration">Max Duration (ms)</Label>
              <Input
                id="maxDuration"
                type="number"
                value={maxDuration}
                onChange={(e) => setMaxDuration(Number(e.target.value))}
                min={0}
              />
            </div>

            <Separator />

            {/* Expected Variables */}
            <div className="space-y-2">
              <Label>Expected Variables</Label>
              <KeyValueEditor
                values={expectedVariables}
                onAdd={addExpectedVariable}
                onRemove={removeExpectedVariable}
                placeholder="Add expected variable..."
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Assertions */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => toggleSection("assertions")}
        >
          <div className="flex items-center gap-2">
            {expandedSections.assertions ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <CardTitle>
              Assertions <span className="text-destructive">*</span>
            </CardTitle>
          </div>
          <CardDescription>
            Define assertions to validate test results
          </CardDescription>
        </CardHeader>
        {expandedSections.assertions && (
          <CardContent className="space-y-4">
            {assertions.map((assertion) => (
              <AssertionEditor
                key={assertion.id}
                assertion={assertion}
                onUpdate={(updates) => updateAssertion(assertion.id, updates)}
                onRemove={() => removeAssertion(assertion.id)}
              />
            ))}
            <Button onClick={addAssertion} variant="outline" className="w-full">
              <Plus />
              Add Assertion
            </Button>
            {errors.assertions && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="size-4" />
                {errors.assertions}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader
          className="cursor-pointer"
          onClick={() => toggleSection("advanced")}
        >
          <div className="flex items-center gap-2">
            {expandedSections.advanced ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
            <CardTitle>Advanced Settings</CardTitle>
          </div>
        </CardHeader>
        {expandedSections.advanced && (
          <CardContent className="space-y-4">
            {/* Timeout */}
            <div className="space-y-2">
              <Label htmlFor="timeout">Test Timeout (ms)</Label>
              <Input
                id="timeout"
                type="number"
                value={timeout}
                onChange={(e) => setTimeout(Number(e.target.value))}
                min={0}
              />
            </div>

            {/* Enabled */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="enabled"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="size-4 rounded border-input"
              />
              <Label htmlFor="enabled">Test enabled</Label>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Actions */}
      <Card>
        <CardFooter className="flex justify-between">
          <Button onClick={onCancel} variant="outline">
            <X />
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button
              onClick={handleRun}
              variant="secondary"
              disabled={isRunning}
            >
              {isRunning ? (
                <>
                  <Loader2 className="animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play />
                  Run Test
                </>
              )}
            </Button>
            <Button onClick={handleSave}>
              <Save />
              Save
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* Keyboard shortcuts hint */}
      <div className="text-xs text-muted-foreground text-center space-y-1">
        <p>
          Keyboard shortcuts: Ctrl+S to save, Esc to cancel, Ctrl+Enter to run
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface AssertionEditorProps {
  assertion: Assertion;
  onUpdate: (updates: Partial<Assertion>) => void;
  onRemove: () => void;
}

function AssertionEditor({
  assertion,
  onUpdate,
  onRemove,
}: AssertionEditorProps) {
  const assertionTypes: AssertionType[] = [
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "exists",
    "notExists",
    "greaterThan",
    "lessThan",
    "regex",
    "custom",
  ];

  const needsExpectedValue = [
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "greaterThan",
    "lessThan",
  ].includes(assertion.type);

  const needsPattern = assertion.type === "regex";
  const needsCustomFunction = assertion.type === "custom";

  return (
    <Card className="p-4">
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1 grid grid-cols-2 gap-3">
            {/* Type */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={assertion.type}
                onValueChange={(value) =>
                  onUpdate({ type: value as AssertionType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {assertionTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Path */}
            <div className="space-y-2">
              <Label>Path</Label>
              <Input
                value={assertion.path || ""}
                onChange={(e) => onUpdate({ path: e.target.value })}
                placeholder="e.g., variables.username"
              />
            </div>
          </div>

          {/* Remove button */}
          <Button onClick={onRemove} variant="ghost" size="icon">
            <Trash2 className="size-4" />
          </Button>
        </div>

        {/* Description */}
        <div className="space-y-2">
          <Label>Description</Label>
          <Input
            value={assertion.description || ""}
            onChange={(e) => onUpdate({ description: e.target.value })}
            placeholder="Describe this assertion..."
          />
        </div>

        {/* Expected value */}
        {needsExpectedValue && (
          <div className="space-y-2">
            <Label>Expected Value</Label>
            <Input
              value={assertion.expected !== undefined && assertion.expected !== null ? String(assertion.expected) : ""}
              onChange={(e) => {
                // Try to parse as JSON for complex values
                try {
                  const parsed = JSON.parse(e.target.value);
                  onUpdate({ expected: parsed });
                } catch {
                  onUpdate({ expected: e.target.value });
                }
              }}
              placeholder="Expected value..."
            />
          </div>
        )}

        {/* Regex pattern */}
        {needsPattern && (
          <div className="space-y-2">
            <Label>Pattern</Label>
            <Input
              value={assertion.pattern || ""}
              onChange={(e) => onUpdate({ pattern: e.target.value })}
              placeholder="Regular expression pattern..."
            />
          </div>
        )}

        {/* Custom function */}
        {needsCustomFunction && (
          <div className="space-y-2">
            <Label>Custom Function</Label>
            <Textarea
              value={assertion.customFunction || ""}
              onChange={(e) => onUpdate({ customFunction: e.target.value })}
              placeholder="return value === expectedValue;"
              rows={4}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

interface KeyValueEditorProps {
  values: Record<string, unknown>;
  onAdd: (key: string, value: unknown) => void;
  onRemove: (key: string) => void;
  placeholder?: string;
}

function KeyValueEditor({
  values,
  onAdd,
  onRemove,
  placeholder,
}: KeyValueEditorProps) {
  const [newKey, setNewKey] = React.useState("");
  const [newValue, setNewValue] = React.useState("");

  const handleAdd = () => {
    if (newKey.trim()) {
      try {
        const parsed = JSON.parse(newValue);
        onAdd(newKey.trim(), parsed);
      } catch {
        onAdd(newKey.trim(), newValue);
      }
      setNewKey("");
      setNewValue("");
    }
  };

  return (
    <div className="space-y-2">
      {Object.entries(values).map(([key, value]) => (
        <div key={key} className="flex items-center gap-2">
          <Input value={key} disabled className="flex-1" />
          <Input
            value={typeof value === "object" && value !== null ? JSON.stringify(value) : value !== undefined && value !== null ? String(value) : ""}
            disabled
            className="flex-1"
          />
          <Button onClick={() => onRemove(key)} variant="ghost" size="icon">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder={placeholder || "Key"}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="Value (JSON supported)"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button onClick={handleAdd} variant="outline" size="sm">
          <Plus />
        </Button>
      </div>
    </div>
  );
}

interface ArrayEditorProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}

function ArrayEditor({ values, onChange, placeholder }: ArrayEditorProps) {
  const [newValue, setNewValue] = React.useState("");

  const handleAdd = () => {
    if (newValue.trim() && !values.includes(newValue.trim())) {
      onChange([...values, newValue.trim()]);
      setNewValue("");
    }
  };

  const handleRemove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {values.map((value, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input value={value} disabled className="flex-1" />
          <Button
            onClick={() => handleRemove(index)}
            variant="ghost"
            size="icon"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder={placeholder || "Add value..."}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button onClick={handleAdd} variant="outline" size="sm">
          <Plus />
        </Button>
      </div>
    </div>
  );
}
