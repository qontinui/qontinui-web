"use client";

import * as React from "react";
import { Users, Loader2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface Collaborator {
  id: string;
  name: string;
  email?: string;
  avatar_url?: string;
  status?: "active" | "idle" | "offline";
}

interface CollaboratorAvatarsProps {
  collaborators: Collaborator[];
  maxVisible?: number;
  size?: "sm" | "md" | "lg";
  showBorder?: boolean;
  showStatus?: boolean;
  loading?: boolean;
  className?: string;
  onAvatarClick?: (collaborator: Collaborator) => void;
}

const sizeClasses = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
};

const statusColors = {
  active: "bg-green-500",
  idle: "bg-yellow-500",
  offline: "bg-gray-500",
};

const statusBorderColors = {
  active: "ring-green-500/50",
  idle: "ring-yellow-500/50",
  offline: "ring-gray-500/50",
};

export function CollaboratorAvatars({
  collaborators,
  maxVisible = 5,
  size = "md",
  showBorder = true,
  showStatus = true,
  loading = false,
  className,
  onAvatarClick,
}: CollaboratorAvatarsProps) {
  const [showAll, setShowAll] = React.useState(false);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const visibleCollaborators = collaborators.slice(0, maxVisible);
  const remainingCount = Math.max(0, collaborators.length - maxVisible);

  if (loading) {
    return (
      <div className={cn("flex items-center", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (collaborators.length === 0) {
    return null;
  }

  return (
    <TooltipProvider>
      <div className={cn("flex items-center", className)}>
        {/* Avatar Stack */}
        <div className="flex -space-x-2">
          {visibleCollaborators.map((collaborator, index) => (
            <Tooltip key={collaborator.id}>
              <TooltipTrigger asChild>
                <div
                  className={cn(
                    "relative",
                    onAvatarClick &&
                      "cursor-pointer hover:z-10 transition-transform hover:scale-110"
                  )}
                  role="button"
                  tabIndex={0}
                  onClick={() => onAvatarClick?.(collaborator)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onAvatarClick?.(collaborator);
                    }
                  }}
                  style={{ zIndex: visibleCollaborators.length - index }}
                >
                  <Avatar
                    src={collaborator.avatar_url}
                    fallback={
                      <span className="text-xs font-medium">
                        {getInitials(collaborator.name)}
                      </span>
                    }
                    className={cn(
                      sizeClasses[size],
                      showBorder && "ring-2 ring-background",
                      showStatus &&
                        collaborator.status &&
                        statusBorderColors[collaborator.status]
                    )}
                  />
                  {showStatus && collaborator.status && (
                    <span
                      className={cn(
                        "absolute bottom-0 right-0 block rounded-full ring-2 ring-background",
                        statusColors[collaborator.status],
                        size === "sm" && "h-1.5 w-1.5",
                        size === "md" && "h-2 w-2",
                        size === "lg" && "h-2.5 w-2.5"
                      )}
                      aria-label={`${collaborator.status} status`}
                    />
                  )}
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <div className="flex flex-col gap-1">
                  <p className="font-medium">{collaborator.name}</p>
                  {collaborator.email && (
                    <p className="text-xs text-muted-foreground">
                      {collaborator.email}
                    </p>
                  )}
                  {showStatus && collaborator.status && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "w-fit text-xs",
                        collaborator.status === "active" &&
                          "bg-green-500/10 text-green-500 border-green-500/20",
                        collaborator.status === "idle" &&
                          "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
                        collaborator.status === "offline" &&
                          "bg-gray-500/10 text-gray-500 border-gray-500/20"
                      )}
                    >
                      {collaborator.status.charAt(0).toUpperCase() +
                        collaborator.status.slice(1)}
                    </Badge>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Show remaining count */}
          {remainingCount > 0 && (
            <Dialog open={showAll} onOpenChange={setShowAll}>
              <DialogTrigger asChild>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className={cn(
                        "relative flex items-center justify-center rounded-full bg-muted hover:bg-muted/80 transition-colors",
                        sizeClasses[size],
                        showBorder && "ring-2 ring-background",
                        "cursor-pointer hover:z-10"
                      )}
                      aria-label={`Show ${remainingCount} more collaborators`}
                    >
                      <span className="text-xs font-medium text-muted-foreground">
                        +{remainingCount}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Show all {collaborators.length} collaborators</p>
                  </TooltipContent>
                </Tooltip>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    All Collaborators ({collaborators.length})
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {collaborators.map((collaborator) => (
                    <div
                      key={collaborator.id}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50",
                        onAvatarClick && "cursor-pointer"
                      )}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        onAvatarClick?.(collaborator);
                        setShowAll(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          (() => {
                            onAvatarClick?.(collaborator);
                            setShowAll(false);
                          })();
                        }
                      }}
                    >
                      <div className="relative">
                        <Avatar
                          src={collaborator.avatar_url}
                          fallback={
                            <span className="text-xs font-medium">
                              {getInitials(collaborator.name)}
                            </span>
                          }
                          className="h-10 w-10"
                        />
                        {showStatus && collaborator.status && (
                          <span
                            className={cn(
                              "absolute bottom-0 right-0 block h-2.5 w-2.5 rounded-full ring-2 ring-background",
                              statusColors[collaborator.status]
                            )}
                          />
                        )}
                      </div>
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-medium truncate">
                          {collaborator.name}
                        </span>
                        {collaborator.email && (
                          <span className="text-xs text-muted-foreground truncate">
                            {collaborator.email}
                          </span>
                        )}
                      </div>
                      {showStatus && collaborator.status && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "shrink-0 text-xs",
                            collaborator.status === "active" &&
                              "bg-green-500/10 text-green-500 border-green-500/20",
                            collaborator.status === "idle" &&
                              "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
                            collaborator.status === "offline" &&
                              "bg-gray-500/10 text-gray-500 border-gray-500/20"
                          )}
                        >
                          {collaborator.status}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
