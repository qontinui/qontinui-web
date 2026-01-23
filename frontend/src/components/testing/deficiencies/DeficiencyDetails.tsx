"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertCircle,
  Calendar,
  Tag,
  ExternalLink,
  Copy,
  Share2,
  Download,
} from "lucide-react";
import {
  Deficiency,
  DeficiencyComment,
  DeficiencyActivity,
  SEVERITY_CONFIG,
  STATUS_CONFIG,
} from "@/types/deficiency";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { DeficiencyWorkflow } from "./DeficiencyWorkflow";
import { DeficiencyComments } from "./DeficiencyComments";
import { DeficiencyAssignment } from "./DeficiencyAssignment";
import { ScreenshotGallery } from "./ScreenshotGallery";
import { ReproductionPathViewer } from "./ReproductionPathViewer";

interface DeficiencyDetailsProps {
  deficiency: Deficiency;
  comments?: DeficiencyComment[];
  activities?: DeficiencyActivity[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStatusChange?: (newStatus: unknown) => Promise<void>;
  onAssignmentChange?: (userId: string | null) => Promise<void>;
  onCommentAdd?: (
    content: string,
    mentions: string[],
    attachments: File[]
  ) => Promise<void>;
  onExport?: () => void;
}

/**
 * DeficiencyDetails - Full defect details modal
 *
 * Features:
 * - Comprehensive deficiency information display
 * - Tabbed interface for different aspects (Overview, Workflow, Comments, Activity)
 * - Screenshot gallery integration
 * - Reproduction steps visualization
 * - Assignment and workflow management
 * - Export and share functionality
 * - Keyboard navigation support
 */
export function DeficiencyDetails({
  deficiency,
  comments = [],
  activities = [],
  open,
  onOpenChange,
  onStatusChange,
  onAssignmentChange,
  onCommentAdd,
  onExport,
}: DeficiencyDetailsProps) {
  const [activeTab, setActiveTab] = useState("overview");

  const severityConfig = SEVERITY_CONFIG[deficiency.severity];
  const statusConfig = STATUS_CONFIG[deficiency.status];

  const handleCopyId = () => {
    navigator.clipboard.writeText(deficiency.id);
    toast.success("Deficiency ID copied to clipboard");
  };

  const handleShare = () => {
    const url = `${window.location.origin}/deficiencies/${deficiency.id}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copied to clipboard");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0" data-ui-id="testing-deficiency-details-modal">
        <ScrollArea className="h-full max-h-[90vh]">
          <div className="p-6">
            <DialogHeader className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <DialogTitle className="text-2xl mb-2">
                    {deficiency.title}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <AlertCircle className="h-3 w-3" />
                      ID: {deficiency.id.slice(0, 8)}
                    </span>
                    <span className="text-muted-foreground">•</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="h-3 w-3" />
                      {new Date(deficiency.created_at).toLocaleDateString()}
                    </span>
                  </DialogDescription>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyId}
                    title="Copy ID"
                    data-ui-id="testing-deficiency-details-copy-btn"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleShare}
                    title="Share"
                    data-ui-id="testing-deficiency-details-share-btn"
                  >
                    <Share2 className="h-4 w-4" />
                  </Button>
                  {onExport && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onExport}
                      title="Export"
                      data-ui-id="testing-deficiency-details-export-btn"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {/* Status and Severity Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  className={cn(
                    "border",
                    statusConfig.bgColor,
                    statusConfig.color
                  )}
                >
                  {statusConfig.label}
                </Badge>
                <Badge
                  className={cn(
                    "border",
                    severityConfig.bgColor,
                    severityConfig.color
                  )}
                >
                  {severityConfig.label}
                </Badge>
                <Badge variant="outline">
                  {deficiency.deficiency_type.replace("_", " ")}
                </Badge>
                {deficiency.category && (
                  <Badge variant="outline">
                    <Tag className="h-3 w-3 mr-1" />
                    {deficiency.category}
                  </Badge>
                )}
              </div>
            </DialogHeader>

            <Separator className="my-6" />

            {/* Tabbed Content */}
            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="w-full"
              data-ui-id="testing-deficiency-details-tabs"
            >
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="overview" data-ui-id="testing-deficiency-details-overview-tab">Overview</TabsTrigger>
                <TabsTrigger value="workflow" data-ui-id="testing-deficiency-details-workflow-tab">Workflow</TabsTrigger>
                <TabsTrigger value="comments" data-ui-id="testing-deficiency-details-comments-tab">
                  Comments {comments.length > 0 && `(${comments.length})`}
                </TabsTrigger>
                <TabsTrigger value="activity" data-ui-id="testing-deficiency-details-activity-tab">
                  Activity {activities.length > 0 && `(${activities.length})`}
                </TabsTrigger>
              </TabsList>

              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6 mt-6">
                {/* Description */}
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Description</h3>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {deficiency.description}
                  </p>
                </div>

                {/* Screenshots */}
                {deficiency.screenshot_urls.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Screenshots</h3>
                    <ScreenshotGallery
                      screenshots={deficiency.screenshot_urls}
                    />
                  </div>
                )}

                {/* Reproduction Steps */}
                {deficiency.reproduction_steps.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Reproduction Steps</h3>
                    <ReproductionPathViewer
                      steps={deficiency.reproduction_steps}
                    />
                  </div>
                )}

                {/* Environment Info */}
                {Object.keys(deficiency.environment_info).length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Environment</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {Object.entries(deficiency.environment_info).map(
                        ([key, value]) => (
                          <div
                            key={key}
                            className="flex justify-between p-2 rounded bg-muted/50"
                          >
                            <span className="text-muted-foreground capitalize">
                              {key.replace(/_/g, " ")}:
                            </span>
                            <span className="font-medium">{String(value)}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Metadata */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="space-y-1">
                    <span className="text-muted-foreground">Reproducible</span>
                    <p className="font-medium">
                      {deficiency.reproducible ? "Yes" : "No"}
                      {deficiency.reproduction_rate &&
                        ` (${deficiency.reproduction_rate}%)`}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground">Occurrences</span>
                    <p className="font-medium">{deficiency.occurrence_count}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground">First Seen</span>
                    <p className="font-medium">
                      {new Date(deficiency.first_seen_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-muted-foreground">Last Seen</span>
                    <p className="font-medium">
                      {new Date(deficiency.last_seen_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* External Links */}
                {deficiency.external_ticket_url && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">External Ticket</h3>
                    <a
                      href={deficiency.external_ticket_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:underline"
                    >
                      {deficiency.external_ticket_id}
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                )}

                {/* Tags */}
                {deficiency.tags.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium">Tags</h3>
                    <div className="flex flex-wrap gap-2">
                      {deficiency.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Assignment */}
                <Separator />
                <DeficiencyAssignment
                  deficiency={deficiency}
                  onAssignmentChange={onAssignmentChange}
                />
              </TabsContent>

              {/* Workflow Tab */}
              <TabsContent value="workflow" className="mt-6">
                <DeficiencyWorkflow
                  deficiency={deficiency}
                  activities={activities}
                  onStatusChange={onStatusChange}
                />
              </TabsContent>

              {/* Comments Tab */}
              <TabsContent value="comments" className="mt-6">
                <DeficiencyComments
                  deficiencyId={deficiency.id}
                  comments={comments}
                  onCommentAdd={onCommentAdd}
                />
              </TabsContent>

              {/* Activity Tab */}
              <TabsContent value="activity" className="space-y-4 mt-6">
                {activities.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No activity recorded yet
                  </p>
                ) : (
                  <div className="space-y-3">
                    {activities.map((activity) => (
                      <div
                        key={activity.id}
                        className="flex gap-3 p-3 rounded-lg bg-muted/50 text-sm"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="font-medium">
                            {activity.user_name}{" "}
                            <span className="text-muted-foreground font-normal">
                              {activity.action.replace(/_/g, " ")}
                            </span>
                          </div>
                          {activity.details.field && (
                            <div className="text-xs text-muted-foreground mt-1">
                              Changed {activity.details.field} from{" "}
                              <span className="font-medium">
                                {String(activity.details.old_value)}
                              </span>{" "}
                              to{" "}
                              <span className="font-medium">
                                {String(activity.details.new_value)}
                              </span>
                            </div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">
                            {new Date(activity.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
