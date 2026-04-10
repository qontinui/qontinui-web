"use client";

import { useRunnerQuery } from "../api-client";
import type {
  AiSettings,
  AgenticSettings,
  GeneralSettings,
  DebugSettings,
  PlaywrightSettings,
  SelfHealingSettings,
  MobileSettings,
  StorageInfo,
  DeviceInfo,
  BackupSummary,
  McpServer,
  ProviderCircuitState,
} from "../types/settings";

export function useAiSettings() {
  return useRunnerQuery<AiSettings>("/settings/ai");
}

export function useAgenticSettings() {
  return useRunnerQuery<AgenticSettings>("/settings/agentic");
}

export function useGeneralSettings() {
  return useRunnerQuery<GeneralSettings>("/settings/general");
}

export function useDebugSettings() {
  return useRunnerQuery<DebugSettings>("/settings/debug");
}

export function usePlaywrightSettings() {
  return useRunnerQuery<PlaywrightSettings>("/settings/playwright");
}

export function useSelfHealingSettings() {
  return useRunnerQuery<SelfHealingSettings>("/settings/self-healing");
}

export function useMobileSettings() {
  return useRunnerQuery<MobileSettings>("/settings/mobile");
}

export function useStorageInfo() {
  return useRunnerQuery<StorageInfo>("/settings/storage");
}

export function useDeviceInfo() {
  return useRunnerQuery<DeviceInfo>("/settings/device-info");
}

export function useBackupSummary() {
  return useRunnerQuery<BackupSummary>("/settings/backup/summary");
}

export function useSettingsMcpServers() {
  return useRunnerQuery<McpServer[]>("/settings/mcp/servers");
}

export function useProviderHealth() {
  return useRunnerQuery<ProviderCircuitState[]>("/provider-health", {
    pollInterval: 10000,
  });
}
