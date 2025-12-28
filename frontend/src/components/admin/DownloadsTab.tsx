"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export default function DownloadsTab() {
  const [analytics, setAnalytics] = useState<DownloadAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState("30");

  useEffect(() => {
    loadAnalytics();
  }, [days]);

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
      const url = apiUrl + "/api/v1/admin/download-analytics?days=" + days;

      const response = await httpClient.fetch(url);

      if (response.ok) {
        const data = await response.json();
        setAnalytics(data);
        setError(null);
      } else {
        setError("Failed to load download analytics: " + response.status);
        toast.error("Failed to load download analytics");
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError("Failed to load download analytics: " + errorMsg);
      toast.error("Failed to load download analytics");
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getCountryFlag = (countryCode: string) => {
    if (!countryCode || countryCode === "Unknown" || countryCode.length !== 2) {
      return "";
    }
    const codePoints = countryCode
      .toUpperCase()
      .split("")
      .map((char) => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };

  const getPlatformDisplay = (platform: string) => {
    switch (platform?.toLowerCase()) {
      case "windows":
        return "Windows";
      case "macos":
        return "macOS";
      case "linux":
        return "Linux";
      default:
        return platform || "Unknown";
    }
  };

  if (loading) {
    return (
      <div className="text-center text-muted-foreground">
        Loading download analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-red-500 space-y-2">
        <div>Error loading download analytics</div>
        <div className="text-sm text-muted-foreground">{error}</div>
      </div>
    );
  }

  if (!analytics || analytics.total_downloads === 0) {
    return (
      <div className="text-center">
        <Card className="bg-card border-border">
          <CardContent className="p-8">
            <Download className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">No Downloads Yet</h3>
            <p className="text-muted-foreground">
              Download analytics will appear here once users start downloading
              the Qontinui Runner.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">Runner Downloads</h3>
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="365">Last year</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Downloads
            </CardTitle>
            <Download className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.total_downloads}
            </div>
            <p className="text-xs text-muted-foreground">
              Last {analytics.period_days} days
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Unique Downloads
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {analytics.unique_downloads}
            </div>
            <p className="text-xs text-muted-foreground">Unique IP addresses</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Country</CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {getCountryFlag(analytics.downloads_by_country[0]?.name ?? "")}{" "}
              {analytics.downloads_by_country[0]?.name || "N/A"}
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics.downloads_by_country[0]?.count || 0} downloads
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Top Platform</CardTitle>
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {getPlatformDisplay(
                analytics.downloads_by_platform[0]?.name ?? ""
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {analytics.downloads_by_platform[0]?.count || 0} downloads
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Downloads by Country
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics.downloads_by_country.slice(0, 10).map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getCountryFlag(item.name)}</span>
                    <span className="font-medium">{item.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{
                          width:
                            (item.count / analytics.total_downloads) * 100 +
                            "%",
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-8 text-right">
                      {item.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Downloads by Platform
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analytics.downloads_by_platform.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between"
                >
                  <span className="font-medium">
                    {getPlatformDisplay(item.name)}
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-24 bg-muted rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{
                          width:
                            (item.count / analytics.total_downloads) * 100 +
                            "%",
                        }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground w-8 text-right">
                      {item.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Recent Downloads</CardTitle>
          <CardDescription>Last 20 download events</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analytics.recent_downloads.map((download, index) => (
                <TableRow key={index}>
                  <TableCell className="text-sm">
                    {download.timestamp
                      ? formatTimestamp(download.timestamp)
                      : "N/A"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{getCountryFlag(download.country_code)}</span>
                      <div>
                        <div className="font-medium">
                          {download.country_name ||
                            download.country_code ||
                            "Unknown"}
                        </div>
                        {download.city && (
                          <div className="text-xs text-muted-foreground">
                            {download.city}
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>{getPlatformDisplay(download.platform)}</TableCell>
                  <TableCell>{download.utm_source || "Direct"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
