'use client';

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Clock, LogOut } from 'lucide-react';
import { apiClient } from '@/lib/api-client';

export function SessionTimeoutWarning() {
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(180); // 3 minutes in seconds
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const handleSessionExpiring = (event: CustomEvent) => {
      const minutes = event.detail?.minutesRemaining || 3;
      setTimeRemaining(minutes * 60);
      setShowWarning(true);
    };

    window.addEventListener('session-expiring', handleSessionExpiring as EventListener);

    return () => {
      window.removeEventListener('session-expiring', handleSessionExpiring as EventListener);
    };
  }, []);

  useEffect(() => {
    if (showWarning && timeRemaining > 0) {
      const timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            setShowWarning(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [showWarning, timeRemaining]);

  const handleExtendSession = async () => {
    setIsRefreshing(true);
    try {
      const refreshed = await apiClient.refreshAccessToken();
      if (refreshed) {
        setShowWarning(false);
        setTimeRemaining(180);
      }
    } catch (error) {
      console.error('Failed to extend session:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = async () => {
    await apiClient.logout();
    window.location.href = '/login';
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={showWarning} onOpenChange={setShowWarning}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-warning" />
            <DialogTitle>Session Expiring Soon</DialogTitle>
          </div>
          <DialogDescription>
            Your session will expire in {formatTime(timeRemaining)}. Would you like to continue working?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleLogout}
            disabled={isRefreshing}
            className="flex items-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
          <Button
            onClick={handleExtendSession}
            disabled={isRefreshing}
            className="flex items-center gap-2"
          >
            {isRefreshing ? (
              <>Extending...</>
            ) : (
              <>Continue Working</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
