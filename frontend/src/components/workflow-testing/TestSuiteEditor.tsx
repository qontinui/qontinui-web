/**
 * TestSuiteEditor - Component for creating and editing test suites
 *
 * Features:
 * - Suite name and description
 * - Execution order configuration (parallel/sequential)
 * - Stop on failure toggle
 * - Tags management
 * - Drag-and-drop test case reordering
 * - Add/remove test cases from available tests
 * - Save/cancel with validation
 */

"use client";

import * as React from "react";
import {
  Plus,
  Trash2,
  Save,
  X,
  GripVertical,
  AlertCircle,
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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { TestSuite, TestCase } from "@/services/workflow-testing-service";

// DnD Kit imports
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ============================================================================
// Types
// ============================================================================

export interface TestSuiteEditorProps {
  suite?: TestSuite;
  availableTestCases: TestCase[];
  onSave: (suite: TestSuite) => void;
  onCancel: () => void;
  className?: string;
}

interface ValidationErrors {
  name?: string;
  testCases?: string;
  [key: string]: string | undefined;
}

// ============================================================================
// Component
// ============================================================================

export function TestSuiteEditor({
  suite,
  availableTestCases,
  onSave,
  onCancel,
  className,
}: TestSuiteEditorProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [name, setName] = React.useState(suite?.name || "");
  const [description, setDescription] = React.useState(
    suite?.description || ""
  );
  const [executionOrder, setExecutionOrder] = React.useState<
    "parallel" | "sequential"
  >(suite?.executionOrder || "sequential");
  const [stopOnFailure, setStopOnFailure] = React.useState(
    suite?.stopOnFailure || false
  );
  const [tags, setTags] = React.useState<string[]>(suite?.tags || []);
  const [newTag, setNewTag] = React.useState("");
  const [selectedTestCaseIds, setSelectedTestCaseIds] = React.useState<
    string[]
  >(suite?.testCaseIds || []);

  // UI state
  const [errors, setErrors] = React.useState<ValidationErrors>({});

  // ========================================================================
  // DnD Kit Setup
  // ========================================================================

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = selectedTestCaseIds.indexOf(active.id as string);
      const newIndex = selectedTestCaseIds.indexOf(over.id as string);

      setSelectedTestCaseIds(arrayMove(selectedTestCaseIds, oldIndex, newIndex));
    }
  };

  // ========================================================================
  // Computed Values
  // ========================================================================

  const selectedTestCases = React.useMemo(() => {
    return selectedTestCaseIds
      .map((id) => availableTestCases.find((tc) => tc.id === id))
      .filter((tc): tc is TestCase => tc !== undefined);
  }, [selectedTestCaseIds, availableTestCases]);

  const unselectedTestCases = React.useMemo(() => {
    return availableTestCases.filter(
      (tc) => !selectedTestCaseIds.includes(tc.id)
    );
  }, [availableTestCases, selectedTestCaseIds]);

  // ========================================================================
  // Validation
  // ========================================================================

  const validate = React.useCallback((): boolean => {
    const newErrors: ValidationErrors = {};

    if (!name.trim()) {
      newErrors.name = "Suite name is required";
    }

    if (selectedTestCaseIds.length === 0) {
      newErrors.testCases = "At least one test case is required";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [name, selectedTestCaseIds]);

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleSave = React.useCallback(() => {
    if (!validate()) {
      return;
    }

    const suiteData: TestSuite = {
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
  }, [
    validate,
    suite,
    name,
    description,
    selectedTestCaseIds,
    executionOrder,
    stopOnFailure,
    tags,
    onSave,
  ]);

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

  // Test case handlers
  const addTestCase = React.useCallback((testCaseId: string) => {
    setSelectedTestCaseIds((prev) => [...prev, testCaseId]);
  }, []);

  const removeTestCase = React.useCallback((testCaseId: string) => {
    setSelectedTestCaseIds((prev) => prev.filter((id) => id !== testCaseId));
  }, []);

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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, onCancel]);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle>{suite ? "Edit Test Suite" : "New Test Suite"}</CardTitle>
          <CardDescription>
            Group test cases together for organized execution
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Suite Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Login Flow Tests"
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
              placeholder="Describe the purpose of this test suite..."
              rows={3}
            />
          </div>

          <Separator />

          {/* Execution Configuration */}
          <div className="grid grid-cols-2 gap-4">
            {/* Execution Order */}
            <div className="space-y-2">
              <Label htmlFor="executionOrder">Execution Order</Label>
              <Select
                value={executionOrder}
                onValueChange={(value) =>
                  setExecutionOrder(value as "parallel" | "sequential")
                }
              >
                <SelectTrigger id="executionOrder">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sequential">Sequential</SelectItem>
                  <SelectItem value="parallel">Parallel</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Stop on Failure */}
            <div className="space-y-2">
              <Label htmlFor="stopOnFailure">Stop on Failure</Label>
              <div className="flex items-center space-x-2 h-10">
                <Checkbox
                  id="stopOnFailure"
                  checked={stopOnFailure}
                  onCheckedChange={(checked) =>
                    setStopOnFailure(checked === true)
                  }
                />
                <label
                  htmlFor="stopOnFailure"
                  className="text-sm text-muted-foreground cursor-pointer"
                >
                  Stop execution on first failure
                </label>
              </div>
            </div>
          </div>

          <Separator />

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

      {/* Test Cases Management */}
      <Card>
        <CardHeader>
          <CardTitle>
            Test Cases <span className="text-destructive">*</span>
          </CardTitle>
          <CardDescription>
            Select and reorder test cases for this suite
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {/* Available Test Cases */}
            <div className="space-y-2">
              <Label>Available Tests ({unselectedTestCases.length})</Label>
              <ScrollArea className="h-[400px] border rounded-md">
                <div className="p-2 space-y-2">
                  {unselectedTestCases.map((testCase) => (
                    <div
                      key={testCase.id}
                      className="flex items-center justify-between p-2 border rounded-md hover:bg-accent/50"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {testCase.name}
                        </p>
                        {testCase.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {testCase.description}
                          </p>
                        )}
                      </div>
                      <Button
                        onClick={() => addTestCase(testCase.id)}
                        variant="ghost"
                        size="sm"
                      >
                        <Plus className="size-4" />
                      </Button>
                    </div>
                  ))}
                  {unselectedTestCases.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      All test cases added
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Selected Test Cases (Drag and Drop) */}
            <div className="space-y-2">
              <Label>
                Selected Tests ({selectedTestCases.length})
                {selectedTestCases.length > 0 && (
                  <span className="text-xs text-muted-foreground ml-2">
                    Drag to reorder
                  </span>
                )}
              </Label>
              <ScrollArea className="h-[400px] border rounded-md">
                <div className="p-2">
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={selectedTestCaseIds}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-2">
                        {selectedTestCases.map((testCase, index) => (
                          <SortableTestCaseItem
                            key={testCase.id}
                            testCase={testCase}
                            index={index}
                            onRemove={removeTestCase}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                  {selectedTestCases.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No test cases selected
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
          {errors.testCases && (
            <p className="text-sm text-destructive flex items-center gap-1 mt-2">
              <AlertCircle className="size-4" />
              {errors.testCases}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardFooter className="flex justify-between">
          <Button onClick={onCancel} variant="outline">
            <X />
            Cancel
          </Button>
          <Button onClick={handleSave}>
            <Save />
            Save Suite
          </Button>
        </CardFooter>
      </Card>

      {/* Keyboard shortcuts hint */}
      <div className="text-xs text-muted-foreground text-center">
        <p>Keyboard shortcuts: Ctrl+S to save, Esc to cancel</p>
      </div>
    </div>
  );
}

// ============================================================================
// Sortable Test Case Item
// ============================================================================

interface SortableTestCaseItemProps {
  testCase: TestCase;
  index: number;
  onRemove: (id: string) => void;
}

function SortableTestCaseItem({
  testCase,
  index,
  onRemove,
}: SortableTestCaseItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: testCase.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 p-2 border rounded-md bg-card",
        isDragging && "opacity-50"
      )}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="size-5" />
      </button>

      {/* Order Number */}
      <div className="flex items-center justify-center size-6 rounded-full bg-accent text-xs font-medium">
        {index + 1}
      </div>

      {/* Test Case Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{testCase.name}</p>
        {testCase.description && (
          <p className="text-xs text-muted-foreground truncate">
            {testCase.description}
          </p>
        )}
      </div>

      {/* Remove Button */}
      <Button
        onClick={() => onRemove(testCase.id)}
        variant="ghost"
        size="sm"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
