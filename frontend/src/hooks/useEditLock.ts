/**
 * useEditLock Hook
 *
 * React hook for edit locking functionality including:
 * - Acquiring and releasing locks
 * - Auto-refresh mechanism
 * - Lock status checking
 * - Automatic cleanup
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { Lock, ResourceType } from "@/types/collaboration";
import { lockService } from "@/services/lock-service";
import { websocketCollaborationService } from "@/services/websocket-collaboration-service";

// ============================================================================
// Hook Return Type
// ============================================================================

interface UseEditLockReturn {
  // State
  lock: Lock | null;
  isLocked: boolean;
  lockedByMe: boolean;
  lockedByOther: boolean;
  loading: boolean;
  error: Error | null;

  // Methods
  acquireLock: () => Promise<void>;
  releaseLock: () => Promise<void>;
  checkLockStatus: () => Promise<void>;
  forceRelease: () => Promise<void>;
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useEditLock(
  projectId: string,
  resourceType: ResourceType,
  resourceId: string,
  autoAcquire: boolean = false
): UseEditLockReturn {
  const [lock, setLock] = useState<Lock | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lockedByMe, setLockedByMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true);

  /**
   * Check lock status on mount and when dependencies change
   */
  useEffect(() => {
    checkLockStatus();

    if (autoAcquire) {
      acquireLock();
    }
  }, [projectId, resourceType, resourceId]);

  /**
   * Setup WebSocket listeners for lock updates
   */
  useEffect(() => {
    const unsubscribeLockAcquired =
      websocketCollaborationService.onLockAcquired((acquiredLock) => {
        if (
          acquiredLock.project_id === projectId &&
          acquiredLock.resource_type === resourceType &&
          acquiredLock.resource_id === resourceId
        ) {
          setLock(acquiredLock);
          setIsLocked(true);
        }
      });

    const unsubscribeLockReleased =
      websocketCollaborationService.onLockReleased((releasedLock) => {
        if (
          releasedLock.project_id === projectId &&
          releasedLock.resource_type === resourceType &&
          releasedLock.resource_id === resourceId
        ) {
          setLock(null);
          setIsLocked(false);
          setLockedByMe(false);
        }
      });

    return () => {
      unsubscribeLockAcquired();
      unsubscribeLockReleased();
    };
  }, [projectId, resourceType, resourceId]);

  /**
   * Auto-release lock on unmount
   */
  useEffect(() => {
    isMounted.current = true;

    return () => {
      isMounted.current = false;

      if (lockedByMe && lock) {
        // Release lock when component unmounts
        lockService.releaseLock(lock.id).catch((err) => {
          console.error(
            "[useEditLock] Failed to release lock on unmount:",
            err
          );
        });
      }
    };
  }, [lockedByMe, lock]);

  /**
   * Check current lock status
   */
  const checkLockStatus = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const status = await lockService.getLockStatus(
        projectId,
        resourceType,
        resourceId
      );

      if (isMounted.current) {
        setIsLocked(status.is_locked);
        setLockedByMe(status.locked_by_me);
        setLock(status.lock || null);
      }
    } catch (err) {
      console.error("[useEditLock] Failed to check lock status:", err);
      if (isMounted.current) {
        setError(err as Error);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [projectId, resourceType, resourceId]);

  /**
   * Acquire a lock on the resource
   */
  const acquireLock = useCallback(async () => {
    if (lockedByMe) {
      console.warn("[useEditLock] Lock already acquired");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newLock = await lockService.acquireLock(
        projectId,
        resourceType,
        resourceId,
        true // Enable auto-refresh
      );

      if (isMounted.current) {
        setLock(newLock);
        setIsLocked(true);
        setLockedByMe(true);
      }
    } catch (err) {
      console.error("[useEditLock] Failed to acquire lock:", err);
      if (isMounted.current) {
        setError(err as Error);
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [projectId, resourceType, resourceId, lockedByMe]);

  /**
   * Release the lock
   */
  const releaseLock = useCallback(async () => {
    if (!lock || !lockedByMe) {
      console.warn("[useEditLock] No lock to release");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await lockService.releaseLock(lock.id);

      if (isMounted.current) {
        setLock(null);
        setIsLocked(false);
        setLockedByMe(false);
      }
    } catch (err) {
      console.error("[useEditLock] Failed to release lock:", err);
      if (isMounted.current) {
        setError(err as Error);
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [lock, lockedByMe]);

  /**
   * Force release a lock (admin only)
   */
  const forceRelease = useCallback(async () => {
    if (!lock) {
      console.warn("[useEditLock] No lock to force release");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await lockService.forceReleaseLock(lock.id);

      if (isMounted.current) {
        setLock(null);
        setIsLocked(false);
        setLockedByMe(false);
      }
    } catch (err) {
      console.error("[useEditLock] Failed to force release lock:", err);
      if (isMounted.current) {
        setError(err as Error);
      }
      throw err;
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [lock]);

  // Computed properties
  const lockedByOther = isLocked && !lockedByMe;

  return {
    lock,
    isLocked,
    lockedByMe,
    lockedByOther,
    loading,
    error,
    acquireLock,
    releaseLock,
    checkLockStatus,
    forceRelease,
  };
}
