"use client";

import { useRunnerQuery } from "../api-client";
import { useRunnerTarget } from "@/contexts/active-runner-context";
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
  return useRunnerQuery<AiSettings>(useRunnerTarget(), "/settings/ai");
}

export function useAgenticSettings() {
  return useRunnerQuery<AgenticSettings>(
    useRunnerTarget(),
    "/settings/agentic"
  );
}

export function useGeneralSettings() {
  return useRunnerQuery<GeneralSettings>(
    useRunnerTarget(),
    "/settings/general"
  );
}

export function useDebugSettings() {
  return useRunnerQuery<DebugSettings>(useRunnerTarget(), "/settings/debug");
}

export function usePlaywrightSettings() {
  return useRunnerQuery<PlaywrightSettings>(
    useRunnerTarget(),
    "/settings/playwright"
  );
}

export function useSelfHealingSettings() {
  return useRunnerQuery<SelfHealingSettings>(
    useRunnerTarget(),
    "/settings/self-healing"
  );
}

export function useMobileSettings() {
  return useRunnerQuery<MobileSettings>(useRunnerTarget(), "/settings/mobile");
}

export function useStorageInfo() {
  return useRunnerQuery<StorageInfo>(useRunnerTarget(), "/settings/storage");
}

export function useDeviceInfo() {
  return useRunnerQuery<DeviceInfo>(useRunnerTarget(), "/settings/device-info");
}

export function useBackupSummary() {
  return useRunnerQuery<BackupSummary>(
    useRunnerTarget(),
    "/settings/backup/summary"
  );
}

export function useSettingsMcpServers() {
  return useRunnerQuery<McpServer[]>(
    useRunnerTarget(),
    "/settings/mcp/servers"
  );
}

export function useProviderHealth() {
  return useRunnerQuery<ProviderCircuitState[]>(
    useRunnerTarget(),
    "/provider-health",
    {
      pollInterval: 10000,
    }
  );
}
