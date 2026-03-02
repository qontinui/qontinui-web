import React from "react";
import {
  isLinearWorkflow,
  getSuggestedMode,
  type BuilderMode,
  type LibraryItem,
} from "../types";
import type { PermissionLevel } from "@/types/collaboration";
import type { State } from "@/contexts/automation-context/types";
import { useMetadataEditing } from "./_hooks/useMetadataEditing";
import { useInitialStates } from "./_hooks/useInitialStates";
import { TypeBadge } from "./_components/TypeBadge";
import { SharingInfo } from "./_components/SharingInfo";
import { EditableField } from "./_components/EditableField";
import { EditActions } from "./_components/EditActions";
import { InitialStatesSection } from "./_components/InitialStatesSection";
import { ExpectationsSection } from "./_components/ExpectationsSection";
import { MetadataInfo } from "./_components/MetadataInfo";

export interface ItemMetadataPanelProps {
  item: LibraryItem;
  onUpdate: (item: LibraryItem) => void;
  currentPermission?: PermissionLevel;
  collaboratorCount?: number;
  onOpenShare?: () => void;
  className?: string;
  states?: State[];
}

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

const CATEGORY_OPTIONS = WORKFLOW_CATEGORIES.map((cat) => ({
  value: cat,
  label: cat,
}));

const VIEW_MODE_OPTIONS = [
  { value: "sequential", label: "Sequential (Timeline)" },
  { value: "graph", label: "Graph (Visual)" },
];

const DEFAULT_STATES: State[] = [];

export function ItemMetadataPanel({
  item,
  onUpdate,
  currentPermission,
  collaboratorCount,
  onOpenShare,
  className,
  states = DEFAULT_STATES,
}: ItemMetadataPanelProps) {
  const editing = useMetadataEditing(item, onUpdate);
  const initialStates = useInitialStates(item, onUpdate);

  const isLinear = isLinearWorkflow(item);
  const currentViewMode = item.metadata?.viewMode || getSuggestedMode(item);
  const isMainCategory = (item.category || "Main") === "Main";

  return (
    <div className={`pb-8 ${className || ""}`}>
      <TypeBadge
        currentViewMode={currentViewMode}
        isLinear={isLinear}
        currentPermission={currentPermission}
      />

      <SharingInfo
        currentPermission={currentPermission}
        collaboratorCount={collaboratorCount}
        onOpenShare={onOpenShare}
      />

      <EditableField
        type="text"
        label="Name"
        htmlFor="item-name"
        isEditing={editing.isEditing}
        value={editing.tempName}
        onChange={editing.setTempName}
        displayValue={item.name}
        onStartEditing={editing.startEditing}
        onKeyDown={editing.handleKeyDown}
        placeholder="Enter name..."
        dataTutorialId="workflow-name-input"
        dataUiId="automation-metadata-name-input"
      />

      <EditableField
        type="textarea"
        label="Description"
        htmlFor="item-description"
        isEditing={editing.isEditing}
        value={editing.tempDescription}
        onChange={editing.setTempDescription}
        displayValue={item.description || "No description"}
        onStartEditing={editing.startEditing}
        onKeyDown={editing.handleKeyDown}
        placeholder="Enter description..."
        dataUiId="automation-metadata-description-input"
      />

      <EditableField
        type="select"
        label="Category"
        htmlFor="item-category"
        isEditing={editing.isEditing}
        value={editing.tempCategory}
        onChange={editing.setTempCategory}
        displayValue={item.category || "Main"}
        onStartEditing={editing.startEditing}
        onKeyDown={editing.handleKeyDown}
        options={CATEGORY_OPTIONS}
        dataUiId="automation-metadata-category-select"
      />

      <EditableField
        type="select"
        label="Preferred Editor"
        htmlFor="item-viewMode"
        isEditing={editing.isEditing}
        value={editing.tempViewMode}
        onChange={(v) => editing.setTempViewMode(v as BuilderMode)}
        displayValue={
          currentViewMode === "sequential"
            ? "Sequential (Timeline)"
            : "Graph (Visual)"
        }
        onStartEditing={editing.startEditing}
        onKeyDown={editing.handleKeyDown}
        options={VIEW_MODE_OPTIONS}
        dataUiId="automation-metadata-viewmode-select"
      />

      {editing.isEditing && (
        <EditActions
          onSave={editing.handleSave}
          onCancel={editing.handleCancel}
          saveDisabled={!editing.tempName.trim()}
        />
      )}

      {isMainCategory && (
        <InitialStatesSection
          states={states}
          initialStateIds={initialStates.initialStateIds}
          open={initialStates.initialStatesOpen}
          onOpenChange={initialStates.setInitialStatesOpen}
          onToggle={initialStates.handleInitialStateToggle}
          onResetToDefaults={initialStates.handleResetToDefaults}
        />
      )}

      <ExpectationsSection item={item} onUpdate={onUpdate} />

      <MetadataInfo item={item} isLinear={isLinear} />
    </div>
  );
}
