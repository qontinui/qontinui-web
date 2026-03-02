import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  Transition,
  ImageAsset,
} from "@/contexts/automation-context/types";
import type { WorkflowFolder } from "@/types/workflow-organization/types";

export const mockWorkflows: Workflow[] = [
  {
    id: "wf-1",
    name: "User Login Workflow",
    version: "1.0.0",
    format: "graph",
    category: "Authentication",
    description: "Complete user login flow with validation",
    actions: [
      {
        id: "a1",
        type: "FIND",
        name: "Find Username Field",
        config: { target: { type: "image", imageId: "img-1" } },
        position: [100, 100],
      },
      {
        id: "a2",
        type: "TYPE",
        name: "Enter Username",
        config: { text: "user@example.com" },
        position: [100, 250],
      },
      {
        id: "a3",
        type: "CLICK",
        name: "Click Login Button",
        config: { target: "Last Find Result" },
        position: [100, 400],
      },
    ],
    connections: {
      a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
      a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
    },
  },
  {
    id: "wf-2",
    name: "Password Reset Workflow",
    version: "1.0.0",
    format: "graph",
    category: "Authentication",
    description: "Handle password reset requests",
    actions: [
      {
        id: "a1",
        type: "FIND",
        name: "Find Reset Link",
        config: { target: { type: "image", imageId: "img-3" } },
        position: [100, 100],
      },
      {
        id: "a2",
        type: "CLICK",
        name: "Click Reset Link",
        config: { target: "Last Find Result" },
        position: [100, 250],
      },
    ],
    connections: {
      a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
    },
  },
  {
    id: "wf-3",
    name: "Data Export Workflow",
    version: "1.0.0",
    format: "graph",
    category: "Data Management",
    description: "Export user data to CSV",
    actions: [
      {
        id: "a1",
        type: "FIND",
        name: "Find Export Button",
        config: { target: { type: "image", imageId: "img-4" } },
        position: [100, 100],
      },
      {
        id: "a2",
        type: "CLICK",
        name: "Click Export",
        config: { target: "Last Find Result" },
        position: [100, 250],
      },
      {
        id: "a3",
        type: "FIND",
        name: "Wait for Download",
        config: {
          target: { type: "image", imageId: "img-5" },
          searchOptions: { timeout: 5000 },
        },
        position: [100, 400],
      },
    ],
    connections: {
      a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
      a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
    },
  },
  {
    id: "wf-4",
    name: "Form Submission Workflow",
    version: "1.0.0",
    format: "graph",
    category: "Forms",
    description: "Submit contact form with validation",
    actions: [
      {
        id: "a1",
        type: "TYPE",
        name: "Enter Name",
        config: { text: "John Doe" },
        position: [100, 100],
      },
      {
        id: "a2",
        type: "TYPE",
        name: "Enter Email",
        config: { text: "john@example.com" },
        position: [100, 250],
      },
      {
        id: "a3",
        type: "CLICK",
        name: "Submit Form",
        config: { target: "Last Find Result" },
        position: [100, 400],
      },
    ],
    connections: {
      a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
      a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
    },
  },
];

export const mockStates: State[] = [
  {
    id: "st-1",
    name: "Login Page",
    description: "Main login page with username and password fields",
    initial: true,
    stateImages: [
      {
        id: "si-1",
        name: "Login Form",
        patterns: [
          {
            id: "p-1",
            name: "Login Pattern",
            imageId: "img-1",
            searchRegions: [],
            fixed: false,
          },
        ],
        shared: false,
      },
    ],
    regions: [],
    locations: [],
    strings: [],
    position: { x: 100, y: 100 },
  },
  {
    id: "st-2",
    name: "Dashboard",
    description: "User dashboard after successful login",
    stateImages: [
      {
        id: "si-2",
        name: "Dashboard View",
        patterns: [
          {
            id: "p-2",
            name: "Dashboard Pattern",
            imageId: "img-2",
            searchRegions: [],
            fixed: false,
          },
        ],
        shared: false,
      },
    ],
    regions: [],
    locations: [],
    strings: [],
    position: { x: 400, y: 100 },
  },
  {
    id: "st-3",
    name: "Settings Page",
    description: "User settings and preferences",
    stateImages: [
      {
        id: "si-3",
        name: "Settings View",
        patterns: [
          {
            id: "p-3",
            name: "Settings Pattern",
            imageId: "img-3",
            searchRegions: [],
            fixed: false,
          },
        ],
        shared: false,
      },
    ],
    regions: [],
    locations: [],
    strings: [],
    position: { x: 700, y: 100 },
  },
];

export const mockImages: ImageAsset[] = [
  {
    id: "img-1",
    name: "username-field.png",
    url: "/images/username-field.png",
    size: 12456,
    createdAt: new Date("2024-01-15"),
    usageCount: 3,
    s3_key: "images/username-field.png",
    url_expires_at: new Date("2025-01-15"),
    source: "uploaded",
  },
  {
    id: "img-2",
    name: "login-button.png",
    url: "/images/login-button.png",
    size: 8234,
    createdAt: new Date("2024-01-16"),
    usageCount: 5,
    s3_key: "images/login-button.png",
    url_expires_at: new Date("2025-01-16"),
    source: "uploaded",
  },
  {
    id: "img-3",
    name: "reset-password-link.png",
    url: "/images/reset-link.png",
    size: 6789,
    createdAt: new Date("2024-01-17"),
    usageCount: 2,
    s3_key: "images/reset-link.png",
    url_expires_at: new Date("2025-01-17"),
    source: "pattern_optimization",
  },
  {
    id: "img-4",
    name: "export-button.png",
    url: "/images/export-button.png",
    size: 9876,
    createdAt: new Date("2024-01-18"),
    usageCount: 1,
    s3_key: "images/export-button.png",
    url_expires_at: new Date("2025-01-18"),
    source: "uploaded",
  },
];

export const mockTransitions: Transition[] = [
  {
    id: "tr-1",
    type: "OutgoingTransition",
    fromState: "st-1",
    toState: "st-2",
    activateStates: ["st-2"],
    staysVisible: false,
    deactivateStates: ["st-1"],
    workflows: ["wf-1"],
    timeout: 5000,
    retryCount: 3,
  },
  {
    id: "tr-2",
    type: "OutgoingTransition",
    fromState: "st-2",
    toState: "st-3",
    activateStates: ["st-3"],
    staysVisible: false,
    deactivateStates: ["st-2"],
    workflows: ["wf-2"],
    timeout: 5000,
    retryCount: 3,
  },
  {
    id: "tr-3",
    type: "IncomingTransition",
    toState: "st-1",
    workflows: ["wf-3"],
    timeout: 5000,
    retryCount: 3,
  },
];

export const mockFolders: WorkflowFolder[] = [
  {
    id: "f-1",
    name: "Authentication",
    parentId: null,
    color: "#3b82f6",
    icon: "folder",
    description: "User authentication workflows",
    metadata: {
      created: "2024-01-10",
      updated: "2024-01-20",
      workflowCount: 2,
    },
    order: 1,
  },
  {
    id: "f-2",
    name: "Data Management",
    parentId: null,
    color: "#10b981",
    icon: "folder",
    description: "Data import and export workflows",
    metadata: {
      created: "2024-01-11",
      updated: "2024-01-21",
      workflowCount: 1,
    },
    order: 2,
  },
  {
    id: "f-3",
    name: "Forms",
    parentId: null,
    color: "#f59e0b",
    icon: "folder",
    description: "Form submission workflows",
    metadata: {
      created: "2024-01-12",
      updated: "2024-01-22",
      workflowCount: 1,
    },
    order: 3,
  },
];
