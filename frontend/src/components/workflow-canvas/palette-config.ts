/**
 * Node Palette Configuration
 *
 * Comprehensive metadata and configuration for all node types in the palette.
 * Includes display names, descriptions, categories, icons, keywords for search,
 * and default configurations.
 */

import { ActionType } from "@/lib/action-schema/action-types";
import {
  Search,
  Sparkles,
  MousePointer,
  Keyboard,
  GitBranch,
  Database,
  Navigation,
  Eye,
  MousePointerClick,
  Move,
  Type,
  Command,
  RotateCw,
  X,
  GitMerge,
  AlertTriangle,
  Variable,
  SortAsc,
  Filter,
  MapPin,
  Minus,
  Text,
  Calculator,
  ArrowRight,
  Play,
  Camera,
  Timer,
  EyeOff,
  Repeat,
  CornerDownRight,
  CornerRightDown,
  Code,
  FileCode,
  Terminal,
  FileTerminal,
  Brain,
} from "lucide-react";

// ============================================================================
// Category Definitions
// ============================================================================

export type NodeCategory =
  | "find"
  | "mouse"
  | "keyboard"
  | "controlFlow"
  | "data"
  | "state"
  | "code";

export interface CategoryInfo {
  id: NodeCategory;
  label: string;
  description: string;
  color: string;
  icon: typeof Search;
  order: number;
}

export const CATEGORIES: Record<NodeCategory, CategoryInfo> = {
  find: {
    id: "find",
    label: "Find",
    description: "Image matching and element detection",
    color: "#f59e0b", // amber-500
    icon: Search,
    order: 1,
  },
  mouse: {
    id: "mouse",
    label: "Mouse",
    description: "Mouse interactions and movements",
    color: "#10b981", // emerald-500
    icon: MousePointer,
    order: 2,
  },
  keyboard: {
    id: "keyboard",
    label: "Keyboard",
    description: "Keyboard input and shortcuts",
    color: "#06b6d4", // cyan-500
    icon: Keyboard,
    order: 3,
  },
  controlFlow: {
    id: "controlFlow",
    label: "Control Flow",
    description: "Conditional logic and loops",
    color: "#3b82f6", // blue-500
    icon: GitBranch,
    order: 4,
  },
  data: {
    id: "data",
    label: "Data",
    description: "Variables and data operations",
    color: "#f97316", // orange-500
    icon: Database,
    order: 5,
  },
  state: {
    id: "state",
    label: "State",
    description: "State management and process control",
    color: "#8b5cf6", // violet-500
    icon: Navigation,
    order: 6,
  },
  code: {
    id: "code",
    label: "Code",
    description: "Python code execution and custom functions",
    color: "#6366f1", // indigo-500
    icon: Code,
    order: 7,
  },
};

// ============================================================================
// Node Metadata
// ============================================================================

export interface NodeMetadata {
  type: ActionType;
  displayName: string;
  description: string;
  category: NodeCategory;
  icon: typeof Search;
  keywords: string[];
  multiOutput?: boolean;
  outputCount?: number;
  tags?: string[];
}

