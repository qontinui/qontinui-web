import type {
  PlaywrightExtractionJob,
  PlaywrightExtractionResults,
} from "@/hooks/use-playwright-extraction";

export interface PlaywrightResultsViewProps {
  job: PlaywrightExtractionJob;
  results?: PlaywrightExtractionResults | null;
}

export type ExtractionMetrics = NonNullable<
  PlaywrightExtractionResults["metrics"]
>;

export type SkippedElement = NonNullable<
  PlaywrightExtractionResults["skipped_dangerous"]
>[number];
