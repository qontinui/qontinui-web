export interface ProjectMetrics {
  totalWorkflows: number;
  totalStates: number;
  totalImages: number;
  totalTransitions: number;
  testCoverage: number;
  docCoverage: number;
  trends: {
    workflows: number;
    states: number;
    images: number;
    transitions: number;
  };
}

export interface HealthFactors {
  testCoverage: number;
  docCoverage: number;
  organization: number;
  complexity: number;
  unusedResources: number;
  brokenReferences: number;
}

export interface HealthIssue {
  id: string;
  type: "error" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  count: number;
  affectedResources: string[];
  link: string;
}

export interface ResourceUsage {
  type: "workflow" | "state" | "image" | "transition";
  id: string;
  name: string;
  usageCount: number;
  lastUsed?: string;
  size?: number;
}

export interface ActivityEvent {
  id: string;
  type: "created" | "modified" | "deleted" | "imported" | "exported" | "tested";
  resourceType: "workflow" | "state" | "image" | "transition";
  resourceName: string;
  timestamp: Date;
  user?: string;
  metadata?: Record<string, unknown>;
}

export interface DependencyNode {
  id: string;
  type: "workflow" | "state" | "image";
  name: string;
  dependencies: string[];
}

export interface ProjectData {
  metrics: ProjectMetrics;
  healthScore: number;
  healthFactors: HealthFactors;
  healthIssues: HealthIssue[];
  resourceUsage: ResourceUsage[];
  activities: ActivityEvent[];
  timelineData: Array<{
    date: string;
    workflows: number;
    states: number;
    images: number;
    transitions: number;
  }>;
  workflowsByComplexity: Array<{ range: string; count: number; fill: string }>;
  workflowsByFolder: Array<{ name: string; count: number; fill: string }>;
  statesByGroup: Array<{ name: string; count: number; fill: string }>;
  imagesByFolder: Array<{
    name: string;
    size: number;
    fill: string;
    count: number;
  }>;
  transitionsByType: Array<{ name: string; count: number; fill: string }>;
  storageStats: {
    totalSize: number;
    byType: Array<{
      type: string;
      size: number;
      count: number;
      fill: string;
    }>;
  };
  dependencyData: DependencyNode[];
}