export const NODE_METADATA: Record<ActionType, NodeMetadata> = {
  // ========================================================================
  // Find Actions
  // ========================================================================
  FIND: {
    type: "FIND",
    displayName: "Find",
    description: "Find element on screen using image matching",
    category: "find",
    icon: Search,
    keywords: ["find", "search", "locate", "image", "match", "detect"],
    tags: ["vision", "detection"],
  },
  VANISH: {
    type: "VANISH",
    displayName: "Vanish",
    description: "Wait for element to disappear from screen",
    category: "find",
    icon: EyeOff,
    keywords: ["vanish", "disappear", "gone", "wait", "remove"],
    tags: ["vision", "wait"],
  },
  EXISTS: {
    type: "EXISTS",
    displayName: "Exists",
    description: "Check if element exists on screen",
    category: "find",
    icon: Eye,
    keywords: ["exists", "check", "verify", "present", "visible"],
    tags: ["vision", "validation"],
  },
  WAIT: {
    type: "WAIT",
    displayName: "Wait",
    description: "Wait for element to appear on screen",
    category: "find",
    icon: Timer,
    keywords: ["wait", "pause", "delay", "timeout"],
    tags: ["timing", "wait"],
  },
  RAG_FIND: {
    type: "RAG_FIND",
    displayName: "RAG Find",
    description: "Find element using AI embeddings (RAG)",
    category: "find",
    icon: Sparkles,
    keywords: [
      "rag",
      "ai",
      "embeddings",
      "semantic",
      "find",
      "search",
      "vector",
    ],
    tags: ["vision", "ai", "rag"],
  },

  // ========================================================================
  // Mouse Actions
  // ========================================================================
  CLICK: {
    type: "CLICK",
    displayName: "Click",
    description: "Click on element (left, right, middle, or double)",
    category: "mouse",
    icon: MousePointerClick,
    keywords: [
      "click",
      "mouse",
      "press",
      "select",
      "activate",
      "double",
      "right",
      "left",
      "middle",
      "context",
    ],
    tags: ["interaction", "basic"],
  },
  MOUSE_MOVE: {
    type: "MOUSE_MOVE",
    displayName: "Mouse Move",
    description: "Move mouse cursor to position",
    category: "mouse",
    icon: Move,
    keywords: ["move", "mouse", "cursor", "position", "hover"],
    tags: ["movement"],
  },
  MOUSE_DOWN: {
    type: "MOUSE_DOWN",
    displayName: "Mouse Down",
    description: "Press mouse button down",
    category: "mouse",
    icon: CornerDownRight,
    keywords: ["mouse", "down", "press", "hold", "button"],
    tags: ["advanced"],
  },
  MOUSE_UP: {
    type: "MOUSE_UP",
    displayName: "Mouse Up",
    description: "Release mouse button",
    category: "mouse",
    icon: CornerRightDown,
    keywords: ["mouse", "up", "release", "button", "let go"],
    tags: ["advanced"],
  },
  DRAG: {
    type: "DRAG",
    displayName: "Drag",
    description: "Drag element from one position to another",
    category: "mouse",
    icon: Move,
    keywords: ["drag", "drop", "move", "pull", "slide"],
    tags: ["interaction", "advanced"],
  },
  SCROLL: {
    type: "SCROLL",
    displayName: "Scroll",
    description: "Scroll page or element",
    category: "mouse",
    icon: RotateCw,
    keywords: ["scroll", "wheel", "page", "up", "down"],
    tags: ["navigation"],
  },

  // ========================================================================
  // Keyboard Actions
  // ========================================================================
  TYPE: {
    type: "TYPE",
    displayName: "Type",
    description: "Type text into an element",
    category: "keyboard",
    icon: Type,
    keywords: ["type", "text", "input", "write", "enter"],
    tags: ["interaction", "basic"],
  },
  KEY_PRESS: {
    type: "KEY_PRESS",
    displayName: "Key Press",
    description: "Press a single key",
    category: "keyboard",
    icon: Command,
    keywords: ["key", "press", "keyboard", "button", "tap"],
    tags: ["input"],
  },
  KEY_DOWN: {
    type: "KEY_DOWN",
    displayName: "Key Down",
    description: "Press key down (hold)",
    category: "keyboard",
    icon: CornerDownRight,
    keywords: ["key", "down", "press", "hold", "modifier"],
    tags: ["advanced"],
  },
  KEY_UP: {
    type: "KEY_UP",
    displayName: "Key Up",
    description: "Release key",
    category: "keyboard",
    icon: CornerRightDown,
    keywords: ["key", "up", "release", "let go"],
    tags: ["advanced"],
  },
  HOTKEY: {
    type: "HOTKEY",
    displayName: "Hotkey",
    description: "Execute keyboard shortcut combination",
    category: "keyboard",
    icon: Command,
    keywords: ["hotkey", "shortcut", "combination", "ctrl", "alt", "cmd"],
    tags: ["shortcut", "advanced"],
  },

  // ========================================================================
  // Control Flow Actions
  // ========================================================================
  IF: {
    type: "IF",
    displayName: "If",
    description: "Conditional branching based on condition",
    category: "controlFlow",
    icon: GitBranch,
    keywords: ["if", "condition", "branch", "decision", "choice"],
    multiOutput: true,
    outputCount: 2,
    tags: ["logic", "branching"],
  },
  LOOP: {
    type: "LOOP",
    displayName: "Loop",
    description: "Repeat actions multiple times",
    category: "controlFlow",
    icon: Repeat,
    keywords: ["loop", "repeat", "iterate", "cycle", "for", "while"],
    tags: ["logic", "iteration"],
  },
  BREAK: {
    type: "BREAK",
    displayName: "Break",
    description: "Exit from loop early",
    category: "controlFlow",
    icon: X,
    keywords: ["break", "exit", "stop", "terminate", "loop"],
    tags: ["logic", "control"],
  },
  CONTINUE: {
    type: "CONTINUE",
    displayName: "Continue",
    description: "Skip to next loop iteration",
    category: "controlFlow",
    icon: ArrowRight,
    keywords: ["continue", "skip", "next", "loop", "iteration"],
    tags: ["logic", "control"],
  },
  SWITCH: {
    type: "SWITCH",
    displayName: "Switch",
    description: "Multi-way branching based on value",
    category: "controlFlow",
    icon: GitMerge,
    keywords: ["switch", "case", "branch", "select", "choice"],
    multiOutput: true,
    tags: ["logic", "branching"],
  },
  TRY_CATCH: {
    type: "TRY_CATCH",
    displayName: "Try/Catch",
    description: "Error handling and recovery",
    category: "controlFlow",
    icon: AlertTriangle,
    keywords: ["try", "catch", "error", "exception", "handle"],
    multiOutput: true,
    outputCount: 2,
    tags: ["logic", "error"],
  },

  // ========================================================================
  // Data Actions
  // ========================================================================
  SET_VARIABLE: {
    type: "SET_VARIABLE",
    displayName: "Set Variable",
    description: "Store a value in a variable",
    category: "data",
    icon: Variable,
    keywords: ["set", "variable", "store", "save", "assign"],
    tags: ["variable", "basic"],
  },
  GET_VARIABLE: {
    type: "GET_VARIABLE",
    displayName: "Get Variable",
    description: "Retrieve a variable value",
    category: "data",
    icon: Variable,
    keywords: ["get", "variable", "retrieve", "load", "read"],
    tags: ["variable", "basic"],
  },
  SORT: {
    type: "SORT",
    displayName: "Sort",
    description: "Sort array or list of items",
    category: "data",
    icon: SortAsc,
    keywords: ["sort", "order", "arrange", "organize", "array"],
    tags: ["collection", "transform"],
  },
  FILTER: {
    type: "FILTER",
    displayName: "Filter",
    description: "Filter array based on condition",
    category: "data",
    icon: Filter,
    keywords: ["filter", "select", "condition", "array", "subset"],
    tags: ["collection", "transform"],
  },
  MAP: {
    type: "MAP",
    displayName: "Map",
    description: "Transform each item in array",
    category: "data",
    icon: MapPin,
    keywords: ["map", "transform", "convert", "array", "each"],
    tags: ["collection", "transform"],
  },
  REDUCE: {
    type: "REDUCE",
    displayName: "Reduce",
    description: "Reduce array to single value",
    category: "data",
    icon: Minus,
    keywords: ["reduce", "aggregate", "combine", "array", "accumulate"],
    tags: ["collection", "transform"],
  },
  STRING_OPERATION: {
    type: "STRING_OPERATION",
    displayName: "String Operation",
    description: "Manipulate text strings",
    category: "data",
    icon: Text,
    keywords: ["string", "text", "concat", "split", "replace", "substring"],
    tags: ["text", "transform"],
  },
  MATH_OPERATION: {
    type: "MATH_OPERATION",
    displayName: "Math Operation",
    description: "Perform mathematical calculations",
    category: "data",
    icon: Calculator,
    keywords: ["math", "calculate", "add", "subtract", "multiply", "divide"],
    tags: ["number", "transform"],
  },

  // ========================================================================
  // State Actions
  // ========================================================================
  GO_TO_STATE: {
    type: "GO_TO_STATE",
    displayName: "Go To State",
    description: "Navigate to a different workflow state",
    category: "state",
    icon: Navigation,
    keywords: ["goto", "state", "navigate", "jump", "transition"],
    tags: ["navigation", "state"],
  },
  RUN_WORKFLOW: {
    type: "RUN_WORKFLOW",
    displayName: "Run Workflow",
    description: "Execute another workflow",
    category: "state",
    icon: Play,
    keywords: ["run", "workflow", "execute", "call", "subprocess"],
    tags: ["workflow", "execution"],
  },
  SCREENSHOT: {
    type: "SCREENSHOT",
    displayName: "Screenshot",
    description: "Capture screen or region",
    category: "state",
    icon: Camera,
    keywords: ["screenshot", "capture", "image", "screen", "snap"],
    tags: ["capture", "utility"],
  },

  // ========================================================================
  // Code Actions
  // ========================================================================
  CODE_BLOCK: {
    type: "CODE_BLOCK",
    displayName: "Code Block",
    description: "Execute inline Python code with access to workflow context",
    category: "code",
    icon: Code,
    keywords: [
      "code",
      "python",
      "script",
      "execute",
      "run",
      "inline",
      "custom",
    ],
    tags: ["code", "python", "advanced"],
  },
  CUSTOM_FUNCTION: {
    type: "CUSTOM_FUNCTION",
    displayName: "Custom Function",
    description: "Execute pre-registered custom Python function",
    category: "code",
    icon: FileCode,
    keywords: ["function", "custom", "python", "plugin", "module", "import"],
    tags: ["code", "python", "plugin", "advanced"],
  },

  // ========================================================================
  // Shell Actions
  // ========================================================================
  SHELL: {
    type: "SHELL",
    displayName: "Run Command",
    description: "Execute a shell command and capture output",
    category: "code",
    icon: Terminal,
    keywords: [
      "shell",
      "command",
      "bash",
      "powershell",
      "cmd",
      "terminal",
      "execute",
      "run",
      "cli",
    ],
    tags: ["shell", "command", "system"],
  },
  SHELL_SCRIPT: {
    type: "SHELL_SCRIPT",
    displayName: "Run Script",
    description: "Execute a multi-line shell script",
    category: "code",
    icon: FileTerminal,
    keywords: [
      "shell",
      "script",
      "bash",
      "powershell",
      "batch",
      "multiline",
      "execute",
      "run",
    ],
    tags: ["shell", "script", "system"],
  },
  TRIGGER_AI_ANALYSIS: {
    type: "TRIGGER_AI_ANALYSIS",
    displayName: "AI Analysis",
    description: "Trigger AI to analyze automation results and fix issues",
    category: "code",
    icon: Brain,
    keywords: [
      "ai",
      "analysis",
      "claude",
      "debug",
      "fix",
      "error",
      "autonomous",
      "intelligent",
    ],
    tags: ["ai", "analysis", "debug"],
  },
};

