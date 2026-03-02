"use client";

import {
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  Eye,
  ExternalLink,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import type { PlaywrightResultsViewProps } from "./playwright-results-types";
import { PlaywrightMetricsCard } from "./_components/PlaywrightMetricsCard";
import { PlaywrightElementsTable } from "./_components/PlaywrightElementsTable";
import { PlaywrightSkippedElementsList } from "./_components/PlaywrightSkippedElementsList";
import { PlaywrightPagesVisitedList } from "./_components/PlaywrightPagesVisitedList";
import { PlaywrightErrorsList } from "./_components/PlaywrightErrorsList";

export function PlaywrightResultsView({
  job,
  results,
}: PlaywrightResultsViewProps) {
  if (job.status === "running" || job.status === "pending") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        <p className="text-muted-foreground">
          {job.progress_message || `Extraction ${job.status}...`}
        </p>
        {job.progress_percent !== undefined && (
          <Progress value={job.progress_percent} className="w-64" />
        )}
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No results available</p>
      </div>
    );
  }

  const clickables = results.clickables || [];
  const skipped_dangerous = results.skipped_dangerous || [];
  const metrics = results.metrics;
  const pages_visited = results.pages_visited || [];
  const errors = results.errors || [];

  return (
    <div className="space-y-4">
      <PlaywrightMetricsCard metrics={metrics} />

      <Tabs defaultValue="elements" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="elements" className="flex items-center gap-1">
            <Eye className="h-4 w-4" />
            Elements
            <Badge variant="secondary" className="ml-1">
              {clickables.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="skipped" className="flex items-center gap-1">
            <ShieldAlert className="h-4 w-4" />
            Skipped
            <Badge variant="secondary" className="ml-1">
              {skipped_dangerous.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="pages" className="flex items-center gap-1">
            <ExternalLink className="h-4 w-4" />
            Pages
            <Badge variant="secondary" className="ml-1">
              {pages_visited.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Errors
            {errors.length > 0 && (
              <Badge variant="destructive" className="ml-1">
                {errors.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="elements" className="mt-4">
          <PlaywrightElementsTable elements={clickables} />
        </TabsContent>

        <TabsContent value="skipped" className="mt-4">
          {skipped_dangerous.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <ShieldCheck className="h-12 w-12 mb-4" />
              <p>No elements were skipped due to safety rules</p>
            </div>
          ) : (
            <PlaywrightSkippedElementsList elements={skipped_dangerous} />
          )}
        </TabsContent>

        <TabsContent value="pages" className="mt-4">
          <PlaywrightPagesVisitedList pages={pages_visited} />
        </TabsContent>

        <TabsContent value="errors" className="mt-4">
          {errors.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mb-4 text-green-500" />
              <p>No errors encountered during extraction</p>
            </div>
          ) : (
            <PlaywrightErrorsList errors={errors} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
