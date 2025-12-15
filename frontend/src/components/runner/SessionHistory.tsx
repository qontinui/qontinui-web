"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Image as ImageIcon,
  FileText,
  ChevronRight,
  Search,
  RefreshCw,
  Calendar,
} from "lucide-react";
import { apiClient } from "@/lib/api-client";
import {
  AutomationSession,
  Screenshot,
  AutomationLog,
} from "@/types/automation";
import { toast } from "sonner";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";

export function SessionHistory() {
  const [sessions, setSessions] = useState<AutomationSession[]>([]);
  const [selectedSession, setSelectedSession] =
    useState<AutomationSession | null>(null);
  const [sessionScreenshots, setSessionScreenshots] = useState<Screenshot[]>(
    []
  );
  const [sessionLogs, setSessionLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadSessions();
  }, [filterStatus]);

  useEffect(() => {
    if (selectedSession) {
      loadSessionDetails(selectedSession.id);
    }
  }, [selectedSession]);

  const loadSessions = async () => {
    try {
      setLoading(true);
      const params: unknown = { limit: 50 };
      if (filterStatus !== "all") {
        params.status = filterStatus;
      }
      const data = await apiClient.listAutomationSessions(params);
      setSessions(data.sessions);
    } catch (error) {
      console.error("Failed to load sessions:", error);
      toast.error("Failed to load session history");
    } finally {
      setLoading(false);
    }
  };

  const loadSessionDetails = async (sessionId: string) => {
    try {
      const [screenshots, logs] = await Promise.all([
        apiClient.listSessionScreenshots(sessionId, { page_size: 100 }),
        apiClient.listSessionLogs(sessionId, { page_size: 100 }),
      ]);
      setSessionScreenshots(screenshots.screenshots);
      setSessionLogs(logs.logs);
    } catch (error) {
      console.error("Failed to load session details:", error);
      toast.error("Failed to load session details");
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusVariant = (status: string) => {
    switch (status) {
      case "completed":
        return "success";
      case "failed":
        return "destructive";
      case "running":
        return "default";
      default:
        return "secondary";
    }
  };

  const filteredSessions = sessions.filter((session) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        session.id.toLowerCase().includes(query) ||
        session.project_id?.toLowerCase().includes(query) ||
        session.runner_hostname?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
      {/* Sessions List */}
      <Card className="lg:col-span-1 flex flex-col">
        <CardHeader>
          <div className="flex items-center justify-between mb-4">
            <CardTitle>Session History</CardTitle>
            <Button size="sm" variant="outline" onClick={loadSessions}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="disconnected">Disconnected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0">
          <ScrollArea className="h-[600px]">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No sessions found</p>
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {filteredSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => setSelectedSession(session)}
                    className={`w-full text-left p-3 rounded-md transition-colors ${
                      selectedSession?.id === session.id
                        ? "bg-primary/10 border border-primary"
                        : "hover:bg-muted/50 border border-transparent"
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(session.status)}
                        <Badge variant={getStatusVariant(session.status)}>
                          {session.status}
                        </Badge>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-mono mb-1 truncate">
                      {session.id.slice(0, 16)}...
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(session.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                    {session.runner_hostname && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {session.runner_hostname}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Session Details */}
      <div className="lg:col-span-2 space-y-4">
        {selectedSession ? (
          <>
            {/* Session Info */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Session Details</CardTitle>
                    <CardDescription className="mt-1 font-mono">
                      {selectedSession.id}
                    </CardDescription>
                  </div>
                  <Badge variant={getStatusVariant(selectedSession.status)}>
                    {selectedSession.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Project ID:</span>
                    <p className="font-medium">
                      {selectedSession.project_id || "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Created:</span>
                    <p className="font-medium">
                      {new Date(selectedSession.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">
                      Runner Version:
                    </span>
                    <p className="font-medium">
                      {selectedSession.runner_version || "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Runner OS:</span>
                    <p className="font-medium">
                      {selectedSession.runner_os || "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Hostname:</span>
                    <p className="font-medium">
                      {selectedSession.runner_hostname || "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Screenshots:</span>
                    <p className="font-medium">{sessionScreenshots.length}</p>
                  </div>
                </div>
                {selectedSession.error_message && (
                  <div className="mt-4 p-3 bg-destructive/10 border border-destructive rounded-md">
                    <p className="text-sm text-destructive font-medium mb-1">
                      Error
                    </p>
                    <p className="text-sm text-destructive">
                      {selectedSession.error_message}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Screenshots */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" />
                  Screenshots ({sessionScreenshots.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sessionScreenshots.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <ImageIcon className="h-12 w-12 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">
                      No screenshots in this session
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      {sessionScreenshots.map((screenshot) => (
                        <div key={screenshot.id} className="space-y-2">
                          <div className="relative aspect-video bg-muted rounded-md overflow-hidden border">
                            <Image
                              src={screenshot.presigned_url ?? ""}
                              alt={screenshot.name}
                              fill
                              className="object-cover"
                            />
                          </div>
                          <div className="text-xs">
                            <p className="font-medium truncate">
                              {screenshot.name}
                            </p>
                            <p className="text-muted-foreground">
                              {new Date(
                                screenshot.created_at
                              ).toLocaleTimeString()}
                            </p>
                            {screenshot.automation_metadata?.state_name && (
                              <Badge variant="outline" className="mt-1 text-xs">
                                {screenshot.automation_metadata.state_name}
                              </Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>

            {/* Logs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Logs ({sessionLogs.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {sessionLogs.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center">
                    <FileText className="h-12 w-12 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">
                      No logs in this session
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2 font-mono text-xs">
                      {sessionLogs.map((log) => (
                        <div
                          key={log.id}
                          className={`p-2 rounded border-l-4 ${
                            log.level === "error" || log.level === "critical"
                              ? "border-l-red-500 bg-red-50 dark:bg-red-950/20"
                              : log.level === "warning"
                                ? "border-l-yellow-500 bg-yellow-50 dark:bg-yellow-950/20"
                                : "border-l-blue-500 bg-blue-50 dark:bg-blue-950/20"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="text-xs">
                              {log.level}
                            </Badge>
                            <span className="text-muted-foreground">
                              {new Date(log.created_at).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="break-words">{log.message}</p>
                          {log.log_data && (
                            <pre className="mt-2 text-xs text-muted-foreground overflow-x-auto">
                              {JSON.stringify(log.log_data, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center py-12">
              <Calendar className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">No Session Selected</p>
              <p className="text-sm text-muted-foreground">
                Select a session from the list to view details
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
