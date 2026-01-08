/**
 * Extraction Progress Component
 *
 * Shows real-time progress of web extraction:
 * - Current status (pending, running, completed, failed)
 * - Stats (pages extracted, elements found, states found)
 * - Error messages if extraction fails
 * - Time information (started, completed)
 */

"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Globe,
  FileSearch,
  Component,
  ArrowRightLeft,
} from "lucide-react";
import type { ExtractionSession } from "@/services/extraction-service";
import { formatDistanceToNow } from "date-fns";

interface ExtractionProgressProps {
  session: ExtractionSession;
}

export function ExtractionProgress({ session }: ExtractionProgressProps) {
  const getStatusIcon = () => {
    switch (session.status) {
      case "completed":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "failed":
        return <XCircle className="h-5 w-5 text-destructive" />;
      case "running":
        return <Loader2 className="h-5 w-5 animate-spin text-brand-primary" />;
      case "pending":
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusVariant = ():
    | "default"
    | "secondary"
    | "destructive"
    | "outline" => {
    switch (session.status) {
      case "completed":
        return "default";
      case "failed":
        return "destructive";
      case "running":
        return "secondary";
      case "pending":
      default:
        return "outline";
    }
  };

  const getProgress = () => {
    if (session.status === "completed") return 100;
    if (session.status === "failed") return 0;

    // Estimate progress based on pages extracted
    const maxPages = (session.config.max_pages as number | undefined) || 100;
    const pagesExtracted = session.stats.pages_extracted || 0;
    return Math.min((pagesExtracted / maxPages) * 100, 95); // Cap at 95% until completed
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              {getStatusIcon()}
              Extraction Progress
            </CardTitle>
            <CardDescription>
              {session.source_urls.length} URL
              {session.source_urls.length > 1 ? "s" : ""}
            </CardDescription>
          </div>
          <Badge variant={getStatusVariant()}>
            {session.status.toUpperCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Progress Bar */}
        {(session.status === "running" || session.status === "pending") && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{Math.round(getProgress())}%</span>
            </div>
            <Progress value={getProgress()} className="h-2" />
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Globe className="h-4 w-4" />
              <span>Pages</span>
            </div>
            <div className="text-2xl font-bold">
              {session.stats.pages_extracted || 0}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Component className="h-4 w-4" />
              <span>Elements</span>
            </div>
            <div className="text-2xl font-bold">
              {session.stats.elements_found || 0}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSearch className="h-4 w-4" />
              <span>States</span>
            </div>
            <div className="text-2xl font-bold">
              {session.stats.states_found || 0}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ArrowRightLeft className="h-4 w-4" />
              <span>Transitions</span>
            </div>
            <div className="text-2xl font-bold">
              {session.stats.transitions_found || 0}
            </div>
          </div>
        </div>

        <Separator />

        {/* Timing Information */}
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Created</span>
            <span className="font-medium">
              {formatDistanceToNow(new Date(session.created_at), {
                addSuffix: true,
              })}
            </span>
          </div>

          {session.started_at && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Started</span>
              <span className="font-medium">
                {formatDistanceToNow(new Date(session.started_at), {
                  addSuffix: true,
                })}
              </span>
            </div>
          )}

          {session.completed_at && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Completed</span>
              <span className="font-medium">
                {formatDistanceToNow(new Date(session.completed_at), {
                  addSuffix: true,
                })}
              </span>
            </div>
          )}
        </div>

        {/* Error Message */}
        {session.error_message && (
          <>
            <Separator />
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-destructive">
                <XCircle className="h-4 w-4" />
                <span className="font-semibold">Error</span>
              </div>
              <p className="text-sm text-muted-foreground">
                {session.error_message}
              </p>
            </div>
          </>
        )}

        {/* URLs List */}
        <Separator />
        <div className="space-y-2">
          <span className="text-sm font-semibold">Source URLs</span>
          <div className="space-y-1">
            {session.source_urls.map((url, index) => (
              <div
                key={index}
                className="text-xs text-muted-foreground truncate"
                title={url}
              >
                {url}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
