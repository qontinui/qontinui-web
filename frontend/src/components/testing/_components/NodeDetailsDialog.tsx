import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { NodeExecutionDetails } from "../StateCoverageHeatMap.types";

interface NodeDetailsDialogProps {
  selectedNode: NodeExecutionDetails | null;
  onClose: () => void;
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case "passing":
      return "bg-green-500/20 text-green-500";
    case "partial":
      return "bg-yellow-500/20 text-yellow-500";
    case "failing":
      return "bg-red-500/20 text-red-500";
    default:
      return "bg-border-default/20 text-text-muted";
  }
}

export function NodeDetailsDialog({
  selectedNode,
  onClose,
}: NodeDetailsDialogProps) {
  return (
    <Dialog
      open={selectedNode !== null}
      onOpenChange={(open) => !open && onClose()}
    >
      <DialogContent className="bg-surface-raised border-border-subtle">
        <DialogHeader>
          <DialogTitle className="text-white">
            {selectedNode?.stateName}
          </DialogTitle>
          <DialogDescription className="text-text-muted">
            Execution details and statistics
          </DialogDescription>
        </DialogHeader>
        {selectedNode && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">Status:</span>
              <span
                className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadgeClass(selectedNode.status)}`}
              >
                {selectedNode.status.toUpperCase()}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-surface-canvas/50 rounded-lg">
                <div className="text-xs text-text-muted mb-1">Total Visits</div>
                <div className="text-2xl font-bold text-brand-primary">
                  {selectedNode.totalAttempts}
                </div>
              </div>
              <div className="p-3 bg-surface-canvas/50 rounded-lg">
                <div className="text-xs text-text-muted mb-1">Success Rate</div>
                <div className="text-2xl font-bold text-brand-success">
                  {selectedNode.successRate.toFixed(1)}%
                </div>
              </div>
              <div className="p-3 bg-surface-canvas/50 rounded-lg">
                <div className="text-xs text-text-muted mb-1">Successful</div>
                <div className="text-2xl font-bold text-green-500">
                  {selectedNode.successfulAttempts}
                </div>
              </div>
              <div className="p-3 bg-surface-canvas/50 rounded-lg">
                <div className="text-xs text-text-muted mb-1">Failed</div>
                <div className="text-2xl font-bold text-red-500">
                  {selectedNode.failedAttempts}
                </div>
              </div>
            </div>

            {selectedNode.totalAttempts > 0 && (
              <div>
                <div className="text-sm text-text-muted mb-2">
                  Execution Breakdown
                </div>
                <div className="h-6 bg-surface-raised rounded-full overflow-hidden flex">
                  <div
                    className="bg-green-500 flex items-center justify-center text-xs font-medium text-white"
                    style={{
                      width: `${(selectedNode.successfulAttempts / selectedNode.totalAttempts) * 100}%`,
                    }}
                  >
                    {selectedNode.successfulAttempts > 0 &&
                      `${((selectedNode.successfulAttempts / selectedNode.totalAttempts) * 100).toFixed(0)}%`}
                  </div>
                  <div
                    className="bg-red-500 flex items-center justify-center text-xs font-medium text-white"
                    style={{
                      width: `${(selectedNode.failedAttempts / selectedNode.totalAttempts) * 100}%`,
                    }}
                  >
                    {selectedNode.failedAttempts > 0 &&
                      `${((selectedNode.failedAttempts / selectedNode.totalAttempts) * 100).toFixed(0)}%`}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
