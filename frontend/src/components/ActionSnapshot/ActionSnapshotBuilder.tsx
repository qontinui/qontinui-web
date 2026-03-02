import React from "react";
import { Camera, Check } from "lucide-react";
import { ActionSnapshot } from "../../lib/integration-testing-framework";
import { ActionSnapshotBuilderProps } from "./types";
import { useActionConfig } from "./_hooks/useActionConfig";
import { useMatches } from "./_hooks/useMatches";
import { useSnapshotResult } from "./_hooks/useSnapshotResult";
import { ActionTypeSelector } from "./_components/ActionTypeSelector";
import { ActionConfigPanel } from "./_components/ActionConfigPanel";
import { MatchRegionEditor } from "./_components/MatchRegionEditor";
import { SuccessConfig } from "./_components/SuccessConfig";
import { NextScreenshotSelector } from "./_components/NextScreenshotSelector";
import { DurationInput } from "./_components/DurationInput";

function generateId(): string {
  return Math.random().toString(36).substr(2, 9);
}

export const ActionSnapshotBuilder: React.FC<ActionSnapshotBuilderProps> = ({
  currentScreenshot,
  screenshots,
  stateId,
  stateName,
  activeStates,
  onSave,
  onCancel,
}) => {
  const {
    actionType,
    setActionType,
    actionConfig,
    updateConfig,
    updateOffset,
    text,
    setText,
    actionTypes,
  } = useActionConfig();

  const { matches, addMatch, updateMatch, removeMatch } = useMatches();

  const {
    actionSuccess,
    setActionSuccess,
    resultSuccess,
    setResultSuccess,
    duration,
    setDuration,
    nextScreenshotId,
    selectScreenshot,
    clearNextScreenshot,
    showScreenshotSelector,
    toggleScreenshotSelector,
  } = useSnapshotResult();

  const handleSave = () => {
    const snapshot: ActionSnapshot = {
      id: generateId(),
      timestamp: new Date(),
      actionType,
      actionConfig,
      matches,
      stateName,
      stateId,
      activeStates,
      actionSuccess,
      resultSuccess,
      screenshotId: currentScreenshot.id,
      nextScreenshotId,
      duration,
      text: actionType === "TYPE" ? text : undefined,
    };
    onSave(snapshot);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="border-b p-4">
          <h2 className="text-xl font-semibold">Build Action Snapshot</h2>
          <p className="text-sm text-text-muted mt-1">
            Create a snapshot for state: {stateName} ({stateId})
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="bg-surface-canvas p-4 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Camera className="w-4 h-4 text-text-muted" />
              <span className="font-medium">Current Screenshot</span>
            </div>
            <p className="text-sm text-text-muted">{currentScreenshot.name}</p>
            <p className="text-xs text-text-muted">
              ID: {currentScreenshot.id}
            </p>
          </div>

          <ActionTypeSelector
            actionTypes={actionTypes}
            selectedType={actionType}
            onSelect={setActionType}
          />

          <ActionConfigPanel
            actionType={actionType}
            actionConfig={actionConfig}
            text={text}
            onUpdateConfig={updateConfig}
            onUpdateOffset={updateOffset}
            onTextChange={setText}
          />

          <MatchRegionEditor
            matches={matches}
            onAdd={addMatch}
            onUpdate={updateMatch}
            onRemove={removeMatch}
          />

          <SuccessConfig
            actionSuccess={actionSuccess}
            resultSuccess={resultSuccess}
            onActionSuccessChange={setActionSuccess}
            onResultSuccessChange={setResultSuccess}
          />

          <NextScreenshotSelector
            currentScreenshotId={currentScreenshot.id}
            screenshots={screenshots}
            nextScreenshotId={nextScreenshotId}
            showSelector={showScreenshotSelector}
            onToggleSelector={toggleScreenshotSelector}
            onSelect={selectScreenshot}
            onClear={clearNextScreenshot}
          />

          <DurationInput duration={duration} onChange={setDuration} />
        </div>

        <div className="border-t p-4 flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 border rounded hover:bg-surface-raised/80"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
          >
            <Check className="w-4 h-4" />
            Save Snapshot
          </button>
        </div>
      </div>
    </div>
  );
};

export default ActionSnapshotBuilder;
