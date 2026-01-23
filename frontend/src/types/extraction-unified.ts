/**
 * Unified Extraction Configuration Types
 *
 * Supports multiple extraction methods:
 * - Web Extraction (DOM-based via Playwright)
 * - UI-TARS Extraction (Vision-based, web or desktop)
 * - Image Extraction (Template matching)
 */

export type ExtractionMethod =
  | "web"
  | "uitars-web"
  | "uitars-desktop"
  | "image"
  | "ui-bridge";

export type UITarsProvider = "local_transformers" | "local_vllm" | "cloud";
export type UITarsModelSize = "2B" | "7B" | "72B";
export type UITarsQuantization = "none" | "int8" | "int4";

export interface WebExtractionConfig {
  urls: string[];
  captureHover: boolean;
  captureFocus: boolean;
  maxDepth: number;
  maxPages: number;
}

export interface UITarsExtractionConfig {
  // Target - one of these should be set
  urls?: string[]; // For uitars-web
  applicationName?: string; // For uitars-desktop

  // Provider settings
  provider: UITarsProvider;
  modelSize: UITarsModelSize;
  quantization: UITarsQuantization;

  // Cloud settings (if provider: 'cloud')
  huggingfaceEndpoint?: string;
  huggingfaceApiToken?: string;

  // Local vLLM settings (if provider: 'local_vllm')
  vllmServerUrl?: string;

  // Exploration settings
  goal: string;
  maxSteps: number;
  timeoutSeconds: number;
  saveScreenshots: boolean;
}

export interface ImageExtractionConfig {
  templatePath: string;
  confidenceThreshold: number;
}

export interface UnifiedExtractionConfig {
  method: ExtractionMethod;
  selectedMonitors: number[];

  // Method-specific configs
  webConfig: WebExtractionConfig;
  uitarsConfig: UITarsExtractionConfig;
  imageConfig: ImageExtractionConfig;
}

export const DEFAULT_WEB_CONFIG: WebExtractionConfig = {
  urls: [""],
  captureHover: true,
  captureFocus: true,
  maxDepth: 5,
  maxPages: 100,
};

/**
 * Default exploration goal for UI-TARS.
 * Aligned with Qontinui's purpose: discovering clickable elements to build state machines.
 */
export const DEFAULT_UITARS_GOAL =
  "Explore the application and discover all clickable UI elements including buttons, links, menu items, and interactive controls. Identify distinct application states and the actions that transition between them.";

export const DEFAULT_UITARS_CONFIG: UITarsExtractionConfig = {
  urls: [""],
  applicationName: "",
  provider: "local_transformers",
  modelSize: "2B",
  quantization: "int4",
  huggingfaceEndpoint: "",
  huggingfaceApiToken: "",
  vllmServerUrl: "http://localhost:8000",
  goal: DEFAULT_UITARS_GOAL,
  maxSteps: 50,
  timeoutSeconds: 600,
  saveScreenshots: true,
};

export const DEFAULT_IMAGE_CONFIG: ImageExtractionConfig = {
  templatePath: "",
  confidenceThreshold: 0.8,
};

export const DEFAULT_UNIFIED_CONFIG: UnifiedExtractionConfig = {
  method: "web",
  selectedMonitors: [0],
  webConfig: DEFAULT_WEB_CONFIG,
  uitarsConfig: DEFAULT_UITARS_CONFIG,
  imageConfig: DEFAULT_IMAGE_CONFIG,
};
