"use client";

import * as React from "react";
import { Eye, Edit, MousePointer2, User, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PresenceStatus = "active" | "viewing" | "editing" | "idle";

export interface UserPresence {
  id: string;
  name: string;
  avatar_url?: string;
  status: PresenceStatus;
  current_location?: string;
  editing_item?: string;
  cursor_position?: { x: number; y: number };
  color?: string;
}

interface PresenceIndicatorProps {
  users: UserPresence[];
  currentUserId?: string;
  showCursors?: boolean;
  collapsible?: boolean;
  className?: string;
  onUserClick?: (user: UserPresence) => void;
}

const statusIcons = {
  active: MousePointer2,
  viewing: Eye,
  editing: Edit,
  idle: User,
};

const statusColors = {
  active: "bg-green-500/10 text-green-500 border-green-500/20",
  viewing: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  editing: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  idle: "bg-gray-500/10 text-gray-500 border-gray-500/20",
};

const statusDotColors = {
  active: "bg-green-500",
  viewing: "bg-blue-500",
  editing: "bg-orange-500",
  idle: "bg-gray-500",
};

const defaultColors = [
  "#FF6B6B",
  "#4ECDC4",
  "#45B7D1",
  "#FFA07A",
  "#98D8C8",
  "#F7B731",
  "#5F27CD",
  "#00D2D3",
  "#FF9FF3",
  "#54A0FF",
];

export function PresenceIndicator({
  users,
  currentUserId,
  showCursors = false,
  collapsible = true,
  className,
  onUserClick,
}: PresenceIndicatorProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getUserColor = (userId: string, userColor?: string) => {
    if (userColor) return userColor;
    const index = userId
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return defaultColors[index % defaultColors.length];
  };

  const activeUsers = users.filter(
    (u) => u.id !== currentUserId && u.status !== "idle"
  );
  const idleUsers = users.filter(
    (u) => u.id !== currentUserId && u.status === "idle"
  );

  if (
    users.length === 0 ||
    (users.length === 1 && users[0].id === currentUserId)
  ) {
    return null;
  }

  return (
    <div
      className={cn("flex flex-col bg-background border rounded-lg", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <div className="relative">
            <User className="h-4 w-4 text-muted-foreground" />
            {activeUsers.length > 0 && (
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-green-500 rounded-full ring-2 ring-background" />
            )}
          </div>
          <span className="text-sm font-medium">
            Active ({activeUsers.length})
          </span>
        </div>
        {collapsible && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={
              collapsed ? "Expand presence panel" : "Collapse presence panel"
            }
          >
            <X
              className={cn(
                "h-4 w-4 transition-transform",
                collapsed && "rotate-45"
              )}
            />
          </Button>
        )}
      </div>

      {/* User List */}
      {!collapsed && (
        <ScrollArea className="max-h-[400px]">
          <div className="p-2 space-y-1">
            {/* Active Users */}
            {activeUsers.length > 0 && (
              <>
                {activeUsers.map((user) => {
                  const StatusIcon = statusIcons[user.status];
                  const userColor = getUserColor(user.id, user.color);

                  return (
                    <div
                      key={user.id}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors",
                        onUserClick && "cursor-pointer"
                      )}
                      onClick={() => onUserClick?.(user)}
                    >
                      <div className="relative">
                        <Avatar
                          src={user.avatar_url}
                          fallback={
                            <span className="text-xs font-medium">
                              {getInitials(user.name)}
                            </span>
                          }
                          className="h-8 w-8"
                          style={{
                            borderColor: userColor,
                            borderWidth: "2px",
                          }}
                        />
                        <span
                          className={cn(
                            "absolute bottom-0 right-0 block h-2 w-2 rounded-full ring-2 ring-background",
                            statusDotColors[user.status]
                          )}
                          aria-label={`${user.status} status`}
                        />
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {user.name}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 text-xs",
                              statusColors[user.status]
                            )}
                          >
                            <StatusIcon className="mr-1 h-3 w-3" />
                            {user.status}
                          </Badge>
                        </div>
                        {user.editing_item && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Edit className="h-3 w-3" />
                            <span className="truncate">
                              Editing: {user.editing_item}
                            </span>
                          </div>
                        )}
                        {user.current_location && !user.editing_item && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Eye className="h-3 w-3" />
                            <span className="truncate">
                              {user.current_location}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Idle Users */}
            {idleUsers.length > 0 && (
              <>
                {activeUsers.length > 0 && <div className="border-t my-2" />}
                <div className="px-2 py-1">
                  <span className="text-xs text-muted-foreground font-medium">
                    Idle ({idleUsers.length})
                  </span>
                </div>
                {idleUsers.map((user) => (
                  <div
                    key={user.id}
                    className={cn(
                      "flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors opacity-60",
                      onUserClick && "cursor-pointer"
                    )}
                    onClick={() => onUserClick?.(user)}
                  >
                    <Avatar
                      src={user.avatar_url}
                      fallback={
                        <span className="text-xs font-medium">
                          {getInitials(user.name)}
                        </span>
                      }
                      className="h-8 w-8"
                    />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm font-medium truncate">
                        {user.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Idle
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}

            {activeUsers.length === 0 && idleUsers.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No other users online
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Cursor Indicators (Optional) */}
      {showCursors &&
        !collapsed &&
        users
          .filter((u) => u.cursor_position && u.id !== currentUserId)
          .map((user) => {
            const userColor = getUserColor(user.id, user.color);
            return (
              <div
                key={`cursor-${user.id}`}
                className="absolute pointer-events-none z-50"
                style={{
                  left: user.cursor_position!.x,
                  top: user.cursor_position!.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <MousePointer2
                  className="h-5 w-5"
                  style={{ color: userColor, fill: userColor }}
                />
                <span
                  className="absolute top-5 left-5 text-xs font-medium px-2 py-1 rounded shadow-lg whitespace-nowrap"
                  style={{
                    backgroundColor: userColor,
                    color: "white",
                  }}
                >
                  {user.name}
                </span>
              </div>
            );
          })}
    </div>
  );
}
