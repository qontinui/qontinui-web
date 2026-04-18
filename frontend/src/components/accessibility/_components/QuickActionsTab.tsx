"use client";

import { MousePointer2, Type, Focus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AccessibilityNode } from "@qontinui/shared-types/accessibility";

interface QuickActionsTabProps {
  actionRef: string;
  onActionRefChange: (ref: string) => void;
  actionText: string;
  onActionTextChange: (text: string) => void;
  selectedRef: string | null;
  selectedNode: AccessibilityNode | null;
  isLoading: boolean;
  onQuickClick: () => void;
  onQuickFocus: () => void;
  onQuickType: () => void;
}

export function QuickActionsTab({
  actionRef,
  onActionRefChange,
  actionText,
  onActionTextChange,
  selectedRef,
  selectedNode,
  isLoading,
  onQuickClick,
  onQuickFocus,
  onQuickType,
}: QuickActionsTabProps) {
  return (
    <div className="space-y-4">
      {/* Ref input */}
      <div className="space-y-2">
        <Label className="text-xs">Target Ref</Label>
        <div className="flex gap-2">
          <Input
            value={actionRef}
            onChange={(e) => onActionRefChange(e.target.value)}
            placeholder="@e1"
            className="font-mono"
          />
          {selectedRef && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onActionRefChange(selectedRef)}
            >
              Use Selected
            </Button>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <Button
          variant="outline"
          onClick={onQuickClick}
          disabled={!actionRef || isLoading}
          className="gap-2"
        >
          <MousePointer2 className="h-4 w-4" />
          Click
        </Button>
        <Button
          variant="outline"
          onClick={onQuickFocus}
          disabled={!actionRef || isLoading}
          className="gap-2"
        >
          <Focus className="h-4 w-4" />
          Focus
        </Button>
        <Button
          variant="outline"
          onClick={onQuickType}
          disabled={!actionRef || !actionText || isLoading}
          className="gap-2"
        >
          <Type className="h-4 w-4" />
          Type
        </Button>
      </div>

      {/* Text input for type action */}
      <div className="space-y-2">
        <Label className="text-xs">Text to Type</Label>
        <Input
          value={actionText}
          onChange={(e) => onActionTextChange(e.target.value)}
          placeholder="Enter text to type..."
        />
      </div>

      {/* Selected node info */}
      {selectedNode && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Selected Element</CardTitle>
          </CardHeader>
          <CardContent className="py-2 space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="font-mono">
                {selectedNode.ref}
              </Badge>
              <Badge variant="outline">{selectedNode.role}</Badge>
              {selectedNode.isInteractive && (
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                  Interactive
                </Badge>
              )}
            </div>
            {selectedNode.name && (
              <p className="text-sm text-muted-foreground">
                &quot;{selectedNode.name}&quot;
              </p>
            )}
            {selectedNode.value && (
              <p className="text-sm">
                <span className="text-muted-foreground">Value:</span>{" "}
                {selectedNode.value}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
