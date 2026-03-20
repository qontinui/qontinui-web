"use client";

import React, { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Mouse,
  MousePointer2,
  Keyboard,
  ArrowDown,
  Filter,
  X,
  Move,
} from "lucide-react";
import {
  getButtonName,
  type InputEvent,
  type InputEventType,
} from "@/types/capture";

export interface InputEventsSidePanelProps {
  events: InputEvent[];
  currentTimestamp: number;
  onEventClick: (timestamp: number) => void;
}

const EVENT_CONFIG: Record<
  InputEventType,
  {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
  }
> = {
  mouse_move: {
    icon: Move,
    label: "Move",
    color: "text-text-muted",
    bgColor: "bg-surface-canvas",
    borderColor: "border-border-subtle",
  },
  mouse_click: {
    icon: MousePointer2,
    label: "Click",
    color: "text-blue-600",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  mouse_down: {
    icon: MousePointer2,
    label: "Mouse Down",
    color: "text-blue-500",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  mouse_up: {
    icon: MousePointer2,
    label: "Mouse Up",
    color: "text-blue-400",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
  },
  mouse_scroll: {
    icon: ArrowDown,
    label: "Scroll",
    color: "text-orange-600",
    bgColor: "bg-orange-50",
    borderColor: "border-orange-200",
  },
  mouse_drag: {
    icon: Mouse,
    label: "Drag",
    color: "text-purple-600",
    bgColor: "bg-purple-50",
    borderColor: "border-purple-200",
  },
  key_press: {
    icon: Keyboard,
    label: "Key Press",
    color: "text-green-600",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
  },
  key_down: {
    icon: Keyboard,
    label: "Key Down",
    color: "text-green-500",
    bgColor: "bg-green-50",
    borderColor: "border-green-200",
  },
  key_up: {
    icon: Keyboard,
    label: "Key Up",
    color: "text-text-muted",
    bgColor: "bg-surface-canvas",
    borderColor: "border-border-subtle",
  },
};

interface EventItemProps {
  event: InputEvent;
  isActive: boolean;
  onClick: () => void;
}

const EventItem: React.FC<EventItemProps> = ({ event, isActive, onClick }) => {
  const config = EVENT_CONFIG[event.eventType];
  const Icon = config.icon;
  const itemRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active event
  useEffect(() => {
    if (isActive && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [isActive]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
  };

  const eventDetails = (() => {
    switch (event.eventType) {
      case "mouse_click":
      case "mouse_down":
      case "mouse_up":
      case "mouse_drag":
        return (
          <div className="space-y-1">
            {event.button && (
              <div className="text-xs">
                <span className="font-medium">Button:</span>{" "}
                {getButtonName(event.button)}
              </div>
            )}
            {event.x !== undefined && event.y !== undefined && (
              <div className="text-xs">
                <span className="font-medium">Position:</span> ({event.x},{" "}
                {event.y})
              </div>
            )}
          </div>
        );

      case "mouse_move":
        return (
          <div className="space-y-1">
            {event.x !== undefined && event.y !== undefined && (
              <div className="text-xs">
                <span className="font-medium">Position:</span> ({event.x},{" "}
                {event.y})
              </div>
            )}
          </div>
        );

      case "key_press":
      case "key_down":
      case "key_up":
        return (
          <div className="space-y-1">
            {event.key && (
              <div className="text-xs">
                <span className="font-medium">Key:</span>{" "}
                <kbd className="px-2 py-1 bg-surface-raised border border-border-default rounded text-xs font-mono">
                  {event.key}
                </kbd>
              </div>
            )}
            {event.modifiers && event.modifiers.length > 0 && (
              <div className="text-xs">
                <span className="font-medium">Modifiers:</span>{" "}
                {event.modifiers.map((mod, idx) => (
                  <kbd
                    key={idx}
                    className="ml-1 px-2 py-1 bg-surface-raised border border-border-default rounded text-xs font-mono"
                  >
                    {mod}
                  </kbd>
                ))}
              </div>
            )}
          </div>
        );

      case "mouse_scroll":
        return (
          <div className="space-y-1">
            {event.x !== undefined && event.y !== undefined && (
              <div className="text-xs">
                <span className="font-medium">Position:</span> ({event.x},{" "}
                {event.y})
              </div>
            )}
            {(event.scrollDx !== undefined || event.scrollDy !== undefined) && (
              <div className="text-xs">
                <span className="font-medium">Delta:</span> (
                {event.scrollDx || 0}, {event.scrollDy || 0})
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  })();

  return (
    <div
      ref={itemRef}
      role="button"
      tabIndex={0}
      className={`relative p-3 border-l-4 rounded-r cursor-pointer transition-all ${
        config.borderColor
      } ${isActive ? `${config.bgColor} ring-2 ring-blue-500 ring-opacity-50` : "bg-white hover:bg-surface-raised/80"} hover:shadow-md`}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } }}
    >
      {/* Event Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${config.color}`} />
          <span className={`font-semibold text-sm ${config.color}`}>
            {config.label}
          </span>
        </div>
        <span className="text-xs font-mono text-text-muted">
          {formatTime(event.timestamp)}
        </span>
      </div>

      {/* Event Details */}
      {eventDetails}

      {/* Active Indicator */}
      {isActive && (
        <div className="absolute top-1/2 -left-2 transform -translate-y-1/2">
          <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-md" />
        </div>
      )}
    </div>
  );
};

export const InputEventsSidePanel: React.FC<InputEventsSidePanelProps> = ({
  events,
  currentTimestamp,
  onEventClick,
}) => {
  const [filterText, setFilterText] = useState("");
  const [filterEventTypes, setFilterEventTypes] = useState<Set<string>>(
    new Set()
  );

  // Find the current/most recent event based on timestamp
  const getCurrentEventIndex = (): number => {
    // Find the last event that occurred before or at current timestamp
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.timestamp && event.timestamp <= currentTimestamp + 0.5) {
        return i;
      }
    }
    return -1;
  };

  const currentEventIndex = getCurrentEventIndex();

  // Filter events
  const filteredEvents = events.filter((event) => {
    // Filter by type
    if (filterEventTypes.size > 0 && !filterEventTypes.has(event.eventType)) {
      return false;
    }

    // Filter by text
    if (filterText) {
      const searchText = filterText.toLowerCase();
      return (
        event.eventType.toLowerCase().includes(searchText) ||
        event.key?.toLowerCase().includes(searchText) ||
        getButtonName(event.button).toLowerCase().includes(searchText)
      );
    }

    return true;
  });

  const toggleEventTypeFilter = (eventType: string) => {
    const newFilters = new Set(filterEventTypes);
    if (newFilters.has(eventType)) {
      newFilters.delete(eventType);
    } else {
      newFilters.add(eventType);
    }
    setFilterEventTypes(newFilters);
  };

  const clearFilters = () => {
    setFilterText("");
    setFilterEventTypes(new Set());
  };

  const eventTypeCounts = events.reduce(
    (acc, event) => {
      acc[event.eventType] = (acc[event.eventType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <Card className="h-[calc(100vh-12rem)] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg">Input Events</h3>
          <Badge variant="outline">{filteredEvents.length} events</Badge>
        </div>

        {/* Search */}
        <div className="relative">
          <Input
            type="text"
            placeholder="Search events..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="pr-8"
          />
          {filterText && (
            <button
              onClick={() => setFilterText("")}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-text-muted hover:text-text-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Event Type Filters */}
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(eventTypeCounts).map(([eventType, count]) => {
            const config = EVENT_CONFIG[eventType as keyof typeof EVENT_CONFIG];
            const isActive = filterEventTypes.has(eventType);
            return (
              <Badge
                key={eventType}
                variant={isActive ? "default" : "outline"}
                className={`cursor-pointer transition-colors ${
                  isActive ? config.bgColor + " " + config.color : ""
                }`}
                onClick={() => toggleEventTypeFilter(eventType)}
              >
                {config.label} ({count})
              </Badge>
            );
          })}
        </div>

        {/* Clear Filters */}
        {(filterText || filterEventTypes.size > 0) && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3 w-3 mr-1" />
              Clear Filters
            </Button>
          </div>
        )}
      </div>

      {/* Events List */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {filteredEvents.length === 0 ? (
            <div className="text-center text-text-muted text-sm py-8">
              {events.length === 0
                ? "No events recorded"
                : "No events match your filters"}
            </div>
          ) : (
            filteredEvents.map((event, index) => {
              // Find the actual index in the full events array
              const actualIndex = events.indexOf(event);
              return (
                <EventItem
                  key={`${event.timestamp}-${index}`}
                  event={event}
                  isActive={actualIndex === currentEventIndex}
                  onClick={() => onEventClick(event.timestamp)}
                />
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t bg-surface-canvas">
        <div className="text-xs text-text-muted">
          <div className="flex items-center gap-2 mb-2">
            <Filter className="h-3 w-3" />
            <span className="font-medium">Legend</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {Object.entries(EVENT_CONFIG).map(([type, config]) => {
              const Icon = config.icon;
              return (
                <div key={type} className="flex items-center gap-1">
                  <Icon className={`h-3 w-3 ${config.color}`} />
                  <span>{config.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
};
