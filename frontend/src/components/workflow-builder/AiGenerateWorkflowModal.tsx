"use client";

import React, { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { runnerApi } from "@/lib/runner-api";
import type { UnifiedWorkflow } from "@/types/unified-workflow";

interface AiGenerateWorkflowModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerated: (workflow: UnifiedWorkflow) => void;
}

export function AiGenerateWorkflowModal({
  isOpen,
  onClose,
  onGenerated,
}: AiGenerateWorkflowModalProps) {
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!description.trim()) return;

    setIsGenerating(true);
    setError(null);

    try {
      const result = await runnerApi.saveUnifiedWorkflow({
        name: description.slice(0, 50),
        description: description,
      });
      onGenerated(result);
      setDescription("");
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate workflow"
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-400" />
            Generate Workflow with AI
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Describe what you want to automate and AI will generate a workflow
            for you.
          </p>

          <Textarea
            className="min-h-[120px] bg-zinc-800 border-zinc-700 text-zinc-200 text-sm"
            placeholder="e.g., Run linting, type checking, and tests on my Python project. If any fail, use AI to fix the issues and re-run."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800/50 rounded-md">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!description.trim() || isGenerating}
          >
            {isGenerating ? "Generating..." : "Generate Workflow"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
