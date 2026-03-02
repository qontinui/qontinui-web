import type { AgenticSettings } from "@/lib/runner-api";

export type CompressionSettings = AgenticSettings["compression"];
export type RetrySettings = AgenticSettings["retry"];
export type RoutingSettings = AgenticSettings["routing"];

export const DEFAULT_COMPRESSION: CompressionSettings = {
  enabled: true,
  threshold_tokens: 80000,
  target_tokens: 60000,
  keep_recent_items: 5,
  summarize_batch_size: 10,
};

export const DEFAULT_RETRY: RetrySettings = {
  enabled: true,
  max_retries: 3,
  base_delay_ms: 1000,
  max_delay_ms: 30000,
  exponential_base: 2.0,
  jitter: true,
  feedback_injection: true,
};

export const DEFAULT_ROUTING: RoutingSettings = {
  enabled: false,
  simple_model: "claude-3-5-haiku",
  medium_model: "claude-sonnet-4",
  complex_model: "claude-opus-4",
  file_threshold_simple: 3,
  file_threshold_medium: 10,
};

export const ROUTING_MODELS = [
  { value: "claude-3-5-haiku", label: "Claude 3.5 Haiku" },
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-opus", label: "Claude 3 Opus" },
];
