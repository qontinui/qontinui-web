import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Edit, Trash2, FileDown, Play, Clock } from "lucide-react";

interface ActivityTimelineProps {
  activities: Array<{
    id: string;
    type: "create" | "update" | "delete" | "export" | "run";
    description: string;
    timestamp: string;
    project_name?: string;
  }>;
}

const getActivityIcon = (type: string) => {
  switch (type) {
    case "create":
      return Plus;
    case "update":
      return Edit;
    case "delete":
      return Trash2;
    case "export":
      return FileDown;
    case "run":
      return Play;
    default:
      return Clock;
  }
};

const getActivityColor = (type: string) => {
  switch (type) {
    case "create":
      return "var(--color-brand-success)";
    case "update":
      return "var(--color-brand-primary)";
    case "delete":
      return "#FF4444";
    case "export":
      return "var(--color-brand-secondary)";
    case "run":
      return "#FFB800";
    default:
      return "#666";
  }
};

const getRelativeTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return "Just now";
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  }
  const days = Math.floor(diffInSeconds / 86400);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
};

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">Recent Activity</CardTitle>
        <p className="text-sm text-text-muted">
          Latest actions in your workspace
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.length > 0 ? (
            activities.map((activity) => {
              const Icon = getActivityIcon(activity.type);
              const color = getActivityColor(activity.type);

              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 pb-4 border-b border-border-subtle/50 last:border-0 last:pb-0"
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: `${color}20` }}
                  >
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-text-secondary line-clamp-2">
                      {activity.description}
                    </p>
                    {activity.project_name && (
                      <p className="text-xs text-brand-primary mt-1">
                        {activity.project_name}
                      </p>
                    )}
                    <p className="text-xs text-text-muted mt-1">
                      {getRelativeTime(activity.timestamp)}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-8 text-text-muted">
              No recent activity
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
