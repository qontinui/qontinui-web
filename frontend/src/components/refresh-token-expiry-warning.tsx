"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { authService } from "@/services/service-factory";
import { toast } from "sonner";

export function RefreshTokenExpiryWarning() {
  const [showWarning, setShowWarning] = useState(false);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check refresh token expiry every hour
    const checkRefreshTokenExpiry = () => {
      const refreshExpiry = authService.tokenManager.getRefreshTokenExpiry();

      if (!refreshExpiry) {
        return;
      }

      const now = Date.now();
      const timeUntilExpiry = refreshExpiry - now;
      const daysUntilExpiry = Math.ceil(
        timeUntilExpiry / (24 * 60 * 60 * 1000)
      );

      // Show warning if refresh token expires in 7 days or less
      if (daysUntilExpiry <= 7 && daysUntilExpiry > 0 && !showWarning) {
        console.log(
          "[RefreshTokenExpiryWarning] Refresh token expiring soon:",
          {
            timestamp: new Date().toISOString(),
            expiryDate: new Date(refreshExpiry).toISOString(),
            daysRemaining: daysUntilExpiry,
          }
        );
        setDaysRemaining(daysUntilExpiry);
        setShowWarning(true);
      }
    };

    // Initial check
    checkRefreshTokenExpiry();

    // Check every hour
    const intervalId = setInterval(checkRefreshTokenExpiry, 60 * 60 * 1000);

    return () => {
      clearInterval(intervalId);
      if (dismissTimeoutRef.current) {
        clearTimeout(dismissTimeoutRef.current);
        dismissTimeoutRef.current = null;
      }
    };
  }, [showWarning]);

  const handleDismiss = () => {
    console.log("[RefreshTokenExpiryWarning] User dismissed warning");
    setShowWarning(false);

    // Show reminder again in 24 hours if still expiring
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current);
    }
    dismissTimeoutRef.current = setTimeout(
      () => {
        const refreshExpiry = authService.tokenManager.getRefreshTokenExpiry();
        if (refreshExpiry) {
          const timeUntilExpiry = refreshExpiry - Date.now();
          const daysUntilExpiry = Math.ceil(
            timeUntilExpiry / (24 * 60 * 60 * 1000)
          );
          if (daysUntilExpiry <= 7 && daysUntilExpiry > 0) {
            setDaysRemaining(daysUntilExpiry);
            setShowWarning(true);
          }
        }
      },
      24 * 60 * 60 * 1000
    );
  };

  const handleReLogin = () => {
    console.log("[RefreshTokenExpiryWarning] User chose to re-login");
    toast.info("Please log in again to extend your session");
    authService.logout();
    window.location.href = "/";
  };

  if (!showWarning) {
    return null;
  }

  return (
    <Dialog open={showWarning} onOpenChange={setShowWarning}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-warning" />
            <DialogTitle>Session Expiring Soon</DialogTitle>
          </div>
          <DialogDescription>
            Your long-term session will expire in {daysRemaining}{" "}
            {daysRemaining === 1 ? "day" : "days"}. To maintain uninterrupted
            access, please log in again soon.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleDismiss}>
            Remind Me Tomorrow
          </Button>
          <Button onClick={handleReLogin}>Log In Now</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
