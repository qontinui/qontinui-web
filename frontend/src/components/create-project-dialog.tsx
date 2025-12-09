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
      <DialogContent className="bg-[#1A1A1B] border-gray-800 text-white">
        <DialogHeader>
          <DialogTitle>Create New Project</DialogTitle>
          <DialogDescription className="text-gray-400">
            Give your automation project a name
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
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
                className="bg-[#0F0F10] border-gray-700 text-white placeholder:text-gray-500 focus:border-[#00D9FF]"
                autoFocus
                disabled={isLoading}
              />
              {error && <p className="text-sm text-red-400">{error}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">
                Description{" "}
                <span className="text-gray-500 font-normal">(optional)</span>
              </Label>
              <Input
                id="project-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this automation do?"
                className="bg-[#0F0F10] border-gray-700 text-white placeholder:text-gray-500 focus:border-[#00D9FF]"
                disabled={isLoading}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-gray-700 bg-transparent hover:bg-gray-800"
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !name.trim()}
              className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium"
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
