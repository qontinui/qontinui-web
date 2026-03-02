"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { ViewerTOCItem } from "../types";

interface ViewerSidebarProps {
  workflowName: string;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  toc: ViewerTOCItem[];
  activeSection: string;
  collapsedSections: Set<string>;
  onScrollToSection: (id: string) => void;
  onToggleSection: (id: string) => void;
  firstSectionId: string;
}

function TOCItemRenderer({
  item,
  depth = 0,
  activeSection,
  collapsedSections,
  onScrollToSection,
  onToggleSection,
}: {
  item: ViewerTOCItem;
  depth?: number;
  activeSection: string;
  collapsedSections: Set<string>;
  onScrollToSection: (id: string) => void;
  onToggleSection: (id: string) => void;
}) {
  const hasChildren = item.children.length > 0;
  const isActive = activeSection === item.id;

  return (
    <div>
      <button
        onClick={() => {
          if (hasChildren) {
            onToggleSection(item.id);
          }
          onScrollToSection(item.id);
        }}
        className={cn(
          "w-full flex items-center gap-2 text-left px-2 py-1.5 rounded text-sm transition-colors",
          isActive && "bg-accent font-medium",
          !isActive && "hover:bg-accent/50"
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {hasChildren && (
          <span className="size-4">
            {collapsedSections.has(item.id) ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </span>
        )}
        <span className="flex-1 truncate">{item.text}</span>
      </button>

      {hasChildren && !collapsedSections.has(item.id) && (
        <div>
          {item.children.map((child) => (
            <TOCItemRenderer
              key={child.id}
              item={child}
              depth={depth + 1}
              activeSection={activeSection}
              collapsedSections={collapsedSections}
              onScrollToSection={onScrollToSection}
              onToggleSection={onToggleSection}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ViewerSidebar({
  workflowName,
  searchQuery,
  onSearchChange,
  toc,
  activeSection,
  collapsedSections,
  onScrollToSection,
  onToggleSection,
  firstSectionId,
}: ViewerSidebarProps) {
  return (
    <div className="w-64 border-r flex flex-col bg-muted/20">
      <div className="p-4 border-b space-y-3">
        <div>
          <h3 className="font-semibold">Contents</h3>
          <p className="text-xs text-muted-foreground mt-1">{workflowName}</p>
        </div>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {toc.map((item) => (
            <TOCItemRenderer
              key={item.id}
              item={item}
              activeSection={activeSection}
              collapsedSections={collapsedSections}
              onScrollToSection={onScrollToSection}
              onToggleSection={onToggleSection}
            />
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onScrollToSection(firstSectionId)}
        >
          Back to Top
        </Button>
      </div>
    </div>
  );
}
