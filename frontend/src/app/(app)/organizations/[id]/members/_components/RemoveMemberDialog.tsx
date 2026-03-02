import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TeamMember } from "@/types/collaboration";

interface RemoveMemberDialogProps {
  member: TeamMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (member: TeamMember) => Promise<void>;
}

export function RemoveMemberDialog({
  member,
  open,
  onOpenChange,
  onRemove,
}: RemoveMemberDialogProps) {
  const [removing, setRemoving] = useState(false);

  const handleRemove = async () => {
    if (!member) return;
    setRemoving(true);
    try {
      await onRemove(member);
      onOpenChange(false);
    } catch (err: unknown) {
      console.error("Failed to remove member:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to remove member"
      );
    } finally {
      setRemoving(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="bg-background border-border">
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            Are you sure you want to remove {member?.name || member?.email} from
            this organization? They will lose access to all organization
            resources.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="border-border" disabled={removing}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRemove}
            disabled={removing}
            className="bg-red-500 hover:bg-red-600 text-white"
          >
            {removing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Removing...
              </>
            ) : (
              "Remove Member"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
