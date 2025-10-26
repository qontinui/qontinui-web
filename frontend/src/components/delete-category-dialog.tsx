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

interface DeleteCategoryDialogProps {
  open: boolean
  categoryName: string
  processCount: number
  processNames: string[]
  onClose: () => void
  onDeleteAll: () => void
  onMoveToMain: () => void
}

export function DeleteCategoryDialog({
  open,
  categoryName,
  processCount,
  processNames,
  onClose,
  onDeleteAll,
  onMoveToMain,
}: DeleteCategoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Delete Category "{categoryName}"
          </DialogTitle>
          <DialogDescription>
            This category contains {processCount} workflow{processCount !== 1 ? 's' : ''}. What would you like to do with them?
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-4">
          <div className="bg-gray-800/50 rounded-md p-3 max-h-32 overflow-y-auto">
            <ul className="text-sm space-y-1">
              {processNames.map((name, index) => (
                <li key={index} className="text-gray-300">• {name}</li>
              ))}
            </ul>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button
            onClick={onMoveToMain}
            className="w-full bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
          >
            Move to Main Category
          </Button>
          <Button
            onClick={onDeleteAll}
            variant="destructive"
            className="w-full"
          >
            Delete All Workflows
          </Button>
          <Button
            onClick={onClose}
            variant="outline"
            className="w-full"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
