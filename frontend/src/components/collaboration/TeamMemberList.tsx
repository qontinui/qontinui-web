"use client";

import * as React from "react";
import {
  Search,
  UserPlus,
  MoreVertical,
  Trash2,
  Shield,
  Eye,
  Edit,
  Crown,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

export type MemberRole = "owner" | "admin" | "member" | "viewer";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  role: MemberRole;
  last_active: Date | string;
  status?: "active" | "invited" | "inactive";
}

interface TeamMemberListProps {
  members: TeamMember[];
  currentUserId?: string;
  currentUserRole?: MemberRole;
  onInvite: () => void;
  onRoleChange: (memberId: string, role: MemberRole) => Promise<void>;
  onRemove: (memberId: string) => Promise<void>;
  loading?: boolean;
  className?: string;
}

const ITEMS_PER_PAGE = 10;

const roleIcons = {
  owner: Crown,
  admin: Shield,
  member: Edit,
  viewer: Eye,
};

const roleColors = {
  owner: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  admin: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  member: "bg-green-500/10 text-green-500 border-green-500/20",
  viewer: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

export function TeamMemberList({
  members,
  currentUserId,
  currentUserRole = "viewer",
  onInvite,
  onRoleChange,
  onRemove,
  loading = false,
  className,
}: TeamMemberListProps) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<MemberRole | "all">("all");
  const [currentPage, setCurrentPage] = React.useState(1);
  const [updatingMember, setUpdatingMember] = React.useState<string | null>(
    null
  );

  const canManageMembers = ["owner", "admin"].includes(currentUserRole);

  // Filter members
  const filteredMembers = React.useMemo(() => {
    return members.filter((member) => {
      const matchesSearch =
        member.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        member.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === "all" || member.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [members, searchQuery, roleFilter]);

  // Paginate members
  const totalPages = Math.ceil(filteredMembers.length / ITEMS_PER_PAGE);
  const paginatedMembers = filteredMembers.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE
  );

  const handleRoleChange = async (memberId: string, newRole: MemberRole) => {
    setUpdatingMember(memberId);
    try {
      await onRoleChange(memberId, newRole);
    } finally {
      setUpdatingMember(null);
    }
  };

  const handleRemove = async (memberId: string) => {
    if (!confirm("Are you sure you want to remove this member?")) return;
    setUpdatingMember(memberId);
    try {
      await onRemove(memberId);
    } finally {
      setUpdatingMember(null);
    }
  };

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatLastActive = (date: Date | string) => {
    const dateObj = typeof date === "string" ? new Date(date) : date;
    return formatDistanceToNow(dateObj, { addSuffix: true });
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-9"
              aria-label="Search team members"
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={roleFilter}
            onValueChange={(value) => {
              setRoleFilter(value as MemberRole | "all");
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-[140px]" aria-label="Filter by role">
              <SelectValue placeholder="Filter by role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="owner">Owner</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="viewer">Viewer</SelectItem>
            </SelectContent>
          </Select>
          {canManageMembers && (
            <Button onClick={onInvite} disabled={loading}>
              <UserPlus className="mr-2 h-4 w-4" />
              Invite Member
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : paginatedMembers.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {searchQuery || roleFilter !== "all"
            ? "No members found matching your filters"
            : "No team members yet"}
        </div>
      ) : (
        <>
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Last Active</TableHead>
                  {canManageMembers && (
                    <TableHead className="text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedMembers.map((member) => {
                  const RoleIcon = roleIcons[member.role];
                  const isCurrentUser = member.id === currentUserId;
                  const isUpdating = updatingMember === member.id;

                  return (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={member.avatar_url}
                            fallback={
                              <span className="text-xs font-medium">
                                {getInitials(member.name)}
                              </span>
                            }
                            className="h-8 w-8"
                          />
                          <div className="flex flex-col">
                            <span className="font-medium">
                              {member.name}
                              {isCurrentUser && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  (You)
                                </span>
                              )}
                            </span>
                            {member.status === "invited" && (
                              <Badge variant="outline" className="w-fit mt-1">
                                Invited
                              </Badge>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {member.email}
                      </TableCell>
                      <TableCell>
                        {canManageMembers &&
                        !isCurrentUser &&
                        member.role !== "owner" ? (
                          <Select
                            value={member.role}
                            onValueChange={(value) =>
                              handleRoleChange(member.id, value as MemberRole)
                            }
                            disabled={isUpdating}
                          >
                            <SelectTrigger
                              className={cn(
                                "w-[120px]",
                                roleColors[member.role]
                              )}
                              aria-label={`Change role for ${member.name}`}
                            >
                              <div className="flex items-center gap-2">
                                <RoleIcon className="h-3 w-3" />
                                <SelectValue />
                              </div>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="member">Member</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge
                            variant="outline"
                            className={roleColors[member.role]}
                          >
                            <RoleIcon className="mr-1 h-3 w-3" />
                            {member.role.charAt(0).toUpperCase() +
                              member.role.slice(1)}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatLastActive(member.last_active)}
                      </TableCell>
                      {canManageMembers && (
                        <TableCell className="text-right">
                          {!isCurrentUser && member.role !== "owner" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  disabled={isUpdating}
                                  aria-label={`Actions for ${member.name}`}
                                >
                                  {isUpdating ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <MoreVertical className="h-4 w-4" />
                                  )}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() => handleRemove(member.id)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Remove Member
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{" "}
                {Math.min(currentPage * ITEMS_PER_PAGE, filteredMembers.length)}{" "}
                of {filteredMembers.length} members
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
                  disabled={currentPage === totalPages}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
