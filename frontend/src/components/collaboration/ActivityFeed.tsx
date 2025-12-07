"use client";

import * as React from "react";
import {
  Activity,
  FileEdit,
  FilePlus,
  FileX,
  MessageSquare,
  UserPlus,
  UserMinus,
  Share2,
  GitBranch,
  Filter,
  ChevronDown,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  format,
  formatDistanceToNow,
  isToday,
  isYesterday,
  parseISO,
} from "date-fns";

export type ActivityAction =
  | "created"
  | "updated"
  | "deleted"
  | "commented"
  | "shared"
  | "invited"
  | "removed"
  | "forked";

export type ResourceType =
  | "workflow"
  | "project"
  | "state"
  | "transition"
  | "comment"
  | "user";

export interface ActivityItem {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar?: string;
  action: ActivityAction;
  resource_type: ResourceType;
  resource_id: string;
  resource_name: string;
  description?: string;
  timestamp: Date | string;
  metadata?: Record<string, any>;
}

interface ActivityFeedProps {
  activities: ActivityItem[];
  onLoadMore?: () => Promise<void>;
  hasMore?: boolean;
  loading?: boolean;
  realtime?: boolean;
  onActivityClick?: (activity: ActivityItem) => void;
  className?: string;
}

const actionIcons: Record<ActivityAction, React.ComponentType<any>> = {
  created: FilePlus,
  updated: FileEdit,
  deleted: FileX,
  commented: MessageSquare,
  shared: Share2,
  invited: UserPlus,
  removed: UserMinus,
  forked: GitBranch,
};

const actionColors: Record<ActivityAction, string> = {
  created: "text-green-500",
  updated: "text-blue-500",
  deleted: "text-red-500",
  commented: "text-purple-500",
  shared: "text-cyan-500",
  invited: "text-emerald-500",
  removed: "text-orange-500",
  forked: "text-indigo-500",
};

const actionVerbs: Record<ActivityAction, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  commented: "commented on",
  shared: "shared",
  invited: "invited",
  removed: "removed",
  forked: "forked",
};

