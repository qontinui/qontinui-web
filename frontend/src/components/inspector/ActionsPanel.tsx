"use client";

import type { ExternalElement } from "@/hooks/use-external-ui-bridge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play,
  MousePointerClick,
  Type,
  Focus,
  Eye,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface ActionsPanelProps {
  selectedElement: ExternalElement | null;
  actionType: "click" | "type" | "focus";
  onActionTypeChange: (t: "click" | "type" | "focus") => void;
  typeText: string;
  onTypeTextChange: (t: string) => void;
  actionResult: { success: boolean; message: string } | null;
  isExecutingAction: boolean;
  onExecuteAction: () => void;
  targetType: "browser" | "desktop";
  onHighlightElement?: (id: string) => Promise<void>;
}

export function ActionsPanel({
  selectedElement,
  actionType,
  onActionTypeChange,
  typeText,
  onTypeTextChange,
  actionResult,
  isExecutingAction,
  onExecuteAction,
  targetType,
  onHighlightElement,
}: ActionsPanelProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader>
        <CardTitle className="text-base text-white flex items-center gap-2">
          <Play className="w-4 h-4" />
          Element Actions
        </CardTitle>
        <CardDescription className="text-text-muted">
          Execute click, type, or focus actions on the selected element
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedElement ? (
          <>
            <div className="flex items-center gap-2 bg-purple-950/20 border border-purple-500/30 rounded-lg p-3">
              <MousePointerClick className="w-4 h-4 text-purple-400 flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm text-purple-400 font-mono truncate">
                  {selectedElement.id}
                </p>
                {selectedElement.text && (
                  <p className="text-xs text-text-muted truncate">
                    {selectedElement.text}
                  </p>
                )}
              </div>
              {targetType === "browser" && onHighlightElement && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onHighlightElement(selectedElement.id)}
                  className="ml-auto"
                >
                  <Eye className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              {(
                [
                  { key: "click", label: "Click", icon: MousePointerClick },
                  { key: "type", label: "Type", icon: Type },
                  { key: "focus", label: "Focus", icon: Focus },
                ] as const
              ).map(({ key, label, icon: Icon }) => (
                <Button
                  key={key}
                  variant={actionType === key ? "default" : "outline"}
                  size="sm"
                  onClick={() => onActionTypeChange(key)}
                >
                  <Icon className="w-3.5 h-3.5 mr-1.5" />
                  {label}
                </Button>
              ))}
            </div>

            {actionType === "type" && (
              <Input
                placeholder="Text to type..."
                value={typeText}
                onChange={(e) => onTypeTextChange(e.target.value)}
                className="bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
              />
            )}

            <Button
              onClick={onExecuteAction}
              disabled={
                isExecutingAction || (actionType === "type" && !typeText.trim())
              }
              className="w-full bg-brand-primary hover:bg-brand-primary/90 text-black font-semibold"
            >
              {isExecutingAction ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Executing...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Execute {actionType}
                </>
              )}
            </Button>

            {actionResult && (
              <div
                className={`flex items-center gap-2 rounded-lg p-3 ${
                  actionResult.success
                    ? "text-green-400 bg-green-950/20 border border-green-500/30"
                    : "text-red-400 bg-red-950/20 border border-red-500/30"
                }`}
              >
                {actionResult.success ? (
                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                )}
                <p className="text-sm">{actionResult.message}</p>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-12">
            <MousePointerClick className="w-10 h-10 mx-auto mb-3 text-text-muted" />
            <p className="text-sm text-text-muted">
              Select an element from the Elements tab first
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
