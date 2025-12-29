"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface PopoverChild {
  id: string;
  label: string;
  icon: React.ReactNode;
  route: string;
  color?: string;
}

interface CollapsedMenuPopoverProps {
  parentId: string;
  parentColor: string;
  items: PopoverChild[];
  onNavigate: (route: string) => void;
  onClose: () => void;
  onClearTimer?: () => void;
}

export function CollapsedMenuPopover({
  parentId,
  parentColor,
  items,
  onNavigate,
  onClose,
  onClearTimer,
}: CollapsedMenuPopoverProps) {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    // Find the parent button in the DOM
    const parentButton = document.querySelector(
      `[data-nav-id="${parentId}"]`
    ) as HTMLElement;
    if (parentButton) {
      const rect = parentButton.getBoundingClientRect();
      const parentZIndex = window.getComputedStyle(
        parentButton.parentElement!
      ).zIndex;
      setPosition({
        top: rect.top + rect.height / 2,
        left: rect.right + 8, // 8px margin
      });
      console.log("[POPOVER POSITION]", {
        parentId,
        rect,
        position: { top: rect.top + rect.height / 2, left: rect.right + 8 },
        parentZIndex,
        popoverZIndex: "9999999 (bridge: 9999998)",
        renderingViaPortal: true,
        usingInlineStyles: true,
      });

      // After a short delay, check if the popover is actually in the DOM
      setTimeout(() => {
        const popoverElements = document.querySelectorAll(
          '[data-popover="true"]'
        );
        console.log("[POPOVER DOM CHECK]", {
          parentId,
          popoverCount: popoverElements.length,
          popovers: Array.from(popoverElements).map((el) => {
            const computedStyle = window.getComputedStyle(el);
            return {
              parent: el.parentElement?.tagName,
              zIndex: computedStyle.zIndex,
              position: computedStyle.position,
              display: computedStyle.display,
              visibility: computedStyle.visibility,
              top: computedStyle.top,
              left: computedStyle.left,
              boundingRect: el.getBoundingClientRect(),
            };
          }),
        });
      }, 50);
    }
  }, [parentId]);

  if (!mounted) {
    console.log("[POPOVER] Not mounted yet, returning null");
    return null;
  }

  console.log("[POPOVER] Rendering portal content for:", parentId);

  const popoverContent = (
    <>
      {/* Invisible bridge to prevent gap between button and popover */}
      <div
        className="fixed"
        style={{
          top: `${position.top - 30}px`,
          left: `${position.left - 12}px`,
          width: "20px",
          height: "60px",
          pointerEvents: "all",
          zIndex: 2147483646, // One less than popover
        }}
        onMouseEnter={(e) => {
          e.stopPropagation();
          console.log("[BRIDGE] Mouse enter - clearing timer");
          if (onClearTimer) {
            onClearTimer();
          }
        }}
      />

      <div
        className="fixed bg-gray-950 border rounded-lg shadow-xl flex items-center gap-1 p-2"
        data-popover="true"
        style={{
          top: `${position.top}px`,
          left: `${position.left}px`,
          transform: "translateY(-50%)",
          borderColor: parentColor,
          boxShadow: `0 0 20px ${parentColor}40`,
          pointerEvents: "all",
          zIndex: 2147483647, // Maximum safe z-index value
        }}
        onMouseEnter={(e) => {
          e.stopPropagation();
          console.log("[POPOVER] Mouse enter - clearing timer");
          // Clear any pending close timer when mouse enters popover
          if (onClearTimer) {
            onClearTimer();
          }
        }}
        onMouseLeave={(e) => {
          e.stopPropagation();
          console.log("[POPOVER] Mouse leave - closing immediately");
          onClose();
        }}
      >
        {items.map((child) => {
          const childIconColor =
            parentId === "create" ? parentColor : child.color;

          return (
            <button
              key={child.id}
              onClick={() => {
                onNavigate(child.route);
              }}
              className="p-2 rounded-lg transition-all duration-200 hover:scale-110 hover:bg-gray-900/50"
              style={{
                filter: "drop-shadow(0 0 4px rgba(0,0,0,0.3))",
              }}
              title={child.label}
            >
              <span style={{ color: childIconColor, fontSize: "20px" }}>
                {child.icon}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );

  return createPortal(popoverContent, document.body);
}
