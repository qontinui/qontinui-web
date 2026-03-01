import React from "react";
import { Eye, EyeOff } from "lucide-react";
import type { SpecPromptResult } from "@/lib/spec-prompt-builder";

interface PromptPreviewProps {
  promptPreview: SpecPromptResult;
  showPromptPreview: boolean;
  setShowPromptPreview: (show: boolean | ((v: boolean) => boolean)) => void;
}

export function PromptPreview({
  promptPreview,
  showPromptPreview,
  setShowPromptPreview,
}: PromptPreviewProps) {
  return (
    <div className="border-t border-zinc-700 pt-2">
      <button
        onClick={() => setShowPromptPreview((v: boolean) => !v)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {showPromptPreview ? (
          <EyeOff className="w-3 h-3" />
        ) : (
          <Eye className="w-3 h-3" />
        )}
        {showPromptPreview ? "Hide" : "Preview"} AI prompt
        <span className="text-zinc-600">
          ({promptPreview.totalGroups} group
          {promptPreview.totalGroups !== 1 ? "s" : ""} from{" "}
          {promptPreview.pageCount} page
          {promptPreview.pageCount !== 1 ? "s" : ""})
        </span>
      </button>
      {showPromptPreview && (
        <pre className="mt-2 max-h-[200px] overflow-auto rounded-md bg-zinc-900 border border-zinc-700 p-3 text-[11px] text-zinc-400 font-mono whitespace-pre-wrap">
          {promptPreview.prompt}
        </pre>
      )}
    </div>
  );
}
