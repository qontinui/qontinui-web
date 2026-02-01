/**
 * CollaboratorCursors Component
 *
 * Renders colored cursors for other connected users collaborating on annotations.
 * Shows:
 * - Animated cursor icons in user-specific colors
 * - Username labels near cursors
 * - Smooth position transitions
 */

"use client";

import React, { useMemo } from "react";
import type { Collaborator } from "@/hooks/useAnnotationSync";

// ============================================================================
// Types
// ============================================================================

export interface CollaboratorCursorsProps {
  /** List of collaborators with their cursor positions */
  collaborators: Collaborator[];
  /** Current user ID to exclude from rendering */
  currentUserId?: string;
  /** Zoom level for scaling cursor positions */
  zoom?: number;
  /** Pan offset for adjusting cursor positions */
  pan?: { x: number; y: number };
  /** Viewport ID to filter cursors (only show cursors from same viewport) */
  viewportId?: string;
  /** Whether to show username labels */
  showLabels?: boolean;
  /** Custom cursor size in pixels */
  cursorSize?: number;
}

// ============================================================================
// Cursor SVG Component
// ============================================================================

interface CursorIconProps {
  color: string;
  size: number;
}

function CursorIcon({ color, size }: CursorIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
    >
      {/* Cursor arrow */}
      <path
        d="M5.65685 5L5.65685 19.1421L10.3137 14.4853H17.3848L5.65685 5Z"
        fill={color}
        stroke="white"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ============================================================================
// Individual Cursor Component
// ============================================================================

interface CollaboratorCursorProps {
  collaborator: Collaborator;
  zoom: number;
  pan: { x: number; y: number };
  showLabel: boolean;
  cursorSize: number;
}

function CollaboratorCursor({
  collaborator,
  zoom,
  pan,
  showLabel,
  cursorSize,
}: CollaboratorCursorProps) {
  const { cursor, name, color } = collaborator;

  // Get display name (first name or email prefix) - must be called before early return
  const displayName = useMemo(() => {
    if (name) {
      const firstName = name.split(" ")[0];
      return firstName || name;
    }
    return collaborator.email.split("@")[0] || "User";
  }, [name, collaborator.email]);

  if (!cursor) {
    return null;
  }

  // Calculate screen position from canvas coordinates
  const screenX = cursor.x * zoom + pan.x;
  const screenY = cursor.y * zoom + pan.y;

  return (
    <div
      className="collaborator-cursor"
      style={{
        position: "absolute",
        left: screenX,
        top: screenY,
        pointerEvents: "none",
        zIndex: 1000,
        transition: "left 50ms linear, top 50ms linear",
        willChange: "left, top",
      }}
    >
      {/* Cursor icon */}
      <CursorIcon color={color} size={cursorSize} />

      {/* Name label */}
      {showLabel && (
        <div
          className="cursor-label"
          style={{
            position: "absolute",
            left: cursorSize - 4,
            top: cursorSize - 4,
            backgroundColor: color,
            color: "white",
            fontSize: "11px",
            fontWeight: 500,
            padding: "2px 6px",
            borderRadius: "4px",
            whiteSpace: "nowrap",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            maxWidth: "120px",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {displayName}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CollaboratorCursors({
  collaborators,
  currentUserId,
  zoom = 1,
  pan = { x: 0, y: 0 },
  viewportId,
  showLabels = true,
  cursorSize = 20,
}: CollaboratorCursorsProps) {
  // Filter out current user and collaborators without cursor positions
  // Also filter by viewport if specified
  const visibleCollaborators = useMemo(() => {
    return collaborators.filter((c) => {
      // Exclude current user
      if (currentUserId && c.id === currentUserId) {
        return false;
      }
      // Must have cursor position
      if (!c.cursor) {
        return false;
      }
      // Filter by viewport if specified
      if (viewportId && c.cursor.viewport_id && c.cursor.viewport_id !== viewportId) {
        return false;
      }
      return true;
    });
  }, [collaborators, currentUserId, viewportId]);

  if (visibleCollaborators.length === 0) {
    return null;
  }

  return (
    <div
      className="collaborator-cursors-container"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 999,
      }}
    >
      {visibleCollaborators.map((collaborator) => (
        <CollaboratorCursor
          key={collaborator.id}
          collaborator={collaborator}
          zoom={zoom}
          pan={pan}
          showLabel={showLabels}
          cursorSize={cursorSize}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Collaborator Indicator (for sidebar/header display)
// ============================================================================

export interface CollaboratorIndicatorProps {
  /** List of active collaborators */
  collaborators: Collaborator[];
  /** Current user ID to exclude */
  currentUserId?: string;
  /** Maximum number of avatars to show */
  maxVisible?: number;
  /** Size of avatar circles */
  avatarSize?: number;
}

export function CollaboratorIndicator({
  collaborators,
  currentUserId,
  maxVisible = 4,
  avatarSize = 28,
}: CollaboratorIndicatorProps) {
  const otherCollaborators = useMemo(() => {
    return collaborators.filter((c) => !currentUserId || c.id !== currentUserId);
  }, [collaborators, currentUserId]);

  if (otherCollaborators.length === 0) {
    return null;
  }

  const visible = otherCollaborators.slice(0, maxVisible);
  const remaining = otherCollaborators.length - maxVisible;

  return (
    <div
      className="collaborator-indicator"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
      }}
    >
      {/* Avatar stack */}
      <div
        style={{
          display: "flex",
          flexDirection: "row-reverse",
        }}
      >
        {visible.map((collaborator, index) => {
          const initials = getInitials(collaborator.name || collaborator.email);
          return (
            <div
              key={collaborator.id}
              title={collaborator.name || collaborator.email}
              style={{
                width: avatarSize,
                height: avatarSize,
                borderRadius: "50%",
                backgroundColor: collaborator.color,
                color: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: avatarSize * 0.4,
                fontWeight: 600,
                border: "2px solid white",
                marginLeft: index > 0 ? -avatarSize * 0.3 : 0,
                boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                cursor: "default",
              }}
            >
              {initials}
            </div>
          );
        })}
      </div>

      {/* Remaining count */}
      {remaining > 0 && (
        <span
          style={{
            fontSize: "12px",
            color: "#6b7280",
            marginLeft: "4px",
          }}
        >
          +{remaining}
        </span>
      )}

      {/* Status text */}
      <span
        style={{
          fontSize: "12px",
          color: "#6b7280",
          marginLeft: "8px",
        }}
      >
        {otherCollaborators.length === 1 ? "1 collaborator" : `${otherCollaborators.length} collaborators`}
      </span>
    </div>
  );
}

// ============================================================================
// Selection Highlight Component
// ============================================================================

export interface CollaboratorSelectionsProps {
  /** List of collaborators with their selections */
  collaborators: Collaborator[];
  /** Current user ID to exclude */
  currentUserId?: string;
  /** Map of element ID to bounding box for positioning highlights */
  elementBounds: Map<string, { x: number; y: number; width: number; height: number }>;
  /** Zoom level */
  zoom?: number;
  /** Pan offset */
  pan?: { x: number; y: number };
}

export function CollaboratorSelections({
  collaborators,
  currentUserId,
  elementBounds,
  zoom = 1,
  pan = { x: 0, y: 0 },
}: CollaboratorSelectionsProps) {
  // Get all selections from other collaborators
  const selections = useMemo(() => {
    const result: Array<{
      collaborator: Collaborator;
      elementId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }> = [];

    for (const collaborator of collaborators) {
      if (currentUserId && collaborator.id === currentUserId) {
        continue;
      }
      for (const elementId of collaborator.selection) {
        const bounds = elementBounds.get(elementId);
        if (bounds) {
          result.push({ collaborator, elementId, bounds });
        }
      }
    }

    return result;
  }, [collaborators, currentUserId, elementBounds]);

  if (selections.length === 0) {
    return null;
  }

  return (
    <div
      className="collaborator-selections-container"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "hidden",
        zIndex: 998,
      }}
    >
      {selections.map(({ collaborator, elementId, bounds }) => {
        const screenX = bounds.x * zoom + pan.x;
        const screenY = bounds.y * zoom + pan.y;
        const screenWidth = bounds.width * zoom;
        const screenHeight = bounds.height * zoom;

        return (
          <div
            key={`${collaborator.id}-${elementId}`}
            style={{
              position: "absolute",
              left: screenX - 2,
              top: screenY - 2,
              width: screenWidth + 4,
              height: screenHeight + 4,
              border: `2px solid ${collaborator.color}`,
              borderRadius: "4px",
              backgroundColor: `${collaborator.color}15`,
              pointerEvents: "none",
            }}
          >
            {/* Small badge showing who selected it */}
            <div
              style={{
                position: "absolute",
                top: -16,
                left: 0,
                backgroundColor: collaborator.color,
                color: "white",
                fontSize: "10px",
                padding: "1px 4px",
                borderRadius: "2px",
                whiteSpace: "nowrap",
              }}
            >
              {getInitials(collaborator.name || collaborator.email)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Utility Functions
// ============================================================================

function getInitials(nameOrEmail: string): string {
  if (!nameOrEmail) return "?";

  // If it looks like an email, use the part before @
  if (nameOrEmail.includes("@")) {
    const username = nameOrEmail.split("@")[0] || "";
    return username.charAt(0).toUpperCase();
  }

  // For names, get initials of first and last name
  const parts = nameOrEmail.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
  }

  return nameOrEmail.charAt(0).toUpperCase();
}

export default CollaboratorCursors;
