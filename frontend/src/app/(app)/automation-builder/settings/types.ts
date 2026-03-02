export interface AutomationSettings {
  autoSave: boolean;
  autoSaveInterval: number;
  theme: string;
  fontSize: number;
  showLineNumbers: boolean;
  enableAutoComplete: boolean;
  maxConcurrentWorkflows: number;
  defaultTimeout: number;
  retryOnFailure: boolean;
  maxRetries: number;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifyOnStart: boolean;
  emailNotifications: boolean;
  enableDebugMode: boolean;
  logLevel: string;
  enableTelemetry: boolean;
}

export const DEFAULT_SETTINGS: AutomationSettings = {
  autoSave: true,
  autoSaveInterval: 30,
  theme: "dark",
  fontSize: 14,
  showLineNumbers: true,
  enableAutoComplete: true,
  maxConcurrentWorkflows: 5,
  defaultTimeout: 30000,
  retryOnFailure: true,
  maxRetries: 3,
  notifyOnSuccess: false,
  notifyOnFailure: true,
  notifyOnStart: false,
  emailNotifications: true,
  enableDebugMode: false,
  logLevel: "info",
  enableTelemetry: true,
};
