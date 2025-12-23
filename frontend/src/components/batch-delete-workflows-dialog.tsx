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
import { ScrollArea } from "@/components/ui/scroll-area";

interface BatchDeleteWorkflowsDialogProps {
  open: boolean;
  workflowNames: string[];
  onClose: () => void;
  onConfirm: () => void;
}

export function BatchDeleteWorkflowsDialog({
  open,
  workflowNames,
  onClose,
  onConfirm,
}: BatchDeleteWorkflowsDialogProps) {
  const count = workflowNames.length;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Delete {count} Workflow{count !== 1 ? "s" : ""}
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete {count} workflow
            {count !== 1 ? "s" : ""}? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {count > 0 && (
          <ScrollArea className="max-h-[200px] rounded-md border border-gray-700 p-2">
            <ul className="space-y-1">
              {workflowNames.map((name, index) => (
                <li
                  key={index}
                  className="text-sm text-gray-300 truncate"
                  title={name}
                >
                  {name}
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}

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
            Delete {count} Workflow{count !== 1 ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
