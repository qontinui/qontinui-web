/**
 * SetStateHintDialog Component
 *
 * Dialog for setting the state hint on one or more template candidates.
 * State hints are used to group templates into states when generating
 * a state machine.
 */

import React, { useState, useCallback, useMemo } from "react";
import { Tag, Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import type { TemplateCandidate } from "@/services/template-capture-service";
import { TemplateCaptureService } from "@/services/template-capture-service";
import { httpClient } from "@/services/service-factory";

export interface SetStateHintDialogProps {
  candidates: TemplateCandidate[];
  existingHints: string[];
  onSave: (hint: string) => void;
  onClose: () => void;
}

export function SetStateHintDialog({
  candidates,
  existingHints,
  onSave,
  onClose,
}: SetStateHintDialogProps) {
  const [service] = useState(() => new TemplateCaptureService(httpClient));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHint, setSelectedHint] = useState<string | null>(null);
  const [newHint, setNewHint] = useState("");
  const [isCreatingNew, setIsCreatingNew] = useState(
    existingHints.length === 0
  );

  // Get the hint to apply
  const hintToApply = useMemo(() => {
    if (isCreatingNew) {
      return newHint.trim();
    }
    return selectedHint;
  }, [isCreatingNew, newHint, selectedHint]);

  const canSave = useMemo(() => {
    if (isCreatingNew) {
      return newHint.trim().length > 0;
    }
    return selectedHint !== null;
  }, [isCreatingNew, newHint, selectedHint]);

  const handleSave = useCallback(async () => {
    if (!hintToApply) return;

    setSaving(true);
    setError(null);

    try {
      // Update all candidates with the state hint
      await Promise.all(
        candidates.map((c) => service.setStateHint(c.id, hintToApply))
      );
      onSave(hintToApply);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set state hint");
      console.error("[SetStateHintDialog] Error:", err);
    } finally {
      setSaving(false);
    }
  }, [service, candidates, hintToApply, onSave]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5" />
            Set State Hint
          </DialogTitle>
          <DialogDescription>
            {candidates.length === 1
              ? "Assign this template to a state"
              : `Assign ${candidates.length} templates to a state`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Existing Hints */}
          {existingHints.length > 0 && !isCreatingNew && (
            <div className="space-y-2">
              <Label>Select Existing State</Label>
              <div className="flex flex-wrap gap-2">
                {existingHints.map((hint) => (
                  <Badge
                    key={hint}
                    variant={selectedHint === hint ? "default" : "outline"}
                    className="cursor-pointer text-sm py-1.5 px-3"
                    onClick={() => setSelectedHint(hint)}
                  >
                    {hint}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Toggle to create new */}
          {existingHints.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setIsCreatingNew(!isCreatingNew);
                if (!isCreatingNew) {
                  setSelectedHint(null);
                }
              }}
            >
              {isCreatingNew ? (
                "Choose existing state"
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create new state
                </>
              )}
            </Button>
          )}

          {/* New Hint Input */}
          {isCreatingNew && (
            <div className="space-y-2">
              <Label htmlFor="newHint">New State Name</Label>
              <Input
                id="newHint"
                value={newHint}
                onChange={(e) => setNewHint(e.target.value)}
                placeholder="e.g., Main Menu, Settings, Game Screen"
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                Templates with the same state hint will be grouped together
              </p>
            </div>
          )}

          {/* Preview */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-sm text-muted-foreground mb-2">
              {candidates.length === 1 ? "Template:" : "Templates:"}
            </div>
            <div className="flex flex-wrap gap-2">
              {candidates.slice(0, 5).map((c) => (
                <Badge key={c.id} variant="secondary" className="text-xs">
                  {c.user_metadata?.name ||
                    `${c.element_type}_${c.id.slice(0, 6)}`}
                </Badge>
              ))}
              {candidates.length > 5 && (
                <Badge variant="secondary" className="text-xs">
                  +{candidates.length - 5} more
                </Badge>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Tag className="h-4 w-4 mr-2" />
                Set Hint
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
