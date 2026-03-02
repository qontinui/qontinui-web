import type { AiSettings } from "@/lib/runner-api";

export type AiProvider = AiSettings["provider"];

export type ClaudeCliConfig = AiSettings["claude_cli"];
export type ClaudeApiConfig = AiSettings["claude_api"];
export type GeminiCliConfig = AiSettings["gemini_cli"];
export type GeminiApiConfig = AiSettings["gemini_api"];

export const CLAUDE_MODELS = [
  { value: "claude-sonnet-4", label: "Claude Sonnet 4" },
  { value: "claude-opus-4", label: "Claude Opus 4" },
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-opus", label: "Claude 3 Opus" },
];

export const GEMINI_MODELS = [
  { value: "gemini-3-flash", label: "Gemini 3 Flash" },
  { value: "gemini-3-pro", label: "Gemini 3 Pro" },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
];

export const EXECUTION_MODES = [
  { value: "auto", label: "Auto-detect" },
  { value: "windows_native", label: "Windows Native" },
  { value: "wsl", label: "WSL" },
  { value: "native_unix", label: "Native Unix" },
];

export const PROVIDER_OPTIONS: {
  value: AiProvider;
  label: string;
  description: string;
  iconName: "Terminal" | "Bot" | "Sparkles" | "Zap";
  recommended?: boolean;
}[] = [
  {
    value: "claude_cli",
    label: "Claude Code CLI",
    description: "Uses your Claude Code subscription",
    iconName: "Terminal",
    recommended: true,
  },
  {
    value: "claude_api",
    label: "Claude API",
    description: "Direct API access with per-token billing",
    iconName: "Bot",
  },
  {
    value: "gemini_cli",
    label: "Gemini CLI",
    description: "Google's Gemini CLI with OAuth or API key",
    iconName: "Sparkles",
  },
  {
    value: "gemini_api",
    label: "Gemini API",
    description: "Direct Gemini API access with per-token billing",
    iconName: "Zap",
  },
];
