/**
 * Invite Member Dialog Component
 *
 * Dialog for inviting new members to an organization with:
 * - Email input field
 * - Role selector (Admin, Member, Viewer)
 * - Send invitation button
 * - List of pending invitations
 * - Ability to resend or cancel invitations
 */

"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Mail,
  Send,
  X,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import type {
  Invitation,
  InvitationCreate,
  MemberRole,
} from "@/types/collaboration";
import {
  inviteMember,
  getInvitations,
  cancelInvitation,
  resendInvitation,
} from "@/lib/api/organizations";

// ============================================================================
// Types
// ============================================================================

export interface InviteMemberDialogProps {
  open: boolean;
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onInvitationSent?: (invitation: Invitation) => void;
}

// ============================================================================
// Helper Functions
// ============================================================================

function getRoleBadgeVariant(
  role: MemberRole
): "default" | "secondary" | "outline" {
  switch (role) {
    case "admin":
      return "default";
    case "member":
      return "secondary";
    case "viewer":
      return "outline";
    default:
      return "secondary";
  }
}

function getStatusIcon(status: Invitation["status"]) {
  switch (status) {
    case "pending":
      return <Clock className="h-4 w-4 text-yellow-500" />;
    case "accepted":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "expired":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "revoked":
      return <XCircle className="h-4 w-4 text-text-muted" />;
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// ============================================================================
// Main Component
// ============================================================================

export function InviteMemberDialog({
  open,
  organizationId,
  organizationName,
  onClose,
  onInvitationSent,
}: InviteMemberDialogProps) {
  // State
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("member");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [invitationToCancel, setInvitationToCancel] =
    useState<Invitation | null>(null);

  // Load invitations when dialog opens
  useEffect(() => {
    if (open) {
      loadInvitations();
    }
  }, [open, organizationId]);

  // Load invitations from API
  const loadInvitations = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getInvitations(organizationId);
      setInvitations(data.filter((inv) => inv.status === "pending"));
    } catch (error) {
      console.error("Failed to load invitations:", error);
      toast.error("Failed to load pending invitations");
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  // Send invitation
  const handleSendInvitation = useCallback(async () => {
    if (!email) {
      toast.error("Please enter an email address");
      return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsSending(true);
    try {
      const data: InvitationCreate = {
        email: email.trim(),
        role,
      };

      const invitation = await inviteMember(organizationId, data);

      toast.success(`Invitation sent to ${email}`);
      setEmail("");
      setRole("member");

      // Refresh invitations list
      await loadInvitations();

      onInvitationSent?.(invitation);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to send invitation";
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  }, [email, role, organizationId, loadInvitations, onInvitationSent]);

  // Resend invitation
  const handleResendInvitation = useCallback(
    async (invitation: Invitation) => {
      try {
        await resendInvitation(organizationId, invitation.id);
        toast.success(`Invitation resent to ${invitation.email}`);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to resend invitation";
        toast.error(message);
      }
    },
    [organizationId]
  );

  // Cancel invitation
  const handleCancelInvitation = useCallback(async () => {
    if (!invitationToCancel) return;

    try {
      await cancelInvitation(organizationId, invitationToCancel.id);
      toast.success(
        `Invitation to ${invitationToCancel.email} has been cancelled`
      );

      // Remove from list
      setInvitations(
        invitations.filter((inv) => inv.id !== invitationToCancel.id)
      );
      setInvitationToCancel(null);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to cancel invitation";
      toast.error(message);
    }
  }, [organizationId, invitationToCancel, invitations]);

  // Handle dialog close
  const handleClose = useCallback(() => {
    setEmail("");
    setRole("member");
    onClose();
  }, [onClose]);

  return (
    <>
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Invite Members to {organizationName}</DialogTitle>
            <DialogDescription>
              Send invitations to collaborate on this organization
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Invitation Form */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="colleague@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSendInvitation();
                        }
                      }}
                      className="pl-9"
                      disabled={isSending}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(value) => setRole(value as MemberRole)}
                >
                  <SelectTrigger id="role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Admin</span>
                        <span className="text-xs text-muted-foreground">
                          Can manage members and settings
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="member">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Member</span>
                        <span className="text-xs text-muted-foreground">
                          Can edit projects and workflows
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="viewer">
                      <div className="flex flex-col items-start">
                        <span className="font-medium">Viewer</span>
                        <span className="text-xs text-muted-foreground">
                          Can only view projects
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleSendInvitation}
                disabled={isSending || !email}
                className="w-full"
              >
                {isSending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Invitation
                  </>
                )}
              </Button>
            </div>

            <Separator />

            {/* Pending Invitations List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Pending Invitations</Label>
                {invitations.length > 0 && (
                  <Badge variant="secondary">{invitations.length}</Badge>
                )}
              </div>

              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : invitations.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Mail className="h-12 w-12 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No pending invitations</p>
                </div>
              ) : (
                <ScrollArea className="h-[200px] rounded-md border">
                  <div className="p-4 space-y-3">
                    {invitations.map((invitation) => (
                      <div
                        key={invitation.id}
                        className="flex items-center justify-between gap-4 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-medium text-sm truncate">
                              {invitation.email}
                            </p>
                            <Badge
                              variant={getRoleBadgeVariant(invitation.role)}
                              className="text-xs"
                            >
                              {invitation.role}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            {getStatusIcon(invitation.status)}
                            <span>
                              Invited {formatDate(invitation.invited_at)}
                            </span>
                            <span>•</span>
                            <span>
                              Expires {formatDate(invitation.expires_at)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleResendInvitation(invitation)}
                            className="h-8 w-8 p-0"
                            title="Resend invitation"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setInvitationToCancel(invitation)}
                            className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                            title="Cancel invitation"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Invitation Confirmation */}
      <AlertDialog
        open={!!invitationToCancel}
        onOpenChange={() => setInvitationToCancel(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              Cancel Invitation
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the invitation to{" "}
              <span className="font-medium">{invitationToCancel?.email}</span>?
              They will no longer be able to accept this invitation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Invitation</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelInvitation}
              className="bg-destructive hover:bg-destructive/90"
            >
              Cancel Invitation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