export function ActivityFeed({
  activities,
  onLoadMore,
  hasMore = false,
  loading = false,
  realtime = false,
  onActivityClick,
  className,
}: ActivityFeedProps) {
  const [userFilter, setUserFilter] = React.useState<string>("all");
  const [actionFilters, setActionFilters] = React.useState<ActivityAction[]>(
    []
  );
  const [resourceFilters, setResourceFilters] = React.useState<ResourceType[]>(
    []
  );
  const [loadingMore, setLoadingMore] = React.useState(false);

  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatTimestamp = (timestamp: Date | string) => {
    const date =
      typeof timestamp === "string" ? parseISO(timestamp) : timestamp;

    if (isToday(date)) {
      return formatDistanceToNow(date, { addSuffix: true });
    } else if (isYesterday(date)) {
      return `Yesterday at ${format(date, "HH:mm")}`;
    } else {
      return format(date, "MMM d, yyyy HH:mm");
    }
  };

  const getDateGroup = (timestamp: Date | string) => {
    const date =
      typeof timestamp === "string" ? parseISO(timestamp) : timestamp;

    if (isToday(date)) {
      return "Today";
    } else if (isYesterday(date)) {
      return "Yesterday";
    } else {
      return format(date, "MMMM d, yyyy");
    }
  };

  // Filter activities
  const filteredActivities = React.useMemo(() => {
    return activities.filter((activity) => {
      if (userFilter !== "all" && activity.user_id !== userFilter) {
        return false;
      }
      if (
        actionFilters.length > 0 &&
        !actionFilters.includes(activity.action)
      ) {
        return false;
      }
      if (
        resourceFilters.length > 0 &&
        !resourceFilters.includes(activity.resource_type)
      ) {
        return false;
      }
      return true;
    });
  }, [activities, userFilter, actionFilters, resourceFilters]);

  // Group activities by date
  const groupedActivities = React.useMemo(() => {
    const groups: Record<string, ActivityItem[]> = {};
    filteredActivities.forEach((activity) => {
      const dateGroup = getDateGroup(activity.timestamp);
      if (!groups[dateGroup]) {
        groups[dateGroup] = [];
      }
      groups[dateGroup].push(activity);
    });
    return groups;
  }, [filteredActivities]);

  // Get unique users for filter
  const uniqueUsers = React.useMemo(() => {
    const users = new Map<string, { id: string; name: string }>();
    activities.forEach((activity) => {
      if (!users.has(activity.user_id)) {
        users.set(activity.user_id, {
          id: activity.user_id,
          name: activity.user_name,
        });
      }
    });
    return Array.from(users.values());
  }, [activities]);

  const handleLoadMore = async () => {
    if (!onLoadMore || loadingMore) return;
    setLoadingMore(true);
    try {
      await onLoadMore();
    } finally {
      setLoadingMore(false);
    }
  };

  const toggleActionFilter = (action: ActivityAction) => {
    setActionFilters((prev) =>
      prev.includes(action)
        ? prev.filter((a) => a !== action)
        : [...prev, action]
    );
  };

  const toggleResourceFilter = (resource: ResourceType) => {
    setResourceFilters((prev) =>
      prev.includes(resource)
        ? prev.filter((r) => r !== resource)
        : [...prev, resource]
    );
  };

  const hasActiveFilters =
    userFilter !== "all" ||
    actionFilters.length > 0 ||
    resourceFilters.length > 0;

  return (
    <div
      className={cn("flex flex-col bg-background border rounded-lg", className)}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" />
          <span className="text-sm font-medium">Activity Feed</span>
          {realtime && (
            <Badge
              variant="outline"
              className="bg-green-500/10 text-green-500 border-green-500/20"
            >
              <span className="relative flex h-2 w-2 mr-1">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              Live
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* User Filter */}
          {uniqueUsers.length > 1 && (
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger
                className="w-[140px] h-8"
                aria-label="Filter by user"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                {uniqueUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Advanced Filters */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Filter className="mr-2 h-3 w-3" />
                Filters
                {hasActiveFilters && (
                  <Badge variant="secondary" className="ml-2 h-4 px-1 text-xs">
                    {actionFilters.length + resourceFilters.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Action Type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.keys(actionVerbs).map((action) => (
                <DropdownMenuCheckboxItem
                  key={action}
                  checked={actionFilters.includes(action as ActivityAction)}
                  onCheckedChange={() =>
                    toggleActionFilter(action as ActivityAction)
                  }
                >
                  {actionVerbs[action as ActivityAction]}
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Resource Type</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {[
                "workflow",
                "project",
                "state",
                "transition",
                "comment",
                "user",
              ].map((resource) => (
                <DropdownMenuCheckboxItem
                  key={resource}
                  checked={resourceFilters.includes(resource as ResourceType)}
                  onCheckedChange={() =>
                    toggleResourceFilter(resource as ResourceType)
                  }
                >
                  {resource.charAt(0).toUpperCase() + resource.slice(1)}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Activity List */}
      <ScrollArea className="flex-1 max-h-[600px]">
        {loading && filteredActivities.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : filteredActivities.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {hasActiveFilters
              ? "No activities match your filters"
              : "No activity yet"}
          </div>
        ) : (
          <div className="p-3 space-y-6">
            {Object.entries(groupedActivities).map(([dateGroup, items]) => (
              <div key={dateGroup}>
                <div className="sticky top-0 bg-background z-10 py-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    {dateGroup}
                  </h3>
                </div>
                <div className="space-y-3">
                  {items.map((activity) => {
                    const ActionIcon = actionIcons[activity.action];
                    const actionColor = actionColors[activity.action];
                    const verb = actionVerbs[activity.action];

                    return (
                      <div
                        key={activity.id}
                        className={cn(
                          "flex gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors",
                          onActivityClick && "cursor-pointer"
                        )}
                        onClick={() => onActivityClick?.(activity)}
                      >
                        <Avatar
                          src={activity.user_avatar}
                          fallback={
                            <span className="text-xs font-medium">
                              {getInitials(activity.user_name)}
                            </span>
                          }
                          className="h-8 w-8 mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-2">
                            <ActionIcon
                              className={cn("h-4 w-4 mt-0.5", actionColor)}
                            />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm">
                                <span className="font-medium">
                                  {activity.user_name}
                                </span>{" "}
                                <span className="text-muted-foreground">
                                  {verb}
                                </span>{" "}
                                <span className="font-medium">
                                  {activity.resource_name}
                                </span>
                              </p>
                              {activity.description && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  {activity.description}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-muted-foreground">
                                  {formatTimestamp(activity.timestamp)}
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  {activity.resource_type}
                                </Badge>
                              </div>
                            </div>
                            {onActivityClick && (
                              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0 mt-1" />
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Load More */}
      {hasMore && !loading && (
        <div className="p-3 border-t">
          <Button
            variant="outline"
            className="w-full"
            onClick={handleLoadMore}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <ChevronDown className="mr-2 h-4 w-4" />
                Load More
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
