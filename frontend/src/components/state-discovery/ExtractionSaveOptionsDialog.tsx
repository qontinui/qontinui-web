/**
 * Extraction Save Options Dialog
 *
 * Prompts the user when saving extracted states to an existing state machine.
 * Offers three options: Merge, Replace, or New Project.
 */

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  GitMerge,
  RefreshCw,
  FolderPlus,
  Info,
  AlertTriangle,
  Loader2,
} from "lucide-react";

export type SaveOption = "merge" | "replace" | "new_project";

interface ExtractionSaveOptionsDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Called when dialog is closed without action */
  onClose: () => void;
  /** Called when user confirms their choice */
  onConfirm: (option: SaveOption, newProjectName?: string) => void;
  /** Number of existing states in the current project */
  existingStateCount: number;
  /** Number of states to be imported */
  newStateCount: number;
  /** Current project name */
  currentProjectName: string;
  /** Whether the action is in progress */
  isLoading?: boolean;
}

const OPTION_DETAILS: Record<
  SaveOption,
  {
    icon: React.ElementType;
    title: string;
    description: string;
    iconColor: string;
  }
> = {
  merge: {
    icon: GitMerge,
    title: "Merge with Existing",
    description:
      "Add extracted states to your current state machine. Existing states will be preserved. Duplicate names will be skipped.",
    iconColor: "text-blue-500",
  },
  replace: {
    icon: RefreshCw,
    title: "Replace Existing",
    description:
      "Clear all existing states and use only the extracted states. This action cannot be undone.",
    iconColor: "text-amber-500",
  },
  new_project: {
    icon: FolderPlus,
    title: "Create New Project",
    description:
      "Save extracted states to a new project. Your current project will remain unchanged.",
    iconColor: "text-green-500",
  },
};

export function ExtractionSaveOptionsDialog({
  open,
  onClose,
  onConfirm,
  existingStateCount,
  newStateCount,
  currentProjectName,
  isLoading = false,
}: ExtractionSaveOptionsDialogProps) {
  const [selectedOption, setSelectedOption] = useState<SaveOption>("merge");
  const [newProjectName, setNewProjectName] = useState(
    `${currentProjectName} (Extracted)`
  );

  const handleConfirm = () => {
    onConfirm(
      selectedOption,
      selectedOption === "new_project" ? newProjectName : undefined
    );
  };

  const getImpactMessage = () => {
    switch (selectedOption) {
      case "merge":
        return `${newStateCount} new state${newStateCount !== 1 ? "s" : ""} will be added to ${existingStateCount} existing state${existingStateCount !== 1 ? "s" : ""}.`;
      case "replace":
        return `${existingStateCount} existing state${existingStateCount !== 1 ? "s" : ""} will be removed and replaced with ${newStateCount} extracted state${newStateCount !== 1 ? "s" : ""}.`;
      case "new_project":
        return `A new project will be created with ${newStateCount} state${newStateCount !== 1 ? "s" : ""}. Current project remains unchanged.`;
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent
        className="max-w-lg"
        data-ui-id="dialog-extraction-save-options"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-blue-500" />
            Save Extracted States
          </DialogTitle>
          <DialogDescription>
            You have {existingStateCount} existing state
            {existingStateCount !== 1 ? "s" : ""} in &quot;{currentProjectName}
            &quot;. How would you like to save the {newStateCount} extracted
            state{newStateCount !== 1 ? "s" : ""}?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Option Selection */}
          <RadioGroup
            value={selectedOption}
            onValueChange={(value) => setSelectedOption(value as SaveOption)}
            className="space-y-3"
            data-ui-id="extraction-save-options-radio-group"
          >
            {(Object.keys(OPTION_DETAILS) as SaveOption[]).map((option) => {
              const {
                icon: Icon,
                title,
                description,
                iconColor,
              } = OPTION_DETAILS[option];
              return (
                <label
                  key={option}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedOption === option
                      ? "border-brand-primary bg-brand-primary/5"
                      : "border-border hover:border-border-hover hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem
                    value={option}
                    id={option}
                    className="mt-1"
                    data-ui-id={`extraction-save-option-${option}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-4 w-4 ${iconColor}`} />
                      <span className="font-medium text-sm">{title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {description}
                    </p>
                  </div>
                </label>
              );
            })}
          </RadioGroup>

          {/* New Project Name Input */}
          {selectedOption === "new_project" && (
            <div className="space-y-2 pl-7">
              <Label htmlFor="new-project-name" className="text-sm">
                New Project Name
              </Label>
              <Input
                id="new-project-name"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="Enter project name..."
                className="h-9"
                data-ui-id="extraction-new-project-name-input"
              />
            </div>
          )}

          {/* Impact Preview */}
          <Alert
            variant={selectedOption === "replace" ? "destructive" : "default"}
            className="mt-4"
          >
            {selectedOption === "replace" ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Info className="h-4 w-4" />
            )}
            <AlertDescription className="text-sm">
              {getImpactMessage()}
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
            data-ui-id="extraction-save-options-cancel-btn"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={
              isLoading ||
              (selectedOption === "new_project" && !newProjectName.trim())
            }
            data-ui-id="extraction-save-options-confirm-btn"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                {selectedOption === "merge" && "Merge States"}
                {selectedOption === "replace" && "Replace States"}
                {selectedOption === "new_project" && "Create Project"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ExtractionSaveOptionsDialog;
