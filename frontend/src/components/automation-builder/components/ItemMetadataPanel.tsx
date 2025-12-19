/**
 * ItemMetadataPanel Component
 *
 * Displays and allows editing of workflow metadata (name, description, category, view mode)
 * All items are now Workflows - sequential workflows are just linear graphs.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { Check, X, Users, ChevronDown, Play, AlertCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { LibraryItem } from "../types";
import { isLinearWorkflow, getSuggestedMode } from "../types";
import type { BuilderMode } from "../types";
import { PermissionBadge } from "./PermissionBadge";
import type { PermissionLevel } from "@/types/collaboration";
import { ExpectationsPanel } from "@/components/expectations/ExpectationsPanel";
import type { WorkflowExpectations } from "@/lib/expectations/types";
import type { State } from "@/contexts/automation-context/types";

export interface ItemMetadataPanelProps {
  item: LibraryItem;
  onUpdate: (item: LibraryItem) => void;
  currentPermission?: PermissionLevel;
  collaboratorCount?: number;
  onOpenShare?: () => void;
  className?: string;
  /** Available states for initial state selection (required for Main category workflows) */
  states?: State[];
}

// Workflow categories (unified for all workflows)
const WORKFLOW_CATEGORIES = [
  "Main",
  "UI Automation",
  "Data Processing",
  "System Integration",
  "Testing",
  "Maintenance",
  "Utilities",
  "Custom",
] as const;

