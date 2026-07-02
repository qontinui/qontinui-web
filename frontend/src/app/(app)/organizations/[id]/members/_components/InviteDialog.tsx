import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { MemberRole } from "@/types/collaboration";

interface InviteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvite: (email: string, role: MemberRole) => Promise<void>;
}

export function InviteDialog({
  open,
  onOpenChange,
  onInvite,
}: InviteDialogProps) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [inviting, setInviting] = useState(false);

  const handleSubmit = async () => {
    if (!email) return;
    setInviting(true);
    try {
      await onInvite(email, role);
      onOpenChange(false);
      setEmail("");
      setRole("member");
    } catch (err: unknown) {
      console.error("Failed to invite member:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to send invitation"
      );
    } finally {
      setInviting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-background border-border">
        <DialogHeader>
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Send an invitation to join this organization
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="member@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background border-border mt-1.5"
            />
          </div>

          <div>
            <Label htmlFor="role">Role</Label>
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
                <SelectItem value="viewer">
                  Viewer - View-only access
                </SelectItem>
                <SelectItem value="helper">
                  Helper - Answers quick review questions only
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border"
            disabled={inviting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!email || inviting}
            className="bg-primary text-primary-foreground"
          >
            {inviting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Mail className="w-4 h-4 mr-2" />
                Send Invitation
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
