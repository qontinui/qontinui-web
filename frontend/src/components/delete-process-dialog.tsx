import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface DeleteWorkflowDialogProps {
  open: boolean;
  workflowName: string;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteWorkflowDialog({
  open,
  workflowName,
  onClose,
  onConfirm,
}: DeleteWorkflowDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]" onSubmit={onConfirm}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Delete Workflow
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete &quot;{workflowName}&quot;? This action cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            variant="destructive"
            className="w-full sm:w-auto"
          >
            Delete Workflow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
