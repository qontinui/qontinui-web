import React, { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { TemplateCandidate } from "@/services/template-capture-service";
import { useTemplateCandidates } from "./_hooks/useTemplateCandidates";
import { useCandidateSelection } from "./_hooks/useCandidateSelection";
import { useCandidateActions } from "./_hooks/useCandidateActions";
import { ReviewPanelHeader } from "./_components/ReviewPanelHeader";
import { BulkActionsBar } from "./_components/BulkActionsBar";
import { BulkProgressOverlay } from "./_components/BulkProgressOverlay";
import { CandidateGrid } from "./_components/CandidateGrid";
import {
  LoadingState,
  ErrorState,
  EmptyState,
} from "./_components/ReviewPanelEmptyStates";
import { ReviewPanelDialogs } from "./_components/ReviewPanelDialogs";

export interface TemplateReviewPanelProps {
  sessionId?: string;
  projectId?: string;
  videoPath?: string;
  onCandidateApproved?: (id: string) => void;
  onCandidateRejected?: (id: string) => void;
  onCandidateImported?: (id: string, stateId: string) => void;
  onStateMachineGenerated?: (config: unknown) => void;
  className?: string;
}

export function TemplateReviewPanel({
  sessionId,
  projectId,
  videoPath,
  onCandidateApproved,
  onCandidateRejected,
  onCandidateImported,
  onStateMachineGenerated,
  className,
}: TemplateReviewPanelProps) {
  const {
    service,
    candidates,
    setCandidates,
    loading,
    error,
    filterStatus,
    setFilterStatus,
    fetchCandidates,
    stats,
    uniqueStateHints,
  } = useTemplateCandidates({ sessionId, projectId });

  const { selectedIds, toggleSelect, selectAll, clearSelection } =
    useCandidateSelection(candidates);

  const {
    processingIds,
    bulkProgress,
    handleApprove,
    handleReject,
    handleDelete,
    handleBulkApprove,
    handleBulkReject,
  } = useCandidateActions({
    service,
    setCandidates,
    onCandidateApproved,
    onCandidateRejected,
  });

  const [editingCandidate, setEditingCandidate] =
    useState<TemplateCandidate | null>(null);
  const [importingCandidate, setImportingCandidate] =
    useState<TemplateCandidate | null>(null);
  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [settingHintCandidates, setSettingHintCandidates] = useState<
    TemplateCandidate[]
  >([]);

  const handleImportComplete = useCallback(
    (stateId: string) => {
      if (importingCandidate) {
        onCandidateImported?.(importingCandidate.id, stateId);
        setImportingCandidate(null);
      }
    },
    [importingCandidate, onCandidateImported]
  );

  const handleStateHintSaved = useCallback(
    (hint: string) => {
      const updatedIds = new Set(settingHintCandidates.map((c) => c.id));
      setCandidates((prev) =>
        prev.map((c) =>
          updatedIds.has(c.id)
            ? { ...c, user_metadata: { ...c.user_metadata, state_hint: hint } }
            : c
        )
      );
      setSettingHintCandidates([]);
      clearSelection();
    },
    [settingHintCandidates, setCandidates, clearSelection]
  );

  const handleSetStateHintForSelected = useCallback(() => {
    const selected = candidates.filter((c) => selectedIds.has(c.id));
    setSettingHintCandidates(selected);
  }, [candidates, selectedIds]);

  const handleStateMachineGenerated = useCallback(
    (result: unknown) => {
      onStateMachineGenerated?.(result);
      setShowGenerateDialog(false);
    },
    [onStateMachineGenerated]
  );

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <ReviewPanelHeader
        stats={stats}
        filterStatus={filterStatus}
        onFilterChange={setFilterStatus}
        onRefresh={fetchCandidates}
        loading={loading}
        onGenerateStateMachine={() => setShowGenerateDialog(true)}
      />

      {stats.pending > 0 && (
        <BulkActionsBar
          selectedCount={selectedIds.size}
          onToggleSelectAll={selectedIds.size > 0 ? clearSelection : selectAll}
          onBulkApprove={() => handleBulkApprove(selectedIds, clearSelection)}
          onBulkReject={() => handleBulkReject(selectedIds, clearSelection)}
          onSetStateHint={handleSetStateHintForSelected}
          bulkInProgress={!!bulkProgress}
        />
      )}

      <div className="flex-1 overflow-auto p-4">
        <BulkProgressOverlay progress={bulkProgress} />

        {loading && candidates.length === 0 ? (
          <LoadingState visible />
        ) : error ? (
          <ErrorState error={error} onRetry={fetchCandidates} />
        ) : candidates.length === 0 ? (
          <EmptyState />
        ) : (
          <CandidateGrid
            candidates={candidates}
            selectedIds={selectedIds}
            processingIds={processingIds}
            service={service}
            onToggleSelect={toggleSelect}
            onApprove={(id) => handleApprove(id)}
            onReject={(id) => handleReject(id)}
            onDelete={(id) => handleDelete(id)}
            onEdit={setEditingCandidate}
            onImport={setImportingCandidate}
          />
        )}
      </div>

      <ReviewPanelDialogs
        service={service}
        editingCandidate={editingCandidate}
        onEditSave={(id, adjustedBoundary) => {
          handleApprove(id, adjustedBoundary);
          setEditingCandidate(null);
        }}
        onEditCancel={() => setEditingCandidate(null)}
        importingCandidate={importingCandidate}
        onImportComplete={handleImportComplete}
        onImportClose={() => setImportingCandidate(null)}
        showGenerateDialog={showGenerateDialog}
        projectId={projectId}
        sessionId={sessionId}
        videoPath={videoPath}
        onStateMachineGenerated={handleStateMachineGenerated}
        onGenerateClose={() => setShowGenerateDialog(false)}
        settingHintCandidates={settingHintCandidates}
        uniqueStateHints={uniqueStateHints}
        onStateHintSaved={handleStateHintSaved}
        onStateHintClose={() => setSettingHintCandidates([])}
      />
    </div>
  );
}
