"use client";

import { useState, useCallback, useMemo } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UIBridgeState } from "@/lib/state-machine-builder/types";

interface AddStateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (state: UIBridgeState) => void;
  existingIds: string[];
}

const POSITION_ZONES = ["header", "footer", "modal", "main", "sidebar"];

function generateId(name: string, existingIds: string[]): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const candidate = base || "state";

  if (!existingIds.includes(candidate)) {
    return candidate;
  }

  let counter = 2;
  while (existingIds.includes(`${candidate}-${counter}`)) {
    counter++;
  }
  return `${candidate}-${counter}`;
}

export function AddStateDialog({
  open,
  onOpenChange,
  onAdd,
  existingIds,
}: AddStateDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isGlobal, setIsGlobal] = useState(false);
  const [isModal, setIsModal] = useState(false);
  const [positionZone, setPositionZone] = useState("");

  const isValid = name.trim().length > 0;

  const generatedId = useMemo(
    () => generateId(name, existingIds),
    [name, existingIds]
  );

  const resetForm = useCallback(() => {
    setName("");
    setDescription("");
    setIsGlobal(false);
    setIsModal(false);
    setPositionZone("");
  }, []);

  const handleAdd = useCallback(() => {
    if (!isValid) return;

    const state: UIBridgeState = {
      id: generatedId,
      name: name.trim(),
      description: description.trim() || undefined,
      fingerprints: [],
      isGlobal: isGlobal || undefined,
      isModal: isModal || undefined,
      positionZone: positionZone || undefined,
    };

    onAdd(state);
    resetForm();
    onOpenChange(false);
  }, [
    isValid,
    generatedId,
    name,
    description,
    isGlobal,
    isModal,
    positionZone,
    onAdd,
    resetForm,
    onOpenChange,
  ]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        resetForm();
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange, resetForm]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent onSubmit={handleAdd}>
        <DialogHeader>
          <DialogTitle>Add State</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label
              htmlFor="new-state-name"
              className="text-xs text-text-secondary"
            >
              Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-state-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Login Page"
              className="h-8 text-sm"
              autoFocus
            />
            {name.trim() && (
              <p className="text-xs text-text-muted">
                ID: <span className="font-mono">{generatedId}</span>
              </p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label
              htmlFor="new-state-description"
              className="text-xs text-text-secondary"
            >
              Description
            </Label>
            <Input
              id="new-state-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              className="h-8 text-sm"
            />
          </div>

          {/* Flags */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label
                htmlFor="new-state-global"
                className="text-xs text-text-secondary cursor-pointer"
              >
                Global State
              </Label>
              <Switch
                id="new-state-global"
                checked={isGlobal}
                onCheckedChange={setIsGlobal}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label
                htmlFor="new-state-modal"
                className="text-xs text-text-secondary cursor-pointer"
              >
                Modal State
              </Label>
              <Switch
                id="new-state-modal"
                checked={isModal}
                onCheckedChange={setIsModal}
              />
            </div>
          </div>

          {/* Position Zone */}
          <div className="space-y-1.5">
            <Label className="text-xs text-text-secondary">Position Zone</Label>
            <Select value={positionZone} onValueChange={setPositionZone}>
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
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="brand-primary"
            size="sm"
            onClick={handleAdd}
            disabled={!isValid}
          >
            <Plus className="h-4 w-4" />
            Add State
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
