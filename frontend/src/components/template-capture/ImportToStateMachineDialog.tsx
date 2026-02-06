/**
 * ImportToStateMachineDialog Component
 *
 * Dialog for importing an approved template candidate into a state machine.
 *
 * Features:
 * - Select target state machine
 * - Select target state (or create new)
 * - Configure StateImage properties (name, similarity threshold)
 * - Preview how template will appear in state machine
 */

import React, { useState, useCallback } from "react";
import { Check, Loader2, Image } from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TemplateCandidate } from "@/services/template-capture-service";
import { TemplateCaptureService } from "@/services/template-capture-service";
import { httpClient } from "@/services/service-factory";

export interface ImportToStateMachineDialogProps {
  candidate: TemplateCandidate;
  onImport: (stateId: string) => void;
  onClose: () => void;
}

interface StateOption {
  id: string;
  name: string;
}

export function ImportToStateMachineDialog({
  candidate,
  onImport,
  onClose,
}: ImportToStateMachineDialogProps) {
  const [service] = useState(() => new TemplateCaptureService(httpClient));
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [selectedStateId, setSelectedStateId] = useState<string>("");
  const [newStateName, setNewStateName] = useState("");
  const [imageName, setImageName] = useState(
    `${candidate.element_type}_${candidate.id.slice(0, 8)}`
  );
  const [similarityThreshold, setSimilarityThreshold] = useState(0.9);

  // Available states (would normally fetch from project)
  const [availableStates] = useState<StateOption[]>([
    { id: "state-1", name: "Main Menu" },
    { id: "state-2", name: "Game Screen" },
    { id: "state-3", name: "Settings" },
  ]);

  const boundary = candidate.adjusted_boundary || candidate.primary_boundary;

  const handleImport = useCallback(async () => {
    const stateId = mode === "existing" ? selectedStateId : `new-${Date.now()}`;

    if (mode === "existing" && !selectedStateId) {
      setError("Please select a state");
      return;
    }
    if (mode === "new" && !newStateName.trim()) {
      setError("Please enter a state name");
      return;
    }
    if (!imageName.trim()) {
      setError("Please enter an image name");
      return;
    }

    setImporting(true);
    setError(null);

    try {
      await service.importToStateMachine(candidate.id, {
        state_id: stateId,
        name: imageName.trim(),
        similarity_threshold: similarityThreshold,
      });
      onImport(stateId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
      console.error("[ImportToStateMachineDialog] Error:", err);
    } finally {
      setImporting(false);
    }
  }, [
    service,
    candidate.id,
    mode,
    selectedStateId,
    newStateName,
    imageName,
    similarityThreshold,
    onImport,
  ]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import Template to State Machine</DialogTitle>
          <DialogDescription>
            Add this template as a StateImage to identify UI elements during
            automation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-6 py-4">
          {/* Preview */}
          <div className="space-y-4">
            <Label>Template Preview</Label>
            <div className="relative aspect-video bg-muted rounded-lg overflow-hidden">
              {candidate.pixel_data_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={candidate.pixel_data_url}
                  alt="Template preview"
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  <Image className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Size: {boundary.width} x {boundary.height} px
              </p>
              <p>Detection: {boundary.strategy}</p>
              <p>Confidence: {Math.round(boundary.confidence * 100)}%</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="outline" className="capitalize">
                  {candidate.element_type}
                </Badge>
                <Badge variant="secondary">{candidate.status}</Badge>
              </div>
            </div>
          </div>

          {/* Configuration */}
          <div className="space-y-4">
            {/* Target State */}
            <Tabs
              value={mode}
              onValueChange={(v) => setMode(v as "existing" | "new")}
            >
              <Label>Target State</Label>
              <TabsList className="grid w-full grid-cols-2 mt-2">
                <TabsTrigger value="existing">Existing State</TabsTrigger>
                <TabsTrigger value="new">New State</TabsTrigger>
              </TabsList>

              <TabsContent value="existing" className="mt-3">
                <Select
                  value={selectedStateId}
                  onValueChange={setSelectedStateId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a state..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableStates.map((state) => (
                      <SelectItem key={state.id} value={state.id}>
                        {state.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TabsContent>

              <TabsContent value="new" className="mt-3">
                <Input
                  placeholder="Enter new state name..."
                  value={newStateName}
                  onChange={(e) => setNewStateName(e.target.value)}
                />
              </TabsContent>
            </Tabs>

            {/* Image Name */}
            <div className="space-y-2">
              <Label htmlFor="imageName">Image Name</Label>
              <Input
                id="imageName"
                placeholder="e.g., submit_button"
                value={imageName}
                onChange={(e) => setImageName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                A descriptive name for this template image
              </p>
            </div>

            {/* Similarity Threshold */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Similarity Threshold</Label>
                <span className="text-sm text-muted-foreground">
                  {Math.round(similarityThreshold * 100)}%
                </span>
              </div>
              <Slider
                value={[similarityThreshold]}
                min={0.5}
                max={1}
                step={0.01}
                onValueChange={([v]) =>
                  v !== undefined && setSimilarityThreshold(v)
                }
              />
              <p className="text-xs text-muted-foreground">
                Higher values require closer matches. Recommended: 85-95%
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                {error}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Import Template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
