"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface CreateProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string, description?: string) => Promise<void>;
  isLoading?: boolean;
}

export function CreateProjectDialog({
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: CreateProjectDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required");
      return;
    }

    if (trimmedName.length > 255) {
      setError("Project name must be 255 characters or less");
      return;
    }

    try {
      await onConfirm(trimmedName, description.trim() || undefined);
      // Reset form on success
      setName("");
      setDescription("");
    } catch {
      // Error handling is done by the parent component
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      // Reset form when closing
      setName("");
      setDescription("");
      setError(null);
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-surface-overlay border-border-subtle text-white">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription className="text-text-muted">
            Give your automation project a name
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          data-awas-action="create_project"
          data-awas-trigger="submit"
        >
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="My Automation Project"
                className="bg-surface-canvas border-border-default text-white placeholder:text-text-muted focus:border-brand-primary"
                disabled={isLoading}
                data-awas-param-name={name}
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">
                Description{" "}
                <span className="text-text-muted font-normal">(optional)</span>
              </Label>
              <Input
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this automation do?"
                className="bg-surface-canvas border-border-default text-white placeholder:text-text-muted focus:border-brand-primary"
                disabled={isLoading}
                data-awas-param-description={description}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border-default bg-transparent hover:bg-surface-raised"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="bg-brand-primary hover:bg-brand-primary/80 text-black font-medium"
              data-awas-action="create_project"
              data-awas-trigger="click"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Project"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
