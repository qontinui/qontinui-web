"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Plus, CheckCircle } from "lucide-react";
import {
  CheckpointExpectation,
  OCRAssertion,
} from "@/types/checkpoint-expectations";
import { OCRAssertionEditor } from "./OCRAssertionEditor";
import { ClaudeReviewEditor } from "./ClaudeReviewEditor";

export interface CheckpointEditorProps {
  checkpoint: CheckpointExpectation;
  onChange: (checkpoint: CheckpointExpectation) => void;
}

/**
 * Editor for a single checkpoint's expectations
 *
 * Includes:
 * - Checkpoint name
 * - OCR assertions list
 * - Claude review notes list
 * - Screenshot required toggle
 */
export function CheckpointEditor({
  checkpoint,
  onChange,
}: CheckpointEditorProps) {
  const updateCheckpoint = (updates: Partial<CheckpointExpectation>) => {
    onChange({ ...checkpoint, ...updates });
  };

  const addOCRAssertion = () => {
    const newAssertion: OCRAssertion = {
      id: `ocr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: "text_present",
      pattern: "",
      isRegex: false,
    };
    updateCheckpoint({
      ocrAssertions: [...checkpoint.ocrAssertions, newAssertion],
    });
  };

  const updateOCRAssertion = (index: number, assertion: OCRAssertion) => {
    const updated = [...checkpoint.ocrAssertions];
    updated[index] = assertion;
    updateCheckpoint({ ocrAssertions: updated });
  };

  const deleteOCRAssertion = (index: number) => {
    const updated = checkpoint.ocrAssertions.filter((_, i) => i !== index);
    updateCheckpoint({ ocrAssertions: updated });
  };

  const updateClaudeReviewNotes = (notes: string[]) => {
    updateCheckpoint({ claudeReviewNotes: notes });
  };

  return (
    <div className="space-y-4">
      {/* Header with checkpoint icon */}
      <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/30 rounded-md">
        <CheckCircle className="w-4 h-4 text-green-400" />
        <div className="flex-1">
          <p className="text-sm font-medium text-green-300">
            Checkpoint Configuration
          </p>
          <p className="text-xs text-green-400/70">
            Define expectations to validate at this checkpoint
          </p>
        </div>
      </div>

      {/* Checkpoint Name */}
      <div className="space-y-2">
        <Label className="text-xs text-text-muted">Checkpoint Name</Label>
        <Input
          type="text"
          value={checkpoint.name}
          onChange={(e) => updateCheckpoint({ name: e.target.value })}
          placeholder="e.g., After Login, Dashboard Loaded"
          className="bg-transparent border-border-default"
        />
        <p className="text-xs text-text-muted">
          Descriptive name for this checkpoint in the workflow
        </p>
      </div>

      {/* Screenshot Required Toggle */}
      <div className="flex items-center justify-between py-2">
        <div className="space-y-0.5">
          <Label className="text-sm text-text-secondary">
            Screenshot Required
          </Label>
          <p className="text-xs text-text-muted">
            Capture screenshot at this checkpoint for validation
          </p>
        </div>
        <Switch
          checked={checkpoint.screenshotRequired}
          onCheckedChange={(checked) =>
            updateCheckpoint({ screenshotRequired: checked })
          }
        />
      </div>

      {/* OCR Assertions Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-text-secondary">OCR Assertions</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={addOCRAssertion}
            className="h-7 text-xs text-brand-primary hover:text-brand-primary/80 hover:bg-brand-primary/10"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Assertion
          </Button>
        </div>

        {checkpoint.ocrAssertions.length === 0 ? (
          <Card className="p-4 bg-surface-raised/30 border-border-default">
            <p className="text-sm text-text-muted text-center">
              No OCR assertions defined
            </p>
            <p className="text-xs text-text-muted text-center mt-1">
              Add assertions to validate text on screen
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {checkpoint.ocrAssertions.map((assertion, index) => (
              <OCRAssertionEditor
                key={assertion.id}
                assertion={assertion}
                onChange={(updated) => updateOCRAssertion(index, updated)}
                onDelete={() => deleteOCRAssertion(index)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Claude Review Notes Section */}
      <ClaudeReviewEditor
        notes={checkpoint.claudeReviewNotes}
        onChange={updateClaudeReviewNotes}
      />

      {/* Summary */}
      <div className="p-3 bg-surface-raised/30 border border-border-default rounded-md">
        <p className="text-xs text-text-muted font-medium mb-2">
          Checkpoint Summary:
        </p>
        <ul className="text-xs text-text-muted space-y-1">
          <li>
            <span className="text-text-muted">
              {checkpoint.ocrAssertions.length}
            </span>{" "}
            OCR assertion(s)
          </li>
          <li>
            <span className="text-text-muted">
              {checkpoint.claudeReviewNotes.length}
            </span>{" "}
            Claude review note(s)
          </li>
          <li>
            Screenshot:{" "}
            <span
              className={
                checkpoint.screenshotRequired
                  ? "text-brand-success"
                  : "text-text-muted"
              }
            >
              {checkpoint.screenshotRequired ? "Required" : "Optional"}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
