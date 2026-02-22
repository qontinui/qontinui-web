"use client";

import * as React from "react";
import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { NavItem } from "./types";

export interface NestedSubGroupProps {
  item: NavItem;
  onNavigate: (route: string) => void;
  isRouteActive: (route: string, item: NavItem) => boolean;
  mounted: boolean;
}

export function NestedSubGroup({
  item,
  onNavigate,
  isRouteActive,
  mounted,
}: NestedSubGroupProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isGroupActive = item.children?.some((child) =>
    isRouteActive(child.route, child)
  );

  React.useEffect(() => {
    if (isGroupActive) setIsOpen(true);
  }, [isGroupActive]);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          data-ui-id={`nav-${item.id}`}
          data-route={item.route}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
            isGroupActive
              ? "text-text-primary"
              : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
          )}
        >
          <span style={{ color: isGroupActive ? item.color : undefined }}>
            {item.icon}
          </span>
          <span className="flex-1 font-medium">{item.label}</span>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition-transform duration-200",
              isOpen && "rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down">
        <div className="ml-3 flex flex-col gap-0.5 border-l border-border-subtle pl-3 pt-0.5">
          {item.children?.map((grandchild) => {
            const isActive = isRouteActive(grandchild.route, grandchild);
            return (
              <button
                key={grandchild.id}
                data-ui-id={`nav-${grandchild.id}`}
                data-route={grandchild.route}
                onClick={() => onNavigate(grandchild.route)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                  isActive
                    ? "bg-surface-hover text-text-primary"
                    : "text-text-muted hover:bg-surface-hover hover:text-text-primary"
                )}
              >
                <span
                  style={{ color: isActive ? grandchild.color : undefined }}
                >
                  {grandchild.icon}
                </span>
                <span className="flex-1">{grandchild.label}</span>
                {mounted && grandchild.hidden && (
                  <Badge
                    variant="outline"
                    className="h-3.5 px-1 text-[8px] font-medium border-gray-500/30 bg-gray-500/10 text-gray-400"
                  >
                    hidden
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
