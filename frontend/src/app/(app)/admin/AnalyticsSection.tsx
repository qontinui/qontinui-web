"use client";

import { useEffect, useState } from "react";
import {
  Users,
  TrendingUp,
  Activity,
  Target,
  Calendar,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";

interface AnalyticsData {
  dau: number;
  wau: number;
  mau: number;
  retention_7day: number;
  retention_30day: number;
  avg_session_duration: number;
  new_users_today: number;
  new_users_week: number;
  new_users_month: number;
  active_projects_week: number;
  total_sessions_today: number;
  conversion_rate: number;
}

export default function AnalyticsSection() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await httpClient.fetch(
        `${apiUrl}/api/v1/admin/analytics`
      );
      if (response.ok) {
        setAnalytics(await response.json());
      } else {
        toast.error("Failed to load analytics");
      }
    } catch {
      toast.error("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${Math.round(minutes)}m`;
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading analytics...
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <BarChart3 className="h-8 w-8 mb-2" />
        <span className="text-sm">
          Analytics will appear once there is sufficient usage data.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Active Users strip */}
      <SectionLabel label="Active Users" />
      <div className="grid grid-cols-3 gap-px bg-border">
        <Cell
          icon={<Users className="h-3.5 w-3.5" />}
          label="DAU"
          value={analytics.dau}
          sub="Last 24 hours"
        />
        <Cell
          icon={<Users className="h-3.5 w-3.5" />}
          label="WAU"
          value={analytics.wau}
          sub="Last 7 days"
        />
        <Cell
          icon={<Users className="h-3.5 w-3.5" />}
          label="MAU"
          value={analytics.mau}
          sub="Last 30 days"
        />
      </div>

      {/* User Growth strip */}
      <SectionLabel label="User Growth" />
      <div className="grid grid-cols-3 gap-px bg-border">
        <Cell
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="Today"
          value={analytics.new_users_today}
          sub="Since midnight"
        />
        <Cell
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="This Week"
          value={analytics.new_users_week}
          sub="Last 7 days"
        />
        <Cell
          icon={<TrendingUp className="h-3.5 w-3.5" />}
          label="This Month"
          value={analytics.new_users_month}
          sub="Last 30 days"
        />
      </div>

      {/* Engagement strip */}
      <SectionLabel label="Engagement" />
      <div className="grid grid-cols-3 gap-px bg-border">
        <Cell
          icon={<Activity className="h-3.5 w-3.5" />}
          label="7d Retention"
          value={`${analytics.retention_7day.toFixed(1)}%`}
          sub="Users returning after 7 days"
        />
        <Cell
          icon={<Activity className="h-3.5 w-3.5" />}
          label="30d Retention"
          value={`${analytics.retention_30day.toFixed(1)}%`}
          sub="Users returning after 30 days"
        />
        <Cell
          icon={<Calendar className="h-3.5 w-3.5" />}
          label="Avg Session"
          value={formatDuration(analytics.avg_session_duration)}
          sub="Per session"
        />
      </div>

      {/* Conversion & Activity strip */}
      <SectionLabel label="Conversion & Activity" />
      <div className="grid grid-cols-3 gap-px bg-border">
        <Cell
          icon={<Target className="h-3.5 w-3.5" />}
          label="Conversion"
          value={`${analytics.conversion_rate.toFixed(1)}%`}
          sub="Visitors → Registered"
        />
        <Cell
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Active Projects"
          value={analytics.active_projects_week}
          sub="Modified in last 7 days"
        />
        <Cell
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Sessions Today"
          value={analytics.total_sessions_today}
          sub="Total logins today"
        />
      </div>

      {/* Key Insights */}
      <SectionLabel label="Key Insights" />
      <div className="bg-background px-6 py-3 space-y-2">
        {analytics.retention_7day > 50 && (
          <Insight
            color="bg-green-500"
            title="Strong 7-day retention"
            text="Users are returning within the first week."
          />
        )}
        {analytics.retention_7day < 30 && (
          <Insight
            color="bg-yellow-500"
            title="Low 7-day retention"
            text="Consider improving onboarding or early user experience."
          />
        )}
        {analytics.wau > 0 && analytics.dau / analytics.wau > 0.5 && (
          <Insight
            color="bg-green-500"
            title="High daily engagement"
            text="Users are visiting frequently throughout the week."
          />
        )}
        {analytics.conversion_rate < 5 && (
          <Insight
            color="bg-yellow-500"
            title="Low conversion rate"
            text="Consider optimizing the signup flow or landing page."
          />
        )}
        {analytics.new_users_week > 0 && (
          <Insight
            color="bg-blue-500"
            title="Growing user base"
            text={`${analytics.new_users_week} new users joined this week.`}
          />
        )}
      </div>
    </div>
  );
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="px-6 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
      {label}
    </div>
  );
}

function Cell({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="bg-background px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}

function Insight({
  color,
  title,
  text,
}: {
  color: string;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className={`h-2 w-2 rounded-full ${color} mt-1.5 shrink-0`} />
      <div>
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground"> — {text}</span>
      </div>
    </div>
  );
}
