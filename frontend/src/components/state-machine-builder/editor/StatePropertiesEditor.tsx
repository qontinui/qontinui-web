"use client";

import { useCallback, useState } from "react";
import { X, Settings2, Globe, Maximize2, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type {
  UIBridgeState,
  BuilderAction,
} from "@/lib/state-machine-builder/types";
import { useExtensionCommand, useExtensionStatus } from "@/lib/runner-api";

interface StatePropertiesEditorProps {
  state: UIBridgeState;
  dispatch: React.Dispatch<BuilderAction>;
}

const POSITION_ZONES = ["header", "footer", "modal", "main", "sidebar"];

export function StatePropertiesEditor({
  state,
  dispatch,
}: StatePropertiesEditorProps) {
  const update = useCallback(
    (updates: Partial<UIBridgeState>) => {
      dispatch({ type: "UPDATE_STATE", id: state.id, updates });
    },
    [dispatch, state.id]
  );

  const handleClose = useCallback(() => {
    dispatch({ type: "SELECT_STATE", id: null });
  }, [dispatch]);

  const extensionStatus = useExtensionStatus();
  const extensionCommand = useExtensionCommand();
  const extensionConnected = extensionStatus.data?.connected ?? false;
  const [highlighting, setHighlighting] = useState(false);

  const highlightFingerprint = useCallback(
    async (hash: string) => {
      try {
        await extensionCommand.mutate({
          action: "highlightElement",
          params: { elementId: hash },
        });
      } catch {
        toast.error("Failed to highlight element");
      }
    },
    [extensionCommand]
  );

  const highlightAllFingerprints = useCallback(async () => {
    setHighlighting(true);
    for (const fp of state.fingerprints) {
      try {
        await extensionCommand.mutate({
          action: "highlightElement",
          params: { elementId: fp },
        });
      } catch {
        // continue to next
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    setHighlighting(false);
  }, [state.fingerprints, extensionCommand]);

  const confidencePercent =
    state.confidence != null ? Math.round(state.confidence * 100) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
        <Settings2 className="h-4 w-4 text-text-muted shrink-0" />
        <h3 className="text-sm font-semibold text-text-primary truncate flex-1">
          {state.name}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Editor Content */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="state-name" className="text-xs text-text-secondary">
              Name
            </Label>
            <Input
              id="state-name"
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              className="h-8 text-sm"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label
              htmlFor="state-description"
              className="text-xs text-text-secondary"
            >
              Description
            </Label>
            <Textarea
              id="state-description"
              value={state.description ?? ""}
              onChange={(e) =>
                update({ description: e.target.value || undefined })
              }
              placeholder="Optional description..."
              className="text-sm min-h-[60px]"
            />
          </div>

          <Separator />

          {/* Flags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="h-3.5 w-3.5 text-text-muted" />
                <Label
                  htmlFor="state-global"
                  className="text-xs text-text-secondary cursor-pointer"
                >
                  Global State
                </Label>
              </div>
              <Switch
                id="state-global"
                checked={state.isGlobal ?? false}
                onCheckedChange={(checked) => update({ isGlobal: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Maximize2 className="h-3.5 w-3.5 text-text-muted" />
                <Label
                  htmlFor="state-modal"
                  className="text-xs text-text-secondary cursor-pointer"
                >
                  Modal State
                </Label>
              </div>
              <Switch
                id="state-modal"
                checked={state.isModal ?? false}
                onCheckedChange={(checked) => update({ isModal: checked })}
              />
            </div>
          </div>

          {/* Position Zone */}
          <div className="space-y-1.5">
            <Label className="text-xs text-text-secondary">Position Zone</Label>
            <Select
              value={state.positionZone ?? ""}
              onValueChange={(value) =>
                update({ positionZone: value || undefined })
              }
            >
              <SelectTrigger className="h-8 text-sm w-full">
                <SelectValue placeholder="Select zone..." />
              </SelectTrigger>
              <SelectContent>
                {POSITION_ZONES.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          {/* Read-only: Fingerprints */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-secondary">
                  Fingerprints
                </span>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {state.fingerprints.length}
                </Badge>
              </div>
              {state.fingerprints.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  disabled={!extensionConnected || highlighting}
                  onClick={highlightAllFingerprints}
                >
                  <Eye className="h-3 w-3 mr-1" />
                  {highlighting ? "..." : "Highlight All"}
                </Button>
              )}
            </div>
            {state.fingerprints.length > 0 ? (
              <div className="rounded-md border border-border-subtle bg-surface-canvas p-2 max-h-[120px] overflow-y-auto">
                <div className="space-y-1">
                  {state.fingerprints.map((fp, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-1"
                    >
                      <span className="text-xs font-mono text-text-muted truncate">
                        {fp.substring(0, 12)}...
                      </span>
                      <button
                        className="shrink-0 p-0.5 rounded hover:bg-surface-raised/50 text-text-muted hover:text-text-primary disabled:opacity-30"
                        disabled={!extensionConnected}
                        onClick={() => highlightFingerprint(fp)}
                        title="Highlight in browser"
                      >
                        <Eye className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-muted">No fingerprints</p>
            )}
          </div>

          {/* Read-only: Elements */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-secondary">
                Elements
              </span>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {state.elements?.length ?? 0}
              </Badge>
            </div>
            {state.elements && state.elements.length > 0 ? (
              <div className="rounded-md border border-border-subtle bg-surface-canvas p-2 max-h-[160px] overflow-y-auto">
                <div className="space-y-1.5">
                  {state.elements.map((el) => (
                    <div key={el.id} className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 shrink-0"
                      >
                        {el.type}
                      </Badge>
                      <span className="text-xs text-text-primary truncate">
                        {el.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-text-muted">No elements</p>
            )}
          </div>

          {/* Read-only: Confidence & Observation Count */}
          <div className="flex items-center gap-4">
            {confidencePercent != null && (
              <div className="space-y-0.5">
                <span className="text-xs text-text-muted">Confidence</span>
                <p className="text-sm font-medium text-text-primary">
                  {confidencePercent}%
                </p>
              </div>
            )}
            {state.observationCount != null && (
              <div className="space-y-0.5">
                <span className="text-xs text-text-muted">Observations</span>
                <p className="text-sm font-medium text-text-primary">
                  {state.observationCount}
                </p>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
