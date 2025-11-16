'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Mail,
  UserPlus,
  X,
  RefreshCw,
  Trash2,
  Check,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

const inviteFormSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['viewer', 'member', 'admin']),
});

type InviteFormData = z.infer<typeof inviteFormSchema>;

export interface PendingInvitation {
  id: string;
  email: string;
  role: 'viewer' | 'member' | 'admin';
  invited_by: string;
  invited_at: Date | string;
  status: 'pending' | 'sent' | 'error';
}

interface InviteMemberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pendingInvitations: PendingInvitation[];
  onInvite: (email: string, role: 'viewer' | 'member' | 'admin') => Promise<void>;
  onResend: (invitationId: string) => Promise<void>;
  onCancel: (invitationId: string) => Promise<void>;
}

export function InviteMemberDialog({
  open,
  onOpenChange,
  pendingInvitations,
  onInvite,
  onResend,
  onCancel,
}: InviteMemberDialogProps) {
  const [loading, setLoading] = React.useState(false);
  const [actionLoading, setActionLoading] = React.useState<string | null>(null);

  const form = useForm<InviteFormData>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: {
      email: '',
      role: 'member',
    },
  });

  const handleSubmit = async (data: InviteFormData) => {
    setLoading(true);
    try {
      await onInvite(data.email, data.role);
      toast.success(`Invitation sent to ${data.email}`);
      form.reset();
    } catch (error: any) {
      toast.error(error.message || 'Failed to send invitation');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async (invitationId: string, email: string) => {
    setActionLoading(invitationId);
    try {
      await onResend(invitationId);
      toast.success(`Invitation resent to ${email}`);
    } catch (error: any) {
      toast.error(error.message || 'Failed to resend invitation');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (invitationId: string, email: string) => {
    if (!confirm(`Cancel invitation to ${email}?`)) return;
    setActionLoading(invitationId);
    try {
      await onCancel(invitationId);
      toast.success('Invitation cancelled');
    } catch (error: any) {
      toast.error(error.message || 'Failed to cancel invitation');
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (date: Date | string) => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return formatDistanceToNow(dateObj, { addSuffix: true });
  };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
      case 'member':
        return 'bg-green-500/10 text-green-500 border-green-500/20';
      case 'viewer':
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
      default:
        return '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Invite Team Members</DialogTitle>
          <DialogDescription>
            Send invitations to collaborate on this project
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="colleague@example.com"
              {...form.register('email')}
              disabled={loading}
              aria-invalid={!!form.formState.errors.email}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role</Label>
            <Select
              value={form.watch('role')}
              onValueChange={(value) =>
                form.setValue('role', value as 'viewer' | 'member' | 'admin')
              }
              disabled={loading}
            >
              <SelectTrigger id="role" aria-label="Select member role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="viewer">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Viewer</span>
                    <span className="text-xs text-muted-foreground">
                      Can view and comment
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="member">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Member</span>
                    <span className="text-xs text-muted-foreground">
                      Can view, comment, and edit
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="admin">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Admin</span>
                    <span className="text-xs text-muted-foreground">
                      Full access including member management
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending Invitation...
              </>
            ) : (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Send Invitation
              </>
            )}
          </Button>
        </form>

        {/* Pending Invitations */}
        {pendingInvitations.length > 0 && (
          <>
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Pending Invitations ({pendingInvitations.length})
              </h3>
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {pendingInvitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between gap-3 p-3 border rounded-lg bg-muted/50"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <Avatar
                        fallback={
                          <Mail className="h-4 w-4" />
                        }
                        className="h-8 w-8"
                      />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium truncate">
                          {invitation.email}
                        </span>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>Invited {formatDate(invitation.invited_at)}</span>
                          {invitation.status === 'error' && (
                            <Badge
                              variant="outline"
                              className="bg-destructive/10 text-destructive border-destructive/20"
                            >
                              Failed
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        className={getRoleBadgeColor(invitation.role)}
                      >
                        {invitation.role}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleResend(invitation.id, invitation.email)}
                        disabled={actionLoading === invitation.id}
                        aria-label={`Resend invitation to ${invitation.email}`}
                        title="Resend invitation"
                      >
                        {actionLoading === invitation.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCancel(invitation.id, invitation.email)}
                        disabled={actionLoading === invitation.id}
                        aria-label={`Cancel invitation to ${invitation.email}`}
                        title="Cancel invitation"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
