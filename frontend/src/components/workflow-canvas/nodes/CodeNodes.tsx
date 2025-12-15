/**
 * Code Execution Node Components
 *
 * Custom nodes for Python code execution:
 * - CODE_BLOCK: Inline Python code with Monaco editor
 * - CUSTOM_FUNCTION: Pre-registered uploaded Python functions
 */

import React, { useState } from "react";
import { NodeProps, Node as ReactFlowNode } from "@xyflow/react";
import { BaseNode, BaseNodeData } from "./BaseNode";
import { Code, Play, AlertCircle, CheckCircle, Loader2 } from "lucide-react";
import Editor from "@monaco-editor/react";
import type {
  CodeBlockActionConfig,
  CustomFunctionActionConfig,
} from "@/lib/action-schema/configs/code-actions";

// =============================================================================
// CODE_BLOCK Node
// =============================================================================

/**
 * CODE_BLOCK Node - Inline Python code execution
 *
 * Features:
 * - Monaco editor for syntax highlighting
 * - Live validation
 * - Error display
 * - Collapsible code editor
 */
export function CodeBlockNode(props: NodeProps<ReactFlowNode<BaseNodeData>>) {
  const config = props.data.action.config as CodeBlockActionConfig;
  const [showEditor, setShowEditor] = useState(false);
  const [validationStatus, setValidationStatus] = useState<
    "idle" | "validating" | "valid" | "invalid"
  >("idle");
  const [validationError, setValidationError] = useState<string | null>(null);

  // Get code preview (first line or empty)
  const codePreview = config.code
    ? (config.code.split("\n")[0]?.substring(0, 40) ?? "") +
      (config.code.length > 40 ? "..." : "")
    : "Empty code block";

  // Output variable display
  const outputDisplay = Array.isArray(config.outputVariable)
    ? config.outputVariable.join(", ")
    : config.outputVariable || "result";

  const handleEditorChange = async (value: string | undefined) => {
    if (!value) return;

    // Update config
    config.code = value;

    // Trigger validation (debounced in practice)
    setValidationStatus("validating");

    try {
      // Call validation endpoint
      const response = await fetch("/api/v1/code/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: value,
          allowed_imports: config.allowedImports || [
            "re",
            "json",
            "math",
            "datetime",
          ],
        }),
      });

      const result = await response.json();

      if (result.valid) {
        setValidationStatus("valid");
        setValidationError(null);
      } else {
        setValidationStatus("invalid");
        setValidationError(result.errors.map((e: unknown) => e.message).join("; "));
      }
    } catch (error) {
      setValidationStatus("invalid");
      setValidationError("Validation failed");
    }
  };

  // Render validation status icon
  const renderValidationIcon = () => {
    switch (validationStatus) {
      case "validating":
        return <Loader2 className="w-3 h-3 animate-spin text-gray-500" />;
      case "valid":
        return <CheckCircle className="w-3 h-3 text-green-500" />;
      case "invalid":
        return <AlertCircle className="w-3 h-3 text-red-500" />;
      default:
        return null;
    }
  };

  return (
    <div className="code-block-node">
      <BaseNode
        {...props}
        className="code-node code-block-node border-indigo-400"
      />

      {/* Expandable editor section */}
      <div className="mt-2">
        <button
          onClick={() => setShowEditor(!showEditor)}
          className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 transition-colors"
        >
          <Code className="w-3 h-3" />
          {showEditor ? "Hide Code" : "Show Code"}
          {renderValidationIcon()}
        </button>

        {showEditor && (
          <div className="mt-2 border border-gray-300 rounded-md overflow-hidden">
            <Editor
              height="200px"
              defaultLanguage="python"
              value={config.code}
              onChange={handleEditorChange}
              theme="vs-light"
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
                tabSize: 4,
                insertSpaces: true,
              }}
            />

            {/* Validation error display */}
            {validationStatus === "invalid" && validationError && (
              <div className="bg-red-50 border-t border-red-200 p-2 text-xs text-red-700">
                <AlertCircle className="w-3 h-3 inline mr-1" />
                {validationError}
              </div>
            )}

            {/* Info footer */}
            <div className="bg-gray-50 border-t border-gray-200 p-2 text-xs text-gray-600">
              <div className="flex items-center justify-between">
                <span>Output: {outputDisplay}</span>
                <span>Timeout: {config.timeout || 30}s</span>
              </div>
            </div>
          </div>
        )}

        {/* Collapsed view - code preview */}
        {!showEditor && (
          <div className="mt-1 text-xs text-gray-500 font-mono bg-gray-50 p-2 rounded border border-gray-200">
            {codePreview}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// CUSTOM_FUNCTION Node
// =============================================================================

/**
 * CUSTOM_FUNCTION Node - Execute uploaded Python function
 *
 * Features:
 * - Display function name and description
 * - Show input/output parameters
 * - Link to function source
 */
export function CustomFunctionNode(
  props: NodeProps<ReactFlowNode<BaseNodeData>>
) {
  const config = props.data.action.config as CustomFunctionActionConfig;
  const [showDetails, setShowDetails] = useState(false);

  const inputCount = Object.keys(config.inputs || {}).length;
  const outputCount = Object.keys(config.outputs || {}).length;

  return (
    <div className="custom-function-node">
      <BaseNode
        {...props}
        className="code-node custom-function-node border-indigo-500"
      />

      {/* Function info */}
      <div className="mt-2">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-900 transition-colors w-full"
        >
          <Play className="w-3 h-3" />
          <span className="font-medium">{config.functionName}</span>
          <span className="ml-auto text-gray-400">
            {showDetails ? "▼" : "▶"}
          </span>
        </button>

        {showDetails && (
          <div className="mt-2 space-y-2 text-xs">
            {/* Inputs */}
            {inputCount > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-2">
                <div className="font-medium text-blue-900 mb-1">
                  Inputs ({inputCount}):
                </div>
                <div className="space-y-1">
                  {Object.entries(config.inputs).map(([key, value]) => (
                    <div key={key} className="text-blue-700 font-mono">
                      {key}:{" "}
                      <span className="text-blue-600">
                        {JSON.stringify(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Outputs */}
            {outputCount > 0 && (
              <div className="bg-green-50 border border-green-200 rounded p-2">
                <div className="font-medium text-green-900 mb-1">
                  Outputs ({outputCount}):
                </div>
                <div className="space-y-1">
                  {Object.entries(config.outputs).map(([key, value]) => (
                    <div key={key} className="text-green-700 font-mono">
                      {key} → {value}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Function ID */}
            <div className="text-gray-500 font-mono text-[10px]">
              ID: {config.functionId}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
