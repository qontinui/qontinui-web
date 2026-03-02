import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useSnapshotScreenshotSelector } from "./_hooks/useSnapshotScreenshotSelector";
import { SnapshotRunList, ScreenshotGrid } from "./_components";
import type { SnapshotScreenshotSelectorProps } from "./snapshot-selector-types";

const DEFAULT_STATE_FILTER: string[] = [];

const SnapshotScreenshotSelector: React.FC<SnapshotScreenshotSelectorProps> = ({
  isOpen,
  onClose,
  onSelect,
  stateFilter = DEFAULT_STATE_FILTER,
}) => {
  const {
    snapshots,
    snapshotsLoading,
    selectedSnapshot,
    setSelectedSnapshot,
    selectedScreenshots,
    searchQuery,
    setSearchQuery,
    thumbnailCache,
    loadingThumbnails,
    screenshots,
    loading,
    uniqueStates,
    stateScreenshotCounts,
    filteredScreenshots,
    toggleScreenshot,
    handleSelectAll,
    handleClearAll,
    handleSelectAllWithState,
    getSelectedForConfirm,
  } = useSnapshotScreenshotSelector(isOpen, stateFilter);

  const handleConfirm = () => {
    onSelect(getSelectedForConfirm());
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Select Screenshots from Snapshots</DialogTitle>
          <DialogDescription>
            Choose screenshots from imported snapshot runs to use for pattern
            creation
          </DialogDescription>
        </DialogHeader>

        {stateFilter && stateFilter.length > 0 && (
          <Alert className="mb-2">
            <Info className="h-4 w-4" />
            <AlertDescription className="text-sm">
              Filtering by states: {stateFilter.join(", ")}
              <span className="ml-2 text-text-muted">
                (Showing screenshots that have all selected states)
              </span>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-3 gap-4 h-[600px]">
          <div className="border-r pr-4">
            <h3 className="font-semibold text-sm mb-3">Snapshot Runs</h3>
            <SnapshotRunList
              snapshots={snapshots}
              snapshotsLoading={snapshotsLoading}
              selectedSnapshot={selectedSnapshot}
              onSelectSnapshot={setSelectedSnapshot}
              thumbnailCache={thumbnailCache}
              loadingThumbnails={loadingThumbnails}
            />
          </div>

          <div className="col-span-2">
            <ScreenshotGrid
              selectedSnapshot={selectedSnapshot}
              screenshots={screenshots}
              loading={loading}
              filteredScreenshots={filteredScreenshots}
              selectedScreenshots={selectedScreenshots}
              uniqueStates={uniqueStates}
              stateScreenshotCounts={stateScreenshotCounts}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              onToggleScreenshot={toggleScreenshot}
              onSelectAll={handleSelectAll}
              onClearAll={handleClearAll}
              onSelectAllWithState={handleSelectAllWithState}
            />
          </div>
        </div>

        <div className="flex justify-between items-center pt-4 border-t">
          <p className="text-sm text-text-secondary">
            {selectedScreenshots.size} screenshot
            {selectedScreenshots.size !== 1 ? "s" : ""} selected
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={selectedScreenshots.size === 0}
            >
              Add Selected ({selectedScreenshots.size})
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SnapshotScreenshotSelector;
