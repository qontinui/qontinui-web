"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  UserPlus,
  UserMinus,
  User as UserIcon,
  Calendar,
  Mail,
} from "lucide-react";
import { Deficiency } from "@/types/deficiency";
import { User } from "@/types/auth-types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface DeficiencyAssignmentProps {
  deficiency: Deficiency;
  availableUsers?: User[];
  onAssignmentChange?: (userId: string | null) => Promise<void>;
  className?: string;
}

/**
 * DeficiencyAssignment - Assign deficiency to team member
 *
 * Features:
 * - Assign/unassign deficiencies to users
 * - Display currently assigned user with avatar
 * - Show assignment date
 * - User selection dropdown
 * - Email notification option (optional)
 * - Loading states during assignment changes
 */
export function DeficiencyAssignment({
  deficiency,
  availableUsers = [],
  onAssignmentChange,
  className,
}: DeficiencyAssignmentProps) {
  const [isAssigning, setIsAssigning] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [assignedUser, setAssignedUser] = useState<User | null>(null);

  // Find assigned user from available users
  useEffect(() => {
    if (deficiency.assigned_to_user_id && availableUsers.length > 0) {
      const user = availableUsers.find(
        (u) => u.id === deficiency.assigned_to_user_id
      );
      setAssignedUser(user || null);
    } else {
      setAssignedUser(null);
    }
  }, [deficiency.assigned_to_user_id, availableUsers]);

  const handleAssign = async () => {
    if (!selectedUserId || !onAssignmentChange) return;

    setIsAssigning(true);
    try {
      await onAssignmentChange(selectedUserId);
      const user = availableUsers.find((u) => u.id === selectedUserId);
      toast.success(
        `Assigned to ${user?.full_name || user?.username || "user"}`
      );
      setSelectedUserId(null);
    } catch (error) {
      toast.error("Failed to assign deficiency");
      console.error("Assignment error:", error);
    } finally {
      setIsAssigning(false);
    }
  };

  const handleUnassign = async () => {
    if (!onAssignmentChange) return;

    setIsAssigning(true);
    try {
      await onAssignmentChange(null);
      toast.success("Deficiency unassigned");
    } catch (error) {
      toast.error("Failed to unassign deficiency");
      console.error("Unassignment error:", error);
    } finally {
      setIsAssigning(false);
    }
  };

  return (
    <Card className={cn("w-full", className)} data-ui-id="testing-deficiency-assignment">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserIcon className="h-5 w-5" />
          Assignment
        </CardTitle>
        <CardDescription>
          Assign this deficiency to a team member
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Currently Assigned */}
        {assignedUser ? (
          <div className="space-y-3">
            <label className="text-sm font-medium">Currently Assigned To</label>
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <Avatar className="h-10 w-10">
                <div className="h-full w-full bg-primary/10 flex items-center justify-center">
                  <UserIcon className="h-5 w-5 text-primary" />
                </div>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="font-medium">
                  {assignedUser.full_name || assignedUser.username}
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                  <Mail className="h-3 w-3" />
                  {assignedUser.email}
                </div>
                {deficiency.assigned_at && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <Calendar className="h-3 w-3" />
                    Assigned{" "}
                    {new Date(deficiency.assigned_at).toLocaleDateString()}
                  </div>
                )}
                {assignedUser.is_superuser && (
                  <Badge variant="secondary" className="mt-2 text-xs">
                    Admin
                  </Badge>
                )}
              </div>
            </div>
            {onAssignmentChange && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnassign}
                disabled={isAssigning}
                className="w-full"
                data-ui-id="testing-deficiency-assignment-unassign-btn"
              >
                <UserMinus className="h-4 w-4 mr-2" />
                {isAssigning ? "Unassigning..." : "Unassign"}
              </Button>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            Not assigned to anyone
          </div>
        )}

        {/* Assign to User */}
        {onAssignmentChange && availableUsers.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <label className="text-sm font-medium">
                {assignedUser ? "Reassign To" : "Assign To"}
              </label>
              <div className="flex gap-2">
                <Select
                  value={selectedUserId || ""}
                  onValueChange={setSelectedUserId}
                  disabled={isAssigning}
                >
                  <SelectTrigger className="flex-1" data-ui-id="testing-deficiency-assignment-user-select">
                    <SelectValue placeholder="Select team member..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableUsers
                      .filter(
                        (user) => user.id !== deficiency.assigned_to_user_id
                      )
                      .map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          <div className="flex items-center gap-2">
                            <UserIcon className="h-4 w-4" />
                            <span>{user.full_name || user.username}</span>
                            {user.is_superuser && (
                              <Badge
                                variant="secondary"
                                className="text-xs ml-1"
                              >
                                Admin
                              </Badge>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleAssign}
                  disabled={!selectedUserId || isAssigning}
                  size="default"
                  data-ui-id="testing-deficiency-assignment-assign-btn"
                >
                  {isAssigning ? (
                    "Assigning..."
                  ) : (
                    <>
                      <UserPlus className="h-4 w-4 mr-2" />
                      Assign
                    </>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}

        {/* Info */}
        {!onAssignmentChange && (
          <p className="text-xs text-muted-foreground text-center py-2">
            You don&apos;t have permission to assign this deficiency
          </p>
        )}

        {onAssignmentChange && availableUsers.length === 0 && !assignedUser && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No team members available for assignment
          </p>
        )}
      </CardContent>
    </Card>
  );
}
