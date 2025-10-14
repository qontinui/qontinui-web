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
import { authService } from '@/services/service-factory';

export function SessionTimeoutWarning() {
  const [showWarning, setShowWarning] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(180); // 3 minutes in seconds
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const handleSessionExpiring = (event: CustomEvent) => {
      const minutes = event.detail?.minutesRemaining || 3;
      console.log('[SessionTimeoutWarning] Session expiring event received:', {
        timestamp: new Date().toISOString(),
        minutesRemaining: minutes,
        secondsRemaining: minutes * 60,
      });

      setTimeRemaining(minutes * 60);
      setShowWarning(true);
      console.log('[SessionTimeoutWarning] Warning dialog displayed');
    };

    console.log('[SessionTimeoutWarning] Registering session-expiring event listener');
    window.addEventListener('session-expiring', handleSessionExpiring as EventListener);

    return () => {
      console.log('[SessionTimeoutWarning] Removing session-expiring event listener');
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
    console.log('[SessionTimeoutWarning] User clicked "Continue Working"');
    setIsRefreshing(true);
    try {
      console.log('[SessionTimeoutWarning] Attempting to refresh access token...');
      const refreshed = await authService.refreshAccessToken();
      console.log('[SessionTimeoutWarning] Token refresh result:', refreshed);

      if (refreshed) {
        console.log('[SessionTimeoutWarning] Session extended successfully, hiding warning dialog');
        setShowWarning(false);
        setTimeRemaining(180);
      } else {
        console.error('[SessionTimeoutWarning] Token refresh returned false');
      }
    } catch (error) {
      console.error('[SessionTimeoutWarning] Failed to extend session:', error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleLogout = async () => {
    console.log('[SessionTimeoutWarning] User clicked "Logout"');
    await authService.logout();
    console.log('[SessionTimeoutWarning] Redirecting to login page');
    window.location.href = '/login';
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog open={showWarning} onOpenChange={setShowWarning} modal={true}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()}>
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
