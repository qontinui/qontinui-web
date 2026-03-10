"use client";

import { Plus, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import type { SensorDescriptor, SensorOptions } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TestCase } from "@/services/workflow-testing-service";
import { SortableTestCaseItem } from "./SortableTestCaseItem";
import { useDropZone } from "@qontinui/ui-bridge";

interface TestCaseSelectionCardProps {
  selectedTestCaseIds: string[];
  selectedTestCases: TestCase[];
  unselectedTestCases: TestCase[];
  sensors: SensorDescriptor<SensorOptions>[];
  onDragEnd: (event: DragEndEvent) => void;
  onAddTestCase: (testCaseId: string) => void;
  onRemoveTestCase: (testCaseId: string) => void;
  error?: string;
}

export function TestCaseSelectionCard({
  selectedTestCaseIds,
  selectedTestCases,
  unselectedTestCases,
  sensors,
  onDragEnd,
  onAddTestCase,
  onRemoveTestCase,
  error,
}: TestCaseSelectionCardProps) {
  useDropZone("selected-test-cases", {
    accepts: ["test-case"],
    effect: "reorder",
  });

  return (
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
                      onClick={() => onAddTestCase(testCase.id)}
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
                  onDragEnd={onDragEnd}
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
                          onRemove={onRemoveTestCase}
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
        {error && (
          <p className="text-sm text-destructive flex items-center gap-1 mt-2">
            <AlertCircle className="size-4" />
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
