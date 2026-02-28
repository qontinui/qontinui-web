"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, Globe, Monitor, Users } from "lucide-react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";

interface DownloadAnalytics {
  period_days: number;
  total_downloads: number;
  unique_downloads: number;
  downloads_by_country: Array<{ name: string; count: number }>;
  downloads_by_platform: Array<{ name: string; count: number }>;
  downloads_by_browser: Array<{ name: string; count: number }>;
  downloads_by_utm_source: Array<{ name: string; count: number }>;
  daily_trend: Array<{ date: string; count: number }>;
  recent_downloads: Array<{
    timestamp: string;
    platform: string;
    country_code: string;
    country_name: string;
    city: string;
    region: string;
    browser: string;
    os: string;
    version: string;
    utm_source: string;
    utm_medium: string;
    utm_campaign: string;
    referrer: string;
  }>;
}

export default function DownloadsSection() {
  const [analytics, setAnalytics] = useState<DownloadAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("30");

  useEffect(() => {
    loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const response = await httpClient.fetch(
        `${apiUrl}/api/v1/admin/download-analytics?days=${days}`
      );
      if (response.ok) {
        setAnalytics(await response.json());
      } else {
        toast.error("Failed to load download analytics");
      }
    } catch {
      toast.error("Failed to load download analytics");
    } finally {
      setLoading(false);
    }
  };

  const getCountryFlag = (code: string) => {
    if (!code || code === "Unknown" || code.length !== 2) return "";
    const pts = code
      .toUpperCase()
      .split("")
      .map((c) => 127397 + c.charCodeAt(0));
    return String.fromCodePoint(...pts);
  };

  const getPlatformDisplay = (p: string) => {
    switch (p?.toLowerCase()) {
      case "windows":
        return "Windows";
      case "macos":
        return "macOS";
      case "linux":
        return "Linux";
      default:
        return p || "Unknown";
    }
  };

  const formatTimestamp = (ts: string) => {
    return new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
        Loading download analytics...
      </div>
    );
  }

  if (!analytics || analytics.total_downloads === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Download className="h-8 w-8 mb-2" />
        <span className="text-sm">
          Download analytics will appear once users start downloading.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Period selector */}
      <div className="flex items-center justify-between px-6 py-2 border-b border-border bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Runner Downloads
        </span>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="h-7 w-[140px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Metrics strip */}
      <div className="grid grid-cols-4 gap-px bg-border">
        <Cell
          icon={<Download className="h-3.5 w-3.5" />}
          label="Total"
          value={analytics.total_downloads}
          sub={`Last ${analytics.period_days} days`}
        />
        <Cell
          icon={<Users className="h-3.5 w-3.5" />}
          label="Unique"
          value={analytics.unique_downloads}
          sub="Unique IPs"
        />
        <Cell
          icon={<Globe className="h-3.5 w-3.5" />}
          label="Top Country"
          value={`${getCountryFlag(analytics.downloads_by_country[0]?.name ?? "")} ${analytics.downloads_by_country[0]?.name || "N/A"}`}
          sub={`${analytics.downloads_by_country[0]?.count || 0} downloads`}
        />
        <Cell
          icon={<Monitor className="h-3.5 w-3.5" />}
          label="Top Platform"
          value={getPlatformDisplay(
            analytics.downloads_by_platform[0]?.name ?? ""
          )}
          sub={`${analytics.downloads_by_platform[0]?.count || 0} downloads`}
        />
      </div>

      {/* Breakdowns side-by-side */}
      <div className="grid grid-cols-2 gap-px bg-border">
        {/* Country breakdown */}
        <div className="bg-background">
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
            By Country
          </div>
          <div className="divide-y divide-border">
            {analytics.downloads_by_country.slice(0, 10).map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between px-4 py-1.5 text-sm"
              >
                <div className="flex items-center gap-2">
                  <span>{getCountryFlag(item.name)}</span>
                  <span>{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full"
                      style={{
                        width: `${(item.count / analytics.total_downloads) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-6 text-right">
                    {item.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Platform breakdown */}
        <div className="bg-background">
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-border bg-muted/50">
            By Platform
          </div>
          <div className="divide-y divide-border">
            {analytics.downloads_by_platform.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between px-4 py-1.5 text-sm"
              >
                <span>{getPlatformDisplay(item.name)}</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-muted rounded-full h-1.5">
                    <div
                      className="bg-primary h-1.5 rounded-full"
                      style={{
                        width: `${(item.count / analytics.total_downloads) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-6 text-right">
                    {item.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Downloads table */}
      <div className="px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wider border-b border-t border-border bg-muted/50">
        Recent Downloads
      </div>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
            <th className="px-6 py-2 font-medium">Time</th>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 font-medium">Platform</th>
            <th className="px-3 py-2 font-medium">Source</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {analytics.recent_downloads.map((dl, i) => (
            <tr key={i} className="hover:bg-muted/30 transition-colors">
              <td className="px-6 py-2 text-xs text-muted-foreground whitespace-nowrap">
                {dl.timestamp ? formatTimestamp(dl.timestamp) : "N/A"}
              </td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-1.5">
                  <span>{getCountryFlag(dl.country_code)}</span>
                  <span>{dl.country_name || dl.country_code || "Unknown"}</span>
                  {dl.city && (
                    <span className="text-xs text-muted-foreground">
                      ({dl.city})
                    </span>
                  )}
                </div>
              </td>
              <td className="px-3 py-2">{getPlatformDisplay(dl.platform)}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {dl.utm_source || "Direct"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