// ============================================================================
// Search Configuration
// ============================================================================

/**
 * Search weights for fuzzy matching
 */
export interface SearchWeights {
  displayName: number;
  description: number;
  keywords: number;
  category: number;
  tags: number;
}

export const DEFAULT_SEARCH_WEIGHTS: SearchWeights = {
  displayName: 10,
  description: 5,
  keywords: 8,
  category: 3,
  tags: 2,
};

// ============================================================================
// Node Organization
// ============================================================================

/**
 * Get nodes by category
 */
export function getNodesByCategory(category: NodeCategory): NodeMetadata[] {
  return Object.values(NODE_METADATA).filter(
    (node) => node.category === category
  );
}

/**
 * Get all categories in order
 */
export function getCategoriesOrdered(): CategoryInfo[] {
  return Object.values(CATEGORIES).sort((a, b) => a.order - b.order);
}

/**
 * Search nodes by query
 */
export function searchNodes(
  query: string,
  weights: SearchWeights = DEFAULT_SEARCH_WEIGHTS
): NodeMetadata[] {
  if (!query.trim()) {
    return Object.values(NODE_METADATA);
  }

  const lowerQuery = query.toLowerCase();
  const results: Array<{ node: NodeMetadata; score: number }> = [];

  for (const node of Object.values(NODE_METADATA)) {
    let score = 0;

    // Match display name
    if (node.displayName.toLowerCase().includes(lowerQuery)) {
      score += weights.displayName;
      // Bonus for exact match
      if (node.displayName.toLowerCase() === lowerQuery) {
        score += weights.displayName * 2;
      }
    }

    // Match description
    if (node.description.toLowerCase().includes(lowerQuery)) {
      score += weights.description;
    }

    // Match keywords
    for (const keyword of node.keywords) {
      if (keyword.includes(lowerQuery)) {
        score += weights.keywords;
        // Bonus for exact keyword match
        if (keyword === lowerQuery) {
          score += weights.keywords;
        }
      }
    }

    // Match category
    if (node.category.toLowerCase().includes(lowerQuery)) {
      score += weights.category;
    }

    // Match tags
    if (node.tags) {
      for (const tag of node.tags) {
        if (tag.toLowerCase().includes(lowerQuery)) {
          score += weights.tags;
        }
      }
    }

    if (score > 0) {
      results.push({ node, score });
    }
  }

  // Sort by score (descending)
  results.sort((a, b) => b.score - a.score);

  return results.map((r) => r.node);
}

