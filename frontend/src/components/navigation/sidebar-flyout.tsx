"use client";

import React, { useRef, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface FlyoutChild {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  route: string;
  color?: string;
  badge?: "beta" | "experimental";
}

interface SidebarFlyoutProps {
  parentLabel: string;
  parentColor: string;
  items: FlyoutChild[];
  onNavigate: (route: string) => void;
  onClose: () => void;
  activeRoute?: string;
}

export function SidebarFlyout({
  parentLabel,
  parentColor,
  items,
  onNavigate,
  onClose,
  activeRoute,
}: SidebarFlyoutProps) {
  const [mounted, setMounted] = useState(false);
  const flyoutRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        flyoutRef.current &&
        !flyoutRef.current.contains(event.target as Node)
      ) {
        // Check if click is inside the sidebar
        const sidebar = document.querySelector('[data-sidebar="true"]');
        if (sidebar && sidebar.contains(event.target as Node)) {
          return; // Don't close if clicking inside sidebar
        }
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const getBadgeStyles = (badge?: string) => {
    if (badge === "beta") {
      return "bg-amber-500/20 text-amber-400 border border-amber-500/30";
    }
    if (badge === "experimental") {
      return "bg-purple-500/20 text-purple-400 border border-purple-500/30";
    }
    return "";
  };

  const isChildActive = (route: string): boolean => {
    if (!activeRoute) return false;
    const basePath = route.split("?")[0] ?? route;
    // Use exact match for base paths to prevent /automation-builder from matching /automation-builder/states
    // Only use startsWith if the route has a trailing segment indicator or query params
    return activeRoute === basePath || activeRoute.startsWith(basePath + "?");
  };

  if (!mounted) {
    return null;
  }

  // Header height: logo (64px) + org switcher (~56px) + project switcher (~44px) + nav padding (16px) = ~180px
  const headerHeight = 180;

  const flyoutContent = (
    <div
      ref={flyoutRef}
      className="fixed bg-[#0A0A0B] border-r border-border-subtle/50 shadow-2xl flex flex-col animate-in slide-in-from-left-2 duration-200"
      style={{
        top: headerHeight,
        left: "256px", // sidebar width (w-64)
        width: "280px",
        height: `calc(100vh - ${headerHeight}px)`,
        zIndex: 49, // Just below the sidebar
      }}
    >
      {/* Header */}
      <div
        className="h-12 border-b border-border-subtle/50 flex items-center justify-between px-4"
        style={{
          background: `linear-gradient(135deg, ${parentColor}10 0%, transparent 100%)`,
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-1 h-6 rounded-full"
            style={{ backgroundColor: parentColor }}
          />
          <h2 className="text-lg font-semibold text-text-primary">
            {parentLabel}
          </h2>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-surface-raised transition-colors text-text-muted hover:text-text-secondary"
        >
          <X size={18} />
        </button>
      </div>

      {/* Menu Items */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
        {items.map((child, index) => {
          const isActive = isChildActive(child.route);

          return (
            <button
              key={child.id}
              onClick={() => {
                onNavigate(child.route);
                onClose();
              }}
              className={cn(
                "w-full p-3 rounded-lg flex items-start gap-3 transition-all duration-200 text-left group animate-in fade-in slide-in-from-left-2",
                isActive ? "bg-surface-raised/80" : "hover:bg-surface-raised/50"
              )}
              style={{
                animationDelay: `${index * 30}ms`,
                animationFillMode: "backwards",
              }}
            >
              {/* Icon */}
              <div
                className={cn(
                  "flex-shrink-0 p-2 rounded-lg transition-all duration-200",
                  isActive
                    ? "bg-surface-raised/50"
                    : "bg-surface-raised/50 group-hover:bg-surface-raised/50"
                )}
                style={{
                  color: child.color || parentColor,
                }}
              >
                {child.icon}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "font-medium truncate",
                      isActive
                        ? "text-text-primary"
                        : "text-text-secondary group-hover:text-text-primary"
                    )}
                  >
                    {child.label}
                  </span>
                  {child.badge && (
                    <span
                      className={cn(
                        "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded",
                        getBadgeStyles(child.badge)
                      )}
                    >
                      {child.badge}
                    </span>
                  )}
                </div>
                {child.description && (
                  <p className="text-xs text-text-muted mt-0.5 line-clamp-2 group-hover:text-text-muted transition-colors">
                    {child.description}
                  </p>
                )}
              </div>

              {/* Active indicator */}
              {isActive && (
                <div
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full mt-2"
                  style={{ backgroundColor: parentColor }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom gradient */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
        style={{
          background: `linear-gradient(to top, ${parentColor}08, transparent)`,
        }}
      />
    </div>
  );

  return createPortal(flyoutContent, document.body);
}
