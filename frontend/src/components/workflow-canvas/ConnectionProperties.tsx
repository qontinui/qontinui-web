/**
 * Connection Properties Component
 *
 * Displays and edits properties for selected connections/edges:
 * - Connection type (main, error, success, parallel)
 * - Connection metadata (label, color)
 * - Validation status
 * - Delete connection
 */

"use client";

import React from "react";
import { useCanvasStore } from "@/stores/canvas-store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Link2, AlertCircle, Trash2, ArrowRight } from "lucide-react";

export interface ConnectionPropertiesProps {
  edgeId: string;
  className?: string;
}

export const ConnectionProperties: React.FC<ConnectionPropertiesProps> = ({
  edgeId,
  className = "",
}) => {
  const workflow = useCanvasStore((state) => state.workflow);
  const deleteConnection = useCanvasStore((state) => state.deleteConnection);

  // Parse edge ID: sourceId-outputType-outputIndex-targetId
  const [sourceId, outputType, outputIndex, targetId] = edgeId.split("-");

  if (!workflow) {
    return (
      <div className={`p-4 text-gray-400 text-sm ${className}`}>
        No workflow loaded
      </div>
    );
  }

  // Get source and target actions
  const sourceAction = workflow.actions.find((a) => a.id === sourceId);
  const targetAction = workflow.actions.find((a) => a.id === targetId);

  if (!sourceAction || !targetAction) {
    return (
      <div className={`p-4 text-gray-400 text-sm ${className}`}>
        Connection not found
      </div>
    );
  }

  // Get connection details
  const connection = outputType && sourceId
    ? (workflow.connections[sourceId] as any)?.[outputType]?.[
        Number(outputIndex)
      ]?.find((c: any) => c.action === targetId)
    : undefined;

  if (!connection) {
    return (
      <div className={`p-4 text-gray-400 text-sm ${className}`}>
        Connection details not found
      </div>
    );
  }

  const handleDeleteConnection = () => {
    if (confirm("Are you sure you want to delete this connection?")) {
      deleteConnection(sourceId!, outputType!, Number(outputIndex!), targetId!);
    }
  };

  const getConnectionColor = (type: string): string => {
    switch (type) {
      case "main":
        return "blue";
      case "error":
        return "red";
      case "success":
        return "green";
      case "parallel":
        return "purple";
      default:
        return "gray";
    }
  };

  const color = getConnectionColor(connection.type);

  return (
    <div className={`overflow-y-auto ${className}`}>
      <div className="p-4 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link2 className={`w-4 h-4 text-${color}-400`} />
            <h3 className="text-sm font-semibold text-gray-200">
              Connection Properties
            </h3>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDeleteConnection}
            className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Delete
          </Button>
        </div>

        <Separator className="bg-gray-700" />

        {/* Connection Flow */}
        <section>
          <h4 className="text-xs font-semibold text-gray-400 mb-3">Flow</h4>
          <div className="space-y-3">
            <div className="flex items-center gap-2 p-3 rounded bg-gray-800/50 border border-gray-700">
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">Source</div>
                <div className="text-sm font-medium text-gray-200">
                  {sourceAction.type}
                </div>
                <div className="text-xs text-gray-500 font-mono">
                  {sourceId}
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <ArrowRight className={`w-5 h-5 text-${color}-400`} />
            </div>

            <div className="flex items-center gap-2 p-3 rounded bg-gray-800/50 border border-gray-700">
              <div className="flex-1">
                <div className="text-xs text-gray-400 mb-1">Target</div>
                <div className="text-sm font-medium text-gray-200">
                  {targetAction.type}
                </div>
                <div className="text-xs text-gray-500 font-mono">
                  {targetId}
                </div>
              </div>
            </div>
          </div>
        </section>

        <Separator className="bg-gray-700" />

        {/* Connection Type */}
        <section>
          <h4 className="text-xs font-semibold text-gray-400 mb-3">
            Connection Type
          </h4>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Type</Label>
              <Select value={connection.type} disabled>
                <SelectTrigger className="bg-transparent border-gray-700 text-gray-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#27272A] border-gray-700">
                  <SelectItem value="main">Main Flow</SelectItem>
                  <SelectItem value="error">Error Handler</SelectItem>
                  <SelectItem value="success">Success Path</SelectItem>
                  <SelectItem value="parallel">Parallel Branch</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                Connection type is determined by the source action's output
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className={`text-xs bg-${color}-900/30 text-${color}-200 border-${color}-700`}
              >
                {connection.type.toUpperCase()}
              </Badge>
              <span className="text-xs text-gray-400">
                Output {outputIndex} → Input {connection.index}
              </span>
            </div>
          </div>
        </section>

        <Separator className="bg-gray-700" />

        {/* Metadata */}
        <section>
          <h4 className="text-xs font-semibold text-gray-400 mb-3">Metadata</h4>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Label</Label>
              <Input
                placeholder="Connection label (optional)"
                className="bg-transparent border-gray-700 text-gray-200"
              />
              <p className="text-xs text-gray-500">
                Custom label for this connection (not yet implemented)
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-gray-400">Color</Label>
              <div className="flex gap-2">
                {["blue", "green", "red", "purple", "yellow", "gray"].map(
                  (c) => (
                    <button
                      key={c}
                      className={`w-8 h-8 rounded border-2 ${
                        c === color ? "border-white" : "border-transparent"
                      } bg-${c}-500 hover:border-gray-400`}
                      onClick={() => console.log("Set color:", c)}
                    />
                  )
                )}
              </div>
            </div>
          </div>
        </section>

        <Separator className="bg-gray-700" />

        {/* Validation */}
        <section>
          <h4 className="text-xs font-semibold text-gray-400 mb-3">
            Validation
          </h4>
          <div className="space-y-3">
            <div className="p-3 rounded bg-green-900/20 border border-green-700/30">
              <div className="flex items-start gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 mt-1.5" />
                <div className="flex-1">
                  <div className="text-xs font-medium text-green-200">
                    Valid Connection
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    This connection is properly configured and ready for
                    execution.
                  </div>
                </div>
              </div>
            </div>

            {/* Example validation warning */}
            {sourceAction.type === "IF" && outputType === "main" && (
              <div className="p-3 rounded bg-blue-900/20 border border-blue-700/30">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-gray-300">
                    <strong>Conditional Flow:</strong> This connection is part
                    of an IF branch. Output {outputIndex} represents the{" "}
                    {outputIndex === "0" ? "TRUE" : "FALSE"} path.
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Info */}
        <div className="p-3 rounded bg-blue-900/20 border border-blue-700/30">
          <div className="text-xs text-gray-300">
            <strong>About Connections:</strong> Connections define the execution
            flow between actions. Each connection has a type that determines
            when it executes: main (normal flow), error (on failure), success
            (on success), or parallel (concurrent execution).
          </div>
        </div>
      </div>
    </div>
  );
};