/**
 * Get frequently used nodes (mock implementation - would track actual usage)
 */
export function getFrequentlyUsedNodes(): ActionType[] {
  return [
    "FIND",
    "CLICK",
    "TYPE",
    "IF",
    "WAIT",
    "SET_VARIABLE",
    "LOOP",
    "SCREENSHOT",
  ];
}

/**
 * Get recommended nodes based on context (mock implementation)
 */
export function getRecommendedNodes(
  currentNodeType?: ActionType
): ActionType[] {
  // Simple recommendation logic - would be more sophisticated in practice
  if (!currentNodeType) {
    return ["FIND", "CLICK", "TYPE", "IF"];
  }

  const recommendations: Record<ActionType, ActionType[]> = {
    FIND: ["CLICK", "EXISTS", "WAIT"],
    CLICK: ["TYPE", "WAIT", "FIND"],
    TYPE: ["KEY_PRESS", "CLICK", "WAIT"],
    IF: ["FIND", "EXISTS", "GET_VARIABLE"],
    LOOP: ["BREAK", "CONTINUE", "FIND"],
    // ... add more recommendations
  } as any;

  return recommendations[currentNodeType] || [];
}

/**
 * Check if node type is multi-output
 */
export function isMultiOutput(nodeType: ActionType): boolean {
  return NODE_METADATA[nodeType]?.multiOutput || false;
}

/**
 * Get output count for node type
 */
export function getNodeOutputCount(nodeType: ActionType): number {
  const metadata = NODE_METADATA[nodeType];
  if (metadata?.outputCount !== undefined) {
    return metadata.outputCount;
  }
  return metadata?.multiOutput ? 2 : 1;
}