export function ItemMetadataPanel({
  item,
  onUpdate,
  currentPermission,
  collaboratorCount,
  onOpenShare,
  className,
  states = [],
}: ItemMetadataPanelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempName, setTempName] = useState(item.name);
  const [tempDescription, setTempDescription] = useState(
    item.description || ""
  );
  const [tempCategory, setTempCategory] = useState(item.category || "Main");
  const [tempViewMode, setTempViewMode] = useState<BuilderMode>(
    item.metadata?.viewMode || getSuggestedMode(item)
  );
  const [expectationsOpen, setExpectationsOpen] = useState(false);
  const [initialStatesOpen, setInitialStatesOpen] = useState(false);

  // Reset temp values when item changes
  useEffect(() => {
    setTempName(item.name);
    setTempDescription(item.description || "");
    setTempCategory(item.category || "Main");
    setTempViewMode(item.metadata?.viewMode || getSuggestedMode(item));
    setIsEditing(false);
  }, [item.id]);

  /**
   * Save changes
   */
  const handleSave = useCallback(() => {
    if (!tempName.trim()) {
      // Don't allow empty names
      return;
    }

    // Update workflow with all fields
    onUpdate({
      ...item,
      name: tempName.trim(),
      description: tempDescription.trim(),
      category: tempCategory,
      metadata: {
        ...item.metadata,
        viewMode: tempViewMode,
        updated: new Date().toISOString(),
      },
    });

    setIsEditing(false);
  }, [item, tempName, tempDescription, tempCategory, tempViewMode, onUpdate]);

  /**
   * Cancel editing
   */
  const handleCancel = useCallback(() => {
    setTempName(item.name);
    setTempDescription(item.description || "");
    setTempCategory(item.category || "Main");
    setTempViewMode(item.metadata?.viewMode || getSuggestedMode(item));
    setIsEditing(false);
  }, [item]);

  /**
   * Handle Enter key to save
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      }
    },
    [handleSave, handleCancel]
  );

  /**
   * Handle expectations change
   */
  const handleExpectationsChange = useCallback(
    (expectations: WorkflowExpectations) => {
      onUpdate({
        ...item,
        expectations,
        metadata: {
          ...item.metadata,
          updated: new Date().toISOString(),
        },
      });
    },
    [item, onUpdate]
  );

  /**
   * Handle initial state toggle
   */
  const handleInitialStateToggle = useCallback(
    (stateId: string, checked: boolean) => {
      const currentIds = (item as any).initialStateIds || [];
      const newIds = checked
        ? [...currentIds, stateId]
        : currentIds.filter((id: string) => id !== stateId);

      onUpdate({
        ...item,
        initialStateIds: newIds,
        metadata: {
          ...item.metadata,
          updated: new Date().toISOString(),
        },
      } as LibraryItem);
    },
    [item, onUpdate]
  );

  // Check if this is a Main category workflow
  const isMainCategory = (item.category || "Main") === "Main";
  const initialStateIds: string[] = (item as any).initialStateIds || [];

  const isLinear = isLinearWorkflow(item);
  const currentViewMode = item.metadata?.viewMode || getSuggestedMode(item);

  return (
    <div className={className}>
      {/* Type Badge */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <span
          className={
            currentViewMode === "sequential"
              ? "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30"
              : "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#00FF88]/10 text-[#00FF88] border border-[#00FF88]/30"
          }
        >
          {isLinear ? "Sequential Workflow" : "Graph Workflow"}
        </span>
        {currentPermission && (
          <PermissionBadge permission={currentPermission} size="sm" />
        )}
      </div>

      {/* Sharing Info */}
      {(currentPermission || collaboratorCount) && (
        <div className="mb-4 p-3 bg-gray-900/50 border border-gray-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Users className="h-4 w-4" />
              <span>
                {collaboratorCount !== undefined && collaboratorCount > 0
                  ? `${collaboratorCount} collaborator${collaboratorCount !== 1 ? "s" : ""}`
                  : "Not shared"}
              </span>
            </div>
            {onOpenShare && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onOpenShare}
                className="text-xs text-gray-400 hover:text-white h-auto py-1 px-2"
              >
                Manage
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Name Field */}
      <div className="mb-4">
        <Label
          htmlFor="item-name"
          className="text-sm font-medium text-gray-300 mb-1.5"
        >
          Name
        </Label>
        {isEditing ? (
          <Input
            id="item-name"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            onKeyDown={handleKeyDown}
            data-tutorial-id="workflow-name-input"
            className="bg-gray-900 border-gray-700 text-white"
            placeholder="Enter name..."
            autoFocus
          />
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-md cursor-pointer hover:border-gray-700 transition-colors"
          >
            <span className="text-white">{item.name}</span>
          </div>
        )}
      </div>

      {/* Description Field */}
      <div className="mb-4">
        <Label
          htmlFor="item-description"
          className="text-sm font-medium text-gray-300 mb-1.5"
        >
          Description
        </Label>
        {isEditing ? (
          <Textarea
            id="item-description"
            value={tempDescription}
            onChange={(e) => setTempDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            className="bg-gray-900 border-gray-700 text-white min-h-[80px]"
            placeholder="Enter description..."
          />
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-md cursor-pointer hover:border-gray-700 transition-colors min-h-[80px]"
          >
            <span className="text-gray-400 text-sm">
              {item.description || "No description"}
            </span>
          </div>
        )}
      </div>

      {/* Category Field */}
      <div className="mb-4">
        <Label
          htmlFor="item-category"
          className="text-sm font-medium text-gray-300 mb-1.5"
        >
          Category
        </Label>
        {isEditing ? (
          <Select value={tempCategory} onValueChange={setTempCategory}>
            <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORKFLOW_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-md cursor-pointer hover:border-gray-700 transition-colors"
          >
            <span className="text-white">{item.category || "Main"}</span>
          </div>
        )}
      </div>

      {/* View Mode Field */}
      <div className="mb-4">
        <Label
          htmlFor="item-viewMode"
          className="text-sm font-medium text-gray-300 mb-1.5"
        >
          Preferred Editor
        </Label>
        {isEditing ? (
          <Select
            value={tempViewMode}
            onValueChange={(v) => setTempViewMode(v as BuilderMode)}
          >
            <SelectTrigger className="bg-gray-900 border-gray-700 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sequential">Sequential (Timeline)</SelectItem>
              <SelectItem value="graph">Graph (Visual)</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <div
            onClick={() => setIsEditing(true)}
            className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-md cursor-pointer hover:border-gray-700 transition-colors"
          >
            <span className="text-white">
              {currentViewMode === "sequential"
                ? "Sequential (Timeline)"
                : "Graph (Visual)"}
            </span>
          </div>
        )}
      </div>

      {/* Edit Actions */}
      {isEditing && (
        <div className="flex gap-2 mt-6">
          <Button
            onClick={handleSave}
            disabled={!tempName.trim()}
            className="flex-1 bg-green-600 hover:bg-green-700 text-white"
          >
            <Check className="w-4 h-4 mr-2" />
            Save
          </Button>
          <Button
            onClick={handleCancel}
            variant="outline"
            className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
          >
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>
      )}

      {/* Initial States Section - Only for Main category workflows */}
      {isMainCategory && (
        <div className="mt-6 pt-6 border-t border-gray-800">
          <Collapsible
            open={initialStatesOpen}
            onOpenChange={setInitialStatesOpen}
          >
            <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-gray-900/50 rounded-md px-2 transition-colors">
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4 text-[#00FF88]" />
                <span className="text-sm font-medium text-gray-300">
                  Initial States
                </span>
                {initialStateIds.length > 0 && (
                  <span className="text-xs text-[#00FF88] bg-[#00FF88]/10 px-1.5 py-0.5 rounded">
                    {initialStateIds.length} selected
                  </span>
                )}
              </div>
              <ChevronDown
                className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
                  initialStatesOpen ? "rotate-180" : ""
                }`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <div className="bg-gray-900/30 border border-gray-800 rounded-lg p-3">
                <p className="text-xs text-gray-500 mb-3">
                  Select which states should be considered active when this
                  workflow starts. Required for model-based GUI automation.
                </p>
                {states.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-amber-500">
                    <AlertCircle className="h-4 w-4" />
                    <span>No states defined in this project</span>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {states.map((state) => (
                      <label
                        key={state.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-gray-800/50 cursor-pointer transition-colors"
                      >
                        <Checkbox
                          checked={initialStateIds.includes(state.id)}
                          onCheckedChange={(checked) =>
                            handleInitialStateToggle(state.id, checked === true)
                          }
                          className="border-gray-600 data-[state=checked]:bg-[#00FF88] data-[state=checked]:border-[#00FF88]"
                        />
                        <span className="text-sm text-gray-300 flex-1">
                          {state.name}
                        </span>
                        {state.description && (
                          <span className="text-xs text-gray-500 truncate max-w-[120px]">
                            {state.description}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}

      {/* Workflow Expectations Section */}
      <div className="mt-6 pt-6 border-t border-gray-800">
        <Collapsible open={expectationsOpen} onOpenChange={setExpectationsOpen}>
          <CollapsibleTrigger className="w-full flex items-center justify-between py-2 hover:bg-gray-900/50 rounded-md px-2 transition-colors">
            <span className="text-sm font-medium text-gray-300">
              Workflow Expectations
            </span>
            <ChevronDown
              className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
                expectationsOpen ? "rotate-180" : ""
              }`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="bg-gray-900/30 border border-gray-800 rounded-lg overflow-hidden">
              <ExpectationsPanel
                expectations={item.expectations}
                onChange={handleExpectationsChange}
                availableCheckpoints={[]}
                availableStates={[]}
              />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Metadata Info */}
      <div className="mt-6 pt-6 border-t border-gray-800">
        <div className="text-xs text-gray-500 space-y-1">
          <div>
            <span className="font-medium">ID:</span> {item.id}
          </div>
          <div>
            <span className="font-medium">Format:</span> {item.format}
          </div>
          <div>
            <span className="font-medium">Version:</span> {item.version}
          </div>
          {item.metadata?.created && (
            <div>
              <span className="font-medium">Created:</span>{" "}
              {new Date(item.metadata.created).toLocaleDateString()}
            </div>
          )}
          {item.metadata?.updated && (
            <div>
              <span className="font-medium">Updated:</span>{" "}
              {new Date(item.metadata.updated).toLocaleDateString()}
            </div>
          )}
          <div>
            <span className="font-medium">Actions:</span> {item.actions.length}
          </div>
          <div>
            <span className="font-medium">Type:</span>{" "}
            {isLinear ? "Linear (no branching)" : "Graph (branching)"}
          </div>
        </div>
      </div>
    </div>
  );
}
