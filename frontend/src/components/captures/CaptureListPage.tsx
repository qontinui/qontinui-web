"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Video,
  Eye,
  Trash2,
  Clock,
  CheckCircle,
  Loader2,
  Search,
  Monitor,
  MousePointer,
  Keyboard,
} from "lucide-react";
import { captureService } from "@/services/service-factory";
import type { CaptureSession } from "@/types/capture";
import { formatDistanceToNow } from "date-fns";

export function CaptureListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { projectId: contextProjectId } = useAutomation();

  // Get project ID from context or URL
  const urlProjectId = searchParams?.get("project") ?? null;
  const projectId = contextProjectId || urlProjectId;

  const [captures, setCaptures] = useState<CaptureSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Load captures
  const loadCaptures = async () => {
    if (!projectId) return;

    try {
      setLoading(true);
      const response = await captureService.getSessionsForProject(projectId);
      setCaptures(response.sessions);
    } catch (error: unknown) {
      console.error("Failed to load captures:", error);
      toast.error("Failed to load captures");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCaptures();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadCaptures is intentionally not in deps to avoid re-creating effect on every render
  }, [projectId]);

  // Filter captures by search query
  const filteredCaptures = captures.filter(
    (capture) =>
      capture.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      capture.sessionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      capture.notes?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      capture.tags.some((tag) =>
        tag.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

  const handleDelete = async (sessionId: string) => {
    if (!confirm("Are you sure you want to delete this capture session?")) {
      return;
    }

    try {
      await captureService.deleteSession(sessionId);
      toast.success("Capture session deleted");
      loadCaptures();
    } catch (error: unknown) {
      console.error("Failed to delete capture:", error);
      toast.error("Failed to delete capture session");
    }
  };

  const formatCaptureDate = (dateString: string) => {
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return dateString;
    }
  };

  const formatDurationDisplay = (seconds: number) => {
    if (!isFinite(seconds) || seconds <= 0) return "0s";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins > 0) {
      return `${mins}m ${secs}s`;
    }
    return `${secs}s`;
  };

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Capture Sessions</h1>
          <p className="text-muted-foreground mt-2">
            View and manage captured interaction sessions from the desktop
            runner
          </p>
        </div>
      </div>

      {/* Search */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search captures by name, ID, or tags..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Capture List */}
      {loading ? (
        <div className="flex justify-center items-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredCaptures.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Video className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              No capture sessions found
            </h3>
            <p className="text-muted-foreground mb-4">
              {searchQuery
                ? "Try adjusting your search"
                : "Capture sessions will appear here when you record interactions using the desktop runner"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredCaptures.map((capture) => (
            <Card
              key={capture.sessionId}
              className="hover:shadow-lg transition-shadow"
            >
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {capture.isComplete ? (
                        <CheckCircle className="h-5 w-5 text-green-600" />
                      ) : (
                        <Clock className="h-5 w-5 text-yellow-600" />
                      )}
                      <CardTitle className="text-xl">{capture.name}</CardTitle>
                      <Badge
                        className={
                          capture.isComplete
                            ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100"
                            : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100"
                        }
                      >
                        {capture.isComplete ? "Complete" : "In Progress"}
                      </Badge>
                    </div>
                    {capture.notes && (
                      <CardDescription>{capture.notes}</CardDescription>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        router.push(`/captures/${capture.sessionId}`)
                      }
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(capture.sessionId)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground">Duration</p>
                      <p className="text-lg font-semibold">
                        {formatDurationDisplay(capture.duration)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Resolution
                      </p>
                      <p className="text-lg font-semibold flex items-center gap-1">
                        <Monitor className="h-4 w-4" />
                        {capture.videoWidth}x{capture.videoHeight}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Events</p>
                      <p className="text-lg font-semibold">
                        {capture.stats.totalEvents}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Clicks</p>
                      <p className="text-lg font-semibold flex items-center gap-1">
                        <MousePointer className="h-4 w-4" />
                        {capture.stats.mouseClicks}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Key Presses
                      </p>
                      <p className="text-lg font-semibold flex items-center gap-1">
                        <Keyboard className="h-4 w-4" />
                        {capture.stats.keyPresses}
                      </p>
                    </div>
                  </div>

                  {/* Tags */}
                  {capture.tags.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {capture.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Timestamp */}
                  <p className="text-xs text-muted-foreground">
                    Captured {formatCaptureDate(capture.createdAt)}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
