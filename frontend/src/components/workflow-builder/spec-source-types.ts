import type { DiscoveredSpec } from "@/lib/spec-prompt-builder";

export interface DiscoveredPage {
  url: string;
  title: string;
}

export interface SpecSourceState {
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: Set<string>;
  discoveredPages: DiscoveredPage[];
  selectedPageUrls: Set<string>;
}

export interface SpecSourceSectionProps {
  onSpecsChanged: (state: SpecSourceState) => void;
}

export interface PersistedSpecState {
  sdkUrl: string;
  discoveredSpecs: DiscoveredSpec[];
  selectedGroupIds: string[];
  bundledSpecVersion?: number;
  discoveredPages?: DiscoveredPage[];
  selectedPageUrls?: string[];
}

export const STORAGE_KEY = "ai-generate-spec-source";
export const BUNDLED_SPEC_VERSION = 3;
