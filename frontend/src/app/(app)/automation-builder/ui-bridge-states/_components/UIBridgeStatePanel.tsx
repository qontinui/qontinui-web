"use client";

import { useState, useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Save, Layers, BookOpen } from "lucide-react";
import { useAutomationStore } from "@/stores/automation";
import type { SavedStateWithDetails } from "../_types";

interface UIBridgeStatePanelProps {
  state: SavedStateWithDetails;
  configId: string;
  onClose: () => void;
  onUpdate: () => void;
}

export function UIBridgeStatePanel({
  state,
  configId,
  onClose,
  onUpdate,
}: UIBridgeStatePanelProps) {
  const projectId = useAutomationStore((s) => s.projectId);
  const [name, setName] = useState(state.name);
  const [description, setDescription] = useState(state.description || "");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!projectId) return;
    setIsSaving(true);
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/ui-bridge-configs/${configId}/states/${state.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name, description: description || null }),
        }
      );
      if (res.ok) {
        toast.success("State updated");
        onUpdate();
      } else {
        toast.error("Failed to update state");
      }
    } catch {
      toast.error("Failed to update state");
    } finally {
      setIsSaving(false);
    }
  }, [projectId, configId, state.id, name, description, onUpdate]);

  return (
    <div className="w-80 border-l border-border-primary bg-surface-primary overflow-y-auto">
      <div className="flex items-center justify-between p-4 border-b border-border-primary">
        <div className="flex items-center gap-2">
          <Layers className="size-4 text-brand-primary" />
          <h3 className="text-sm font-semibold text-text-primary">
            State Details
          </h3>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Name */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-sm"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input w-full text-sm min-h-[60px] resize-y"
            placeholder="Describe this state..."
          />
        </div>

        {/* Save */}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving}
          className="w-full"
        >
          <Save className="size-3.5 mr-1.5" />
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>

        {/* State ID */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            State ID
          </label>
          <code className="text-xs text-text-muted bg-surface-secondary px-2 py-1 rounded block">
            {state.state_id}
          </code>
        </div>

        {/* Confidence */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Confidence
          </label>
          <div className="text-sm text-text-primary">
            {Math.round(state.confidence * 100)}%
          </div>
        </div>

        {/* Element IDs */}
        <div>
          <label className="text-xs font-medium text-text-muted mb-1 block">
            Elements ({state.element_ids.length})
          </label>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {state.element_ids.map((eid) => (
              <code
                key={eid}
                className="text-[10px] text-text-muted bg-surface-secondary px-1.5 py-0.5 rounded block truncate"
              >
                {eid}
              </code>
            ))}
          </div>
        </div>

        {/* Render IDs */}
        {state.render_ids.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              Renders ({state.render_ids.length})
            </label>
            <div className="text-xs text-text-muted">
              Active in {state.render_ids.length} render snapshots
            </div>
          </div>
        )}

        {/* Domain Knowledge */}
        {state.domain_knowledge && state.domain_knowledge.length > 0 && (
          <div>
            <label className="text-xs font-medium text-text-muted mb-1 block">
              <BookOpen className="size-3 inline mr-1" />
              Domain Knowledge
            </label>
            <div className="space-y-1">
              {state.domain_knowledge.map((dk) => (
                <div
                  key={dk.id}
                  className="text-xs bg-surface-secondary p-2 rounded"
                >
                  <div className="font-medium text-text-primary">
                    {dk.title}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
