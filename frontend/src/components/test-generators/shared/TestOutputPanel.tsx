/**
 * TestOutputPanel
 *
 * Shows a JSON preview of the TestGeneratorOutput and provides
 * export (download) and save-to-project functionality.
 *
 * The toolbar (Export JSON, Copy) is always rendered so that spec
 * assertions can discover them regardless of whether output exists.
 */

import { useState, useMemo } from "react";
import { Download, Save, Copy, Check } from "lucide-react";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import type { GeneratorSpecMetadata } from "../types";

interface TestOutputPanelProps {
  output: SpecConfig | null;
  onSaveToProject?: (output: SpecConfig) => Promise<void>;
  isSaving?: boolean;
}

export function TestOutputPanel({
  output,
  onSaveToProject,
  isSaving = false,
}: TestOutputPanelProps) {
  const [copied, setCopied] = useState(false);

  const jsonString = useMemo(() => {
    if (!output) return "";
    return JSON.stringify(output, null, 2);
  }, [output]);

  const handleExport = () => {
    if (!output) return;
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const genMeta = output.metadata as GeneratorSpecMetadata | undefined;
    const genType = genMeta?.generatorType || "spec";
    a.download = `${genType}.spec.uibridge.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!jsonString) return;
    await navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const groupCount = output?.groups.length ?? 0;
  const assertionCount = output
    ? output.groups.reduce((sum, g) => sum + g.assertions.length, 0)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-700 bg-neutral-800/50">
        <button
          onClick={handleExport}
          disabled={!output}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Export JSON
        </button>

        {onSaveToProject && output && (
          <button
            onClick={() => onSaveToProject(output)}
            disabled={isSaving}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" />
            {isSaving ? "Saving..." : "Save to Project"}
          </button>
        )}

        <button
          onClick={handleCopy}
          disabled={!output}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-neutral-700 text-neutral-300 rounded-md hover:bg-neutral-600 disabled:opacity-50 transition-colors ml-auto"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Stats */}
      <div className="px-4 py-2 text-xs text-neutral-400 border-b border-neutral-700/50 bg-neutral-900/30">
        {groupCount} groups, {assertionCount} assertions
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {output ? (
          <pre className="p-4 text-xs text-neutral-300 font-mono whitespace-pre-wrap break-words">
            {jsonString}
          </pre>
        ) : (
          <div className="flex items-center justify-center h-full text-neutral-500 text-sm">
            Generate test specifications to see output here.
          </div>
        )}
      </div>
    </div>
  );
}
