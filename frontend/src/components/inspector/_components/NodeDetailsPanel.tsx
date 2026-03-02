import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Copy, Check, Focus, MousePointer, Type, X } from "lucide-react";
import { AccessibilityNode } from "../_types";
import {
  getRoleIcon,
  getRoleBadgeVariant,
  executeAccessibilityCommand,
} from "../_utils";

export function NodeDetailsPanel({
  node,
  onClose,
}: {
  node: AccessibilityNode;
  onClose: () => void;
}) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [actionResult, setActionResult] = useState<{
    success: boolean;
    error?: string;
  } | null>(null);
  const [fillValue, setFillValue] = useState("");
  const [showFillInput, setShowFillInput] = useState(false);

  const handleCopy = () => {
    if (node.ref) {
      navigator.clipboard.writeText(node.ref);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    }
  };

  const handleClick = async () => {
    if (!node.ref) return;
    setActionResult(null);
    const result = await executeAccessibilityCommand("click_ref", {
      ref: node.ref,
    });
    setActionResult(result);
    setTimeout(() => setActionResult(null), 3000);
  };

  const handleFocus = async () => {
    if (!node.ref) return;
    setActionResult(null);
    const result = await executeAccessibilityCommand("focus_ref", {
      ref: node.ref,
    });
    setActionResult(result);
    setTimeout(() => setActionResult(null), 3000);
  };

  const handleFill = async () => {
    if (!node.ref || !fillValue) return;
    setActionResult(null);
    const result = await executeAccessibilityCommand("fill_ref", {
      ref: node.ref,
      value: fillValue,
      clear_first: false,
    });
    setActionResult(result);
    setShowFillInput(false);
    setFillValue("");
    setTimeout(() => setActionResult(null), 3000);
  };

  const isTextInput = ["textbox", "searchbox", "combobox"].includes(node.role);

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-white flex items-center gap-2">
            {getRoleIcon(node.role)}
            <Badge variant={getRoleBadgeVariant(node.role)} className="text-xs">
              {node.role}
            </Badge>
            {node.ref && (
              <span className="text-xs font-mono text-blue-400">
                {node.ref}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-1">
            {node.ref && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-text-muted hover:text-white"
                onClick={handleCopy}
                title="Copy ref"
              >
                {copySuccess ? (
                  <Check className="w-3.5 h-3.5 text-green-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-text-muted hover:text-white"
              onClick={onClose}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5 text-xs">
          {node.name && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Name:</span>
              <span className="text-text-primary break-all">{node.name}</span>
            </div>
          )}
          {node.value && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Value:</span>
              <span className="text-text-primary break-all">{node.value}</span>
            </div>
          )}
          {node.description && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Desc:</span>
              <span className="text-text-primary break-all">
                {node.description}
              </span>
            </div>
          )}
          <div className="flex gap-2">
            <span className="text-text-muted w-20 shrink-0">Interactive:</span>
            <span
              className={
                node.is_interactive ? "text-green-400" : "text-text-muted"
              }
            >
              {node.is_interactive ? "Yes" : "No"}
            </span>
          </div>
          {node.bounds && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">Bounds:</span>
              <span className="text-text-primary font-mono">
                ({Math.round(node.bounds.x)}, {Math.round(node.bounds.y)}){" "}
                {Math.round(node.bounds.width)}x{Math.round(node.bounds.height)}
              </span>
            </div>
          )}
          {node.state && (
            <div className="flex gap-2">
              <span className="text-text-muted w-20 shrink-0">State:</span>
              <span className="text-text-primary font-mono text-[10px]">
                {Object.entries(node.state)
                  .filter(([, v]) => v)
                  .map(([k]) => k.replace("is_", ""))
                  .join(", ") || "none"}
              </span>
            </div>
          )}
        </div>

        {node.is_interactive && node.ref && (
          <div className="pt-2 border-t border-border-subtle/50">
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClick}
                className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
              >
                <MousePointer className="w-3.5 h-3.5 mr-1.5" />
                Click
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleFocus}
                className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
              >
                <Focus className="w-3.5 h-3.5 mr-1.5" />
                Focus
              </Button>
              {isTextInput && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowFillInput(!showFillInput)}
                  className={
                    showFillInput
                      ? "bg-green-500/20 text-green-400"
                      : "text-green-400 hover:text-green-300 hover:bg-green-500/10"
                  }
                >
                  <Type className="w-3.5 h-3.5 mr-1.5" />
                  Fill
                </Button>
              )}
            </div>

            {showFillInput && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={fillValue}
                  onChange={(e) => setFillValue(e.target.value)}
                  placeholder="Text to type..."
                  className="flex-1 h-8 text-xs bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleFill();
                    if (e.key === "Escape") setShowFillInput(false);
                  }}
                />
                <Button
                  size="sm"
                  onClick={handleFill}
                  disabled={!fillValue}
                  className="bg-green-600 hover:bg-green-700 text-white h-8"
                >
                  Type
                </Button>
              </div>
            )}

            {actionResult && (
              <div
                className={`mt-2 px-2 py-1.5 rounded text-xs ${
                  actionResult.success
                    ? "bg-green-950/30 text-green-400 border border-green-500/30"
                    : "bg-red-950/30 text-red-400 border border-red-500/30"
                }`}
              >
                {actionResult.success
                  ? "Action completed"
                  : actionResult.error || "Action failed"}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
