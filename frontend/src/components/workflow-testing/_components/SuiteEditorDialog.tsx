"use client";

import { Plus, X, Settings, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type { SuiteEditorDialogProps } from "../test-suite-manager-types";
import { useSuiteEditor } from "../_hooks/useSuiteEditor";

export function SuiteEditorDialog({
  suite,
  testCases,
  workflows,
  onSave,
  onCancel,
}: SuiteEditorDialogProps) {
  const editor = useSuiteEditor(suite, testCases, onSave);

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
              value={editor.name}
              onChange={(e) => editor.setName(e.target.value)}
              placeholder="e.g., Login Flow Tests"
              aria-invalid={!!editor.errors.name}
            />
            {editor.errors.name && (
              <p className="text-sm text-destructive">{editor.errors.name}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="suite-description">Description</Label>
            <Textarea
              id="suite-description"
              value={editor.description}
              onChange={(e) => editor.setDescription(e.target.value)}
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
                value={editor.executionOrder}
                onValueChange={(value) =>
                  editor.setExecutionOrder(value as "parallel" | "sequential")
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
                checked={editor.stopOnFailure}
                onChange={(e) => editor.setStopOnFailure(e.target.checked)}
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
                value={editor.newTag}
                onChange={(e) => editor.setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    editor.addTag();
                  }
                }}
                placeholder="Add tag..."
              />
              <Button onClick={editor.addTag} variant="outline" size="sm">
                <Plus />
                Add
              </Button>
            </div>
            {editor.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {editor.tags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                    <button
                      onClick={() => editor.removeTag(tag)}
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
                {editor.selectedTestCaseIds.length} selected
              </div>
            </div>

            {/* Filter by workflow */}
            <div className="space-y-2">
              <Label htmlFor="filter-workflow">Filter by Workflow</Label>
              <Select
                value={editor.filterWorkflow}
                onValueChange={editor.setFilterWorkflow}
              >
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
              {editor.filteredTestCases.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground">
                  No test cases available
                </div>
              ) : (
                <div className="divide-y">
                  {editor.filteredTestCases.map((testCase) => {
                    const workflow = workflows.find(
                      (w) => w.id === testCase.workflowId
                    );
                    const isSelected = editor.selectedTestCaseIds.includes(
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
                          onChange={() => editor.toggleTestCase(testCase.id)}
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
            {editor.errors.testCases && (
              <p className="text-sm text-destructive">
                {editor.errors.testCases}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onCancel} variant="outline">
            <X />
            Cancel
          </Button>
          <Button onClick={editor.handleSave}>
            <Save />
            Save Suite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
