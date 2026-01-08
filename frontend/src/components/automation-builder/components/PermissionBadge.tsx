/**
 * PermissionBadge Component
 *
 * Displays a permission level badge with an icon and color-coded styling
 */

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Eye, Mail, Edit, Shield, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PermissionLevel } from "@/types/collaboration";

interface PermissionBadgeProps {
  permission: PermissionLevel;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const permissionConfig = {
  view: {
    icon: Eye,
    label: "View",
    color: "bg-gray-500/10 text-text-muted border-gray-500/20",
  },
  comment: {
    icon: Mail,
    label: "Comment",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  edit: {
    icon: Edit,
    label: "Edit",
    color: "bg-green-500/10 text-green-400 border-green-500/20",
  },
  admin: {
    icon: Shield,
    label: "Admin",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  owner: {
    icon: Crown,
    label: "Owner",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  none: {
    icon: Eye,
    label: "No Access",
    color: "bg-red-500/10 text-red-400 border-red-500/20",
  },
};

const sizeClasses = {
  sm: "text-xs px-1.5 py-0.5",
  md: "text-xs px-2 py-1",
  lg: "text-sm px-2.5 py-1.5",
};

const iconSizes = {
  sm: "h-2.5 w-2.5",
  md: "h-3 w-3",
  lg: "h-3.5 w-3.5",
};

export function PermissionBadge({
  permission,
  className,
  size = "sm",
}: PermissionBadgeProps) {
  const config = permissionConfig[permission];
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn(
        "flex items-center gap-1 font-medium border",
        config.color,
        sizeClasses[size],
        className
      )}
    >
      <Icon className={iconSizes[size]} />
      <span>{config.label}</span>
    </Badge>
  );
}

/**
 * Compact version with icon only
 */
export function PermissionIcon({
  permission,
  className,
  size = "sm",
}: PermissionBadgeProps) {
  const config = permissionConfig[permission];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full",
        config.color,
        className
      )}
      title={config.label}
    >
      <Icon className={iconSizes[size]} />
    </div>
  );
}
