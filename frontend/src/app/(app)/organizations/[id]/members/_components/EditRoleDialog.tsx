import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { TeamMember, MemberRole } from "@/types/collaboration";

interface EditRoleDialogProps {
  member: TeamMember | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateRole: (member: TeamMember, role: MemberRole) => Promise<void>;
}

export function EditRoleDialog({
  member,
  open,
  onOpenChange,
  onUpdateRole,
}: EditRoleDialogProps) {
  const [role, setRole] = useState<MemberRole>("member");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (member) {
      setRole(member.role);
    }
  }, [member]);

  const handleSubmit = async () => {
    if (!member) return;
    setUpdating(true);
    try {
      await onUpdateRole(member, role);
      onOpenChange(false);
    } catch (err: unknown) {
      console.error("Failed to update role:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to update member role"
      );
    } finally {
      setUpdating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-border">
        <DialogHeader>
          <DialogTitle>Change Member Role</DialogTitle>
          <DialogDescription>
            Update the role for {member?.name || member?.email}
          </DialogDescription>
        </DialogHeader>

        <div>
          <Label htmlFor="edit-role">Role</Label>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as MemberRole)}
          >
            <SelectTrigger className="bg-background border-border mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-background border-border">
              <SelectItem value="admin">
                Admin - Full management access
              </SelectItem>
              <SelectItem value="member">
                Member - Can edit and collaborate
              </SelectItem>
              <SelectItem value="viewer">Viewer - View-only access</SelectItem>
              <SelectItem value="helper">
                Helper - Answers quick review questions only
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border"
            disabled={updating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={updating}
            className="bg-primary text-primary-foreground"
          >
            {updating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Updating...
              </>
            ) : (
              "Update Role"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
