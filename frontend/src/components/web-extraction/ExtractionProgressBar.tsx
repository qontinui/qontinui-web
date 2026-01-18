/**
 * Compact Extraction Progress Bar Component
 *
 * Shows extraction progress in a single horizontal line:
 * - Status badge
 * - Progress bar (when running)
 * - Stats (pages, elements, states, transitions)
 * - Created time
 * - Source URLs
 */

"use client";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Globe,
  Component,
  FileSearch,
  ArrowRightLeft,
  Link as LinkIcon,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ExtractionSession } from "@/services/extraction-service";

interface ExtractionProgressBarProps {
  session: ExtractionSession;
}

export function ExtractionProgressBar({
  session,
}: ExtractionProgressBarProps) {
  const getStatusIcon = () => {
    switch (session.status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-destructive" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-brand-primary" />;
      case "pending":
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />;
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

    const maxPages = (session.config.max_pages as number | undefined) || 100;
    const pagesExtracted = session.stats.pages_extracted || 0;
    return Math.min((pagesExtracted / maxPages) * 100, 95);
  };

  const isRunning =
    session.status === "running" || session.status === "pending";

  const formatUrls = () => {
    if (session.source_urls.length === 0) return "";
    const firstUrl = session.source_urls[0];
    if (!firstUrl) return "";
    if (session.source_urls.length === 1) {
      try {
        return new URL(firstUrl).hostname;
      } catch {
        return firstUrl.slice(0, 30);
      }
    }
    try {
      return `${new URL(firstUrl).hostname} +${session.source_urls.length - 1}`;
    } catch {
      return `${session.source_urls.length} URLs`;
    }
  };

  return (
    <div className="border rounded-lg p-3 bg-card">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Status */}
        <div className="flex items-center gap-2 shrink-0">
          {getStatusIcon()}
          <Badge variant={getStatusVariant()}>
            {session.status.toUpperCase()}
          </Badge>
        </div>

        {/* Progress Bar (only when running) */}
        {isRunning && (
          <div className="flex items-center gap-2 min-w-[120px] max-w-[200px]">
            <Progress value={getProgress()} className="h-2 flex-1" />
            <span className="text-xs text-muted-foreground shrink-0">
              {Math.round(getProgress())}%
            </span>
          </div>
        )}

        {/* Separator */}
        <div className="h-4 w-px bg-border shrink-0" />

        {/* Stats */}
        <div className="flex items-center gap-3 text-xs shrink-0">
          <div className="flex items-center gap-1" title="Pages extracted">
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">
              {session.stats.pages_extracted || 0}
            </span>
          </div>

          <div className="flex items-center gap-1" title="Elements found">
            <Component className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">
              {session.stats.elements_found || 0}
            </span>
          </div>

          <div className="flex items-center gap-1" title="States discovered">
            <FileSearch className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">
              {session.stats.states_found || 0}
            </span>
          </div>

          <div className="flex items-center gap-1" title="Transitions found">
            <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">
              {session.stats.transitions_found || 0}
            </span>
          </div>
        </div>

        {/* Separator */}
        <div className="h-4 w-px bg-border shrink-0" />

        {/* Created time */}
        <div
          className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
          title={`Created: ${new Date(session.created_at).toLocaleString()}`}
        >
          <Clock className="h-3.5 w-3.5" />
          <span>
            {formatDistanceToNow(new Date(session.created_at), {
              addSuffix: true,
            })}
          </span>
        </div>

        {/* Source URLs */}
        <div
          className="flex items-center gap-1 text-xs text-muted-foreground shrink-0"
          title={session.source_urls.join("\n")}
        >
          <LinkIcon className="h-3.5 w-3.5" />
          <span>{formatUrls()}</span>
        </div>

        {/* Error indicator */}
        {session.error_message && (
          <>
            <div className="h-4 w-px bg-border shrink-0" />
            <div
              className="text-xs text-destructive truncate max-w-[200px]"
              title={session.error_message}
            >
              {session.error_message}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
