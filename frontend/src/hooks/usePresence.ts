/**
 * usePresence Hook
 *
 * React hook for real-time presence tracking including:
 * - Active users list
 * - User status updates
 * - Cursor positions
 * - Current view tracking
 */

import { useState, useEffect, useCallback } from 'react';
import type {
  UserPresence,
  PresenceStatus,
  CursorPosition,
} from '@/types/collaboration';
import { websocketCollaborationService } from '@/services/websocket-collaboration-service';

// ============================================================================
// Hook Return Type
// ============================================================================

interface UsePresenceReturn {
  // State
  activeUsers: UserPresence[];
  isConnected: boolean;
  myStatus: PresenceStatus;

  // Methods
  updateMyPresence: (status: PresenceStatus, currentView?: string) => void;
  updateMyCursor: (position: CursorPosition) => void;
  getUserByColor: (userId: string) => string;
}

// ============================================================================
// User Color Assignment
// ============================================================================

const USER_COLORS = [
  '#3B82F6', // blue
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F97316', // orange
];

const userColorMap = new Map<string, string>();
let nextColorIndex = 0;

function assignUserColor(userId: string): string {
  if (!userColorMap.has(userId)) {
    userColorMap.set(userId, USER_COLORS[nextColorIndex % USER_COLORS.length]);
    nextColorIndex++;
  }
  return userColorMap.get(userId)!;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function usePresence(projectId: string): UsePresenceReturn {
  const [activeUsers, setActiveUsers] = useState<UserPresence[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [myStatus, setMyStatus] = useState<PresenceStatus>('active');

  /**
   * Setup WebSocket connection and handlers
   */
  useEffect(() => {
    if (!projectId) return;

    // Configure handlers
    websocketCollaborationService.updateHandlers({
      onConnect: () => {
        setIsConnected(true);
        // Send initial presence
        websocketCollaborationService.sendPresenceUpdate('active');
      },
      onDisconnect: () => {
        setIsConnected(false);
        setActiveUsers([]);
      },
      onPresenceUpdate: (users) => {
        setActiveUsers(users);
      },
    });

    // Connect to WebSocket
    websocketCollaborationService.connect(projectId);

    // Cleanup
    return () => {
      websocketCollaborationService.disconnect();
    };
  }, [projectId]);

  /**
   * Handle visibility change (user switches tabs)
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        updateMyPresence('away');
      } else {
        updateMyPresence('active');
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  /**
   * Idle detection (user inactive for 5 minutes)
   */
  useEffect(() => {
    let idleTimeout: NodeJS.Timeout;

    const resetIdleTimer = () => {
      clearTimeout(idleTimeout);

      // Only update to active if not away
      if (!document.hidden && myStatus !== 'active') {
        updateMyPresence('active');
      }

      idleTimeout = setTimeout(() => {
        updateMyPresence('idle');
      }, 5 * 60 * 1000); // 5 minutes
    };

    // Listen for user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    events.forEach((event) => {
      document.addEventListener(event, resetIdleTimer, true);
    });

    resetIdleTimer();

    return () => {
      clearTimeout(idleTimeout);
      events.forEach((event) => {
        document.removeEventListener(event, resetIdleTimer, true);
      });
    };
  }, [myStatus]);

  /**
   * Update my presence status
   */
  const updateMyPresence = useCallback(
    (status: PresenceStatus, currentView?: string) => {
      setMyStatus(status);

      if (isConnected) {
        websocketCollaborationService.sendPresenceUpdate(status, currentView);
      }
    },
    [isConnected]
  );

  /**
   * Update my cursor position
   */
  const updateMyCursor = useCallback(
    (position: CursorPosition) => {
      if (isConnected) {
        websocketCollaborationService.sendCursorMove(position);
      }
    },
    [isConnected]
  );

  /**
   * Get color assigned to a user
   */
  const getUserByColor = useCallback((userId: string): string => {
    return assignUserColor(userId);
  }, []);

  return {
    activeUsers,
    isConnected,
    myStatus,
    updateMyPresence,
    updateMyCursor,
    getUserByColor,
  };
}
