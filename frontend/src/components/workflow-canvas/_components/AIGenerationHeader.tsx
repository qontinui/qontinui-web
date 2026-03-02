import React from "react";
import { X, Sparkles } from "lucide-react";

interface AIGenerationHeaderProps {
  onClose: () => void;
}

export function AIGenerationHeader({ onClose }: AIGenerationHeaderProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle dark:border-border-default">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
          <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text-primary dark:text-white">
            AI Workflow Generator
          </h2>
          <p className="text-sm text-text-muted dark:text-text-muted">
            Describe your workflow in plain English
          </p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="p-2 hover:bg-surface-raised/50 dark:hover:bg-surface-raised rounded-lg transition-colors"
        data-ui-id="dialog-ai-generation-close-btn"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
