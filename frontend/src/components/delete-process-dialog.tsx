import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

interface DeleteProcessDialogProps {
  open: boolean
  processName: string
  onClose: () => void
  onConfirm: () => void
}

export function DeleteProcessDialog({
  open,
  processName,
  onClose,
  onConfirm,
}: DeleteProcessDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Delete Process
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{processName}"? This action cannot be undone.
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
            Delete Process
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
