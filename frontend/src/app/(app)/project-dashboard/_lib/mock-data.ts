import type {
  ProjectMetrics,
  HealthFactors,
  HealthIssue,
  ResourceUsage,
  ActivityEvent,
  DependencyNode,
  ProjectData,
} from "./types";

export function generateMockProjectData(): ProjectData {
  const metrics: ProjectMetrics = {
    totalWorkflows: 142,
    totalStates: 387,
    totalImages: 1243,
    totalTransitions: 524,
    testCoverage: 73.5,
    docCoverage: 61.2,
    trends: {
      workflows: 8.3,
      states: 12.1,
      images: 15.7,
      transitions: 9.4,
    },
  };

  const healthFactors: HealthFactors = {
    testCoverage: 73.5,
    docCoverage: 61.2,
    organization: 85.0,
    complexity: 72.0,
    unusedResources: 65.0,
    brokenReferences: 92.0,
  };

  const healthScore = Math.round(
    healthFactors.testCoverage * 0.25 +
      healthFactors.docCoverage * 0.2 +
      healthFactors.organization * 0.15 +
      healthFactors.complexity * 0.2 +
      healthFactors.unusedResources * 0.1 +
      healthFactors.brokenReferences * 0.1
  );

  const healthIssues: HealthIssue[] = [
    {
      id: "1",
      type: "error",
      category: "Broken References",
      title: "Missing Image References",
      description: "8 workflows reference images that no longer exist",
      count: 8,
      affectedResources: ["LoginFlow", "CheckoutProcess", "UserProfile"],
      link: "/automation-builder?filter=broken-refs",
    },
    {
      id: "2",
      type: "error",
      category: "Circular Dependencies",
      title: "Circular Workflow Dependencies",
      description: "3 workflows have circular dependencies",
      count: 3,
      affectedResources: ["MainFlow", "SubFlow", "HelperFlow"],
      link: "/automation-builder/dependencies?filter=circular",
    },
    {
      id: "3",
      type: "warning",
      category: "Missing Tests",
      title: "Workflows Without Tests",
      description: "42 workflows have no test cases",
      count: 42,
      affectedResources: [],
      link: "/automation-builder/testing?filter=no-tests",
    },
    {
      id: "4",
      type: "warning",
      category: "High Complexity",
      title: "High Complexity Workflows",
      description: "7 workflows exceed complexity threshold (15+ actions)",
      count: 7,
      affectedResources: ["MasterWorkflow", "FullIntegration"],
      link: "/automation-builder?filter=complex",
    },
    {
      id: "5",
      type: "warning",
      category: "Unused Resources",
      title: "Unused Images",
      description: "156 images are not used in any workflow or state",
      count: 156,
      affectedResources: [],
      link: "/project-dashboard?tab=cleanup",
    },
    {
      id: "6",
      type: "warning",
      category: "Orphaned States",
      title: "Orphaned States",
      description: "12 states are not referenced by any workflow",
      count: 12,
      affectedResources: [],
      link: "/project-dashboard?tab=cleanup",
    },
    {
      id: "7",
      type: "info",
      category: "Documentation",
      title: "Missing Documentation",
      description: "58 workflows have no description",
      count: 58,
      affectedResources: [],
      link: "/automation-builder/documentation",
    },
    {
      id: "8",
      type: "info",
      category: "Duplicate Detection",
      title: "Potential Duplicate Images",
      description: "23 images may be duplicates based on visual similarity",
      count: 23,
      affectedResources: [],
      link: "/project-dashboard?tab=duplicates",
    },
  ];

  const resourceUsage: ResourceUsage[] = [
    {
      type: "workflow",
      id: "wf-1",
      name: "User Login Flow",
      usageCount: 1247,
      lastUsed: "2 hours ago",
    },
    {
      type: "state",
      id: "st-1",
      name: "LoginPage",
      usageCount: 892,
      lastUsed: "5 hours ago",
    },
    {
      type: "image",
      id: "img-1",
      name: "login_button.png",
      usageCount: 743,
      lastUsed: "1 day ago",
      size: 45678,
    },
    {
      type: "workflow",
      id: "wf-2",
      name: "Form Validation",
      usageCount: 621,
      lastUsed: "3 days ago",
    },
    {
      type: "state",
      id: "st-2",
      name: "Dashboard",
      usageCount: 534,
      lastUsed: "1 week ago",
    },
  ];

  const activities: ActivityEvent[] = Array.from({ length: 50 }, (_, i) => {
    const types: ActivityEvent["type"][] = [
      "created",
      "modified",
      "deleted",
      "imported",
      "exported",
      "tested",
    ];
    const resourceTypes: ActivityEvent["resourceType"][] = [
      "workflow",
      "state",
      "image",
      "transition",
    ];
    const type = types[Math.floor(Math.random() * types.length)] || "created";
    const resourceType =
      resourceTypes[Math.floor(Math.random() * resourceTypes.length)] ||
      "workflow";

    return {
      id: `event-${i}`,
      type,
      resourceType,
      resourceName: `${resourceType}-${i}`,
      timestamp: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
      user: Math.random() > 0.5 ? "John Doe" : "Jane Smith",
    };
  }).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  const timelineData = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(
      Date.now() - (29 - i) * 24 * 60 * 60 * 1000
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    workflows: Math.floor(Math.random() * 5 + 2),
    states: Math.floor(Math.random() * 10 + 5),
    images: Math.floor(Math.random() * 15 + 8),
    transitions: Math.floor(Math.random() * 8 + 3),
  }));

  const workflowsByComplexity = [
    { range: "Simple (1-5)", count: 58, fill: "var(--brand-success)" },
    { range: "Medium (6-10)", count: 47, fill: "var(--brand-primary)" },
    { range: "Complex (11-15)", count: 30, fill: "var(--warning)" },
    { range: "Very Complex (16+)", count: 7, fill: "var(--error)" },
  ];

  const workflowsByFolder = [
    { name: "Authentication", count: 35, fill: "var(--brand-primary)" },
    { name: "Navigation", count: 28, fill: "var(--brand-secondary)" },
    { name: "Forms", count: 24, fill: "var(--brand-success)" },
    { name: "Testing", count: 21, fill: "var(--warning)" },
    { name: "API", count: 18, fill: "var(--error)" },
    { name: "Uncategorized", count: 16, fill: "var(--text-muted)" },
  ];

  const statesByGroup = [
    { name: "Login States", count: 45, fill: "var(--brand-primary)" },
    { name: "Dashboard States", count: 67, fill: "var(--brand-secondary)" },
    { name: "Form States", count: 89, fill: "var(--brand-success)" },
    { name: "Error States", count: 34, fill: "var(--error)" },
    { name: "Loading States", count: 56, fill: "var(--warning)" },
    { name: "Other", count: 96, fill: "var(--text-muted)" },
  ];

  const imagesByFolder = [
    { name: "buttons", size: 234, fill: "var(--brand-primary)", count: 234 },
    { name: "icons", size: 189, fill: "var(--brand-secondary)", count: 189 },
    {
      name: "backgrounds",
      size: 156,
      fill: "var(--brand-success)",
      count: 156,
    },
    { name: "forms", size: 143, fill: "var(--warning)", count: 143 },
    { name: "navigation", size: 128, fill: "var(--error)", count: 128 },
    { name: "misc", size: 393, fill: "var(--text-muted)", count: 393 },
  ];

  const transitionsByType = [
    { name: "Outgoing", count: 312, fill: "var(--brand-primary)" },
    { name: "Incoming", count: 212, fill: "var(--brand-secondary)" },
  ];

  const storageStats = {
    totalSize: 847.5,
    byType: [
      {
        type: "Images",
        size: 723.2,
        count: 1243,
        fill: "var(--brand-primary)",
      },
      {
        type: "Workflows",
        size: 45.8,
        count: 142,
        fill: "var(--brand-secondary)",
      },
      { type: "States", size: 52.3, count: 387, fill: "var(--brand-success)" },
      { type: "Other", size: 26.2, count: 524, fill: "var(--text-muted)" },
    ],
  };

  const dependencyData: DependencyNode[] = [
    {
      id: "wf-1",
      type: "workflow",
      name: "Main Login",
      dependencies: ["st-1", "st-2", "img-1"],
    },
    {
      id: "st-1",
      type: "state",
      name: "LoginPage",
      dependencies: ["img-1", "img-2", "img-3"],
    },
    {
      id: "st-2",
      type: "state",
      name: "Dashboard",
      dependencies: ["img-4", "img-5"],
    },
    {
      id: "img-1",
      type: "image",
      name: "login_button.png",
      dependencies: [],
    },
    {
      id: "img-2",
      type: "image",
      name: "username_field.png",
      dependencies: [],
    },
  ];

  return {
    metrics,
    healthScore,
    healthFactors,
    healthIssues,
    resourceUsage,
    activities,
    timelineData,
    workflowsByComplexity,
    workflowsByFolder,
    statesByGroup,
    imagesByFolder,
    transitionsByType,
    storageStats,
    dependencyData,
  };
}
