"use client";

import * as React from "react";
import { Lock, Eye, AlertCircle, Clock, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface EditLock {
  locked_by_user_id: string;
  locked_by_user_name: string;
  locked_by_user_avatar?: string;
  locked_at: Date | string;
  lock_expires_at?: Date | string;
  lock_duration_seconds?: number;
}

interface EditLockBannerProps {
  lock: EditLock;
  currentUserId?: string;
  onRequestAccess?: () => void;
  onOverride?: () => void;
  canOverride?: boolean;
  className?: string;
}

export function EditLockBanner({
  lock,
  currentUserId,
  onRequestAccess,
  onOverride,
  canOverride = false,
  className,
}: EditLockBannerProps) {
  const [timeRemaining, setTimeRemaining] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!lock.lock_expires_at) return;

    const updateTimeRemaining = () => {
      const expiresAt =
        typeof lock.lock_expires_at === "string"
          ? new Date(lock.lock_expires_at)
          : lock.lock_expires_at;
      const now = new Date();
      const remaining = Math.max(0, expiresAt.getTime() - now.getTime());
      setTimeRemaining(Math.floor(remaining / 1000));

      if (remaining <= 0) {
        // Lock expired - could trigger a refresh or callback here
        return;
      }
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 1000);

    return () => clearInterval(interval);
  }, [lock.lock_expires_at]);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatTimeRemaining = (seconds: number) => {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  };

  const isCurrentUserLocked = lock.locked_by_user_id === currentUserId;

  if (isCurrentUserLocked) {
    return (
      <Alert className={cn("border-green-500/50 bg-green-500/10", className)}>
        <Lock className="h-4 w-4 text-green-500" />
        <AlertTitle className="text-green-500">You are editing</AlertTitle>
        <AlertDescription className="text-green-500/90">
          You have exclusive edit access to this resource.
          {timeRemaining !== null && (
            <span className="ml-2 font-medium">
              Lock expires in {formatTimeRemaining(timeRemaining)}
            </span>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className={cn("border-orange-500/50 bg-orange-500/10", className)}>
      <AlertCircle className="h-4 w-4 text-orange-500" />
      <AlertTitle className="flex items-center gap-2 text-orange-500">
        <Eye className="h-4 w-4" />
        View Only Mode
      </AlertTitle>
      <AlertDescription className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Avatar
              src={lock.locked_by_user_avatar}
              fallback={
                <span className="text-xs font-medium">
                  {getInitials(lock.locked_by_user_name)}
                </span>
              }
              className="h-8 w-8"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">
                {lock.locked_by_user_name}
              </span>
              <span className="text-xs text-muted-foreground">
                is currently editing this resource
              </span>
            </div>
          </div>

          {timeRemaining !== null && timeRemaining > 0 && (
            <Badge variant="outline" className="ml-auto">
              <Clock className="mr-1 h-3 w-3" />
              {formatTimeRemaining(timeRemaining)} remaining
            </Badge>
          )}

          {timeRemaining !== null && timeRemaining === 0 && (
            <Badge
              variant="outline"
              className="ml-auto bg-red-500/10 text-red-500 border-red-500/20"
            >
              <AlertCircle className="mr-1 h-3 w-3" />
              Lock expired
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {onRequestAccess && timeRemaining !== 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={onRequestAccess}
              className="border-orange-500/30 hover:bg-orange-500/10 text-orange-500"
            >
              <Mail className="mr-2 h-3 w-3" />
              Request Edit Access
            </Button>
          )}

          {canOverride && onOverride && (
            <Button
              size="sm"
              variant="outline"
              onClick={onOverride}
              className="border-red-500/30 hover:bg-red-500/10 text-red-500"
            >
              <Lock className="mr-2 h-3 w-3" />
              Override Lock
            </Button>
          )}

          <span className="text-xs text-muted-foreground ml-auto">
            Changes will be available after the lock is released
          </span>
        </div>
      </AlertDescription>
    </Alert>
  );
}
