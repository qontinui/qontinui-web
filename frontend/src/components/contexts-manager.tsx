"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BookOpen,
  Plus,
  Pencil,
  Trash2,
  Tag,
  Search,
  X,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Sparkles,
  AlertCircle,
  FileText,
  Filter,
  HelpCircle,
  Lightbulb,
  Eye,
  FormInput,
  GitBranch,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { useAutomationStore } from "@/stores/automation";
import type { Context, ContextAutoInclude } from "@qontinui/schemas/config";

// Predefined categories for contexts
const CONTEXT_CATEGORIES = [
  "architecture",
  "debugging",
  "philosophy",
  "domain",
  "workflow",
  "testing",
  "security",
  "performance",
  "other",
] as const;

// Helper to generate context category colors using CSS variables
function getCategoryColor(category: string | null | undefined): string {
  switch (category) {
    case "architecture":
      return "hsl(var(--brand-primary))";
    case "debugging":
      return "#FF6B6B";
    case "philosophy":
      return "hsl(var(--brand-secondary))";
    case "domain":
      return "hsl(var(--brand-success))";
    case "workflow":
      return "#FFB800";
    case "testing":
      return "#00BFFF";
    case "security":
      return "#FF4757";
    case "performance":
      return "#2ED573";
    default:
      return "#6B7280";
  }
}

// Helper to truncate content for preview
function truncateContent(content: string, maxLength: number = 150): string {
  if (content.length <= maxLength) return content;
  return content.slice(0, maxLength).trim() + "...";
}

// Helper to count auto-include rules
function countAutoIncludeRules(
  autoInclude: ContextAutoInclude | null | undefined
): number {
  if (!autoInclude) return 0;
  let count = 0;
  if (autoInclude.taskMentions?.length)
    count += autoInclude.taskMentions.length;
  if (autoInclude.actionTypes?.length) count += autoInclude.actionTypes.length;
  if (autoInclude.errorPatterns?.length)
    count += autoInclude.errorPatterns.length;
  if (autoInclude.filePatterns?.length)
    count += autoInclude.filePatterns.length;
  return count;
}

// Use cases for inline AI actions in GUI automation
const AI_ACTION_USE_CASES = [
  {
    icon: GitBranch,
    title: "Dynamic Decision Making",
    description:
      "AI decides the next action based on current screen state (e.g., handling different dialog types, choosing branches).",
    example:
      "If there's a captcha, solve it. If there's an error, extract the message and decide how to proceed.",
  },
  {
    icon: Eye,
    title: "Unstructured Data Extraction",
    description:
      "Read and interpret variable text from the screen that can't be captured with fixed selectors.",
    example:
      "Extract order confirmation number, shipping date, and total from a receipt screenshot.",
  },
  {
    icon: MessageSquare,
    title: "Handling Unpredictable UI States",
    description:
      "When the application can be in many possible states and model-based navigation isn't practical.",
    example:
      "Navigate to user settings by analyzing the current screen and determining what to click.",
  },
  {
    icon: FormInput,
    title: "Context-Aware Form Filling",
    description:
      "Fill forms where field values require understanding context from the screen or external data.",
    example:
      "Based on customer data and visible form fields, determine appropriate values considering labels and validation hints.",
  },
];

// Help section component
function ContextsHelpSection() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="border-border-default bg-surface-raised/30">
        <CollapsibleTrigger asChild>
          <button className="w-full p-4 flex items-center justify-between text-left hover:bg-surface-raised/50 transition-colors rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-brand-primary/10">
                <HelpCircle className="w-5 h-5 text-brand-primary" />
              </div>
              <div>
                <h3 className="font-medium text-text-primary">
                  When to Use AI Contexts
                </h3>
                <p className="text-sm text-text-muted">
                  Learn how contexts enhance AI-powered GUI automation
                </p>
              </div>
            </div>
            {isOpen ? (
              <ChevronDown className="w-5 h-5 text-text-muted" />
            ) : (
              <ChevronRight className="w-5 h-5 text-text-muted" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-4 space-y-6">
            {/* Overview */}
            <div className="p-4 bg-surface-canvas/50 rounded-lg border border-border-default">
              <div className="flex items-start gap-3">
                <Lightbulb className="w-5 h-5 text-brand-warning mt-0.5 flex-shrink-0" />
                <div className="space-y-2">
                  <p className="text-sm text-text-primary">
                    <strong>AI Contexts</strong> are markdown snippets that get
                    automatically injected into AI prompts during automation.
                    They provide domain knowledge, architectural guidance, and
                    debugging information to AI agents.
                  </p>
                  <p className="text-sm text-text-muted">
                    Use <strong>auto-include rules</strong> to automatically
                    inject contexts when certain conditions are met (keywords in
                    task, action types in workflow, error patterns in logs, or
                    file patterns being edited).
                  </p>
                </div>
              </div>
            </div>

            {/* Use Cases for Inline AI in GUI Automation */}
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-3">
                Use Cases for Inline AI Actions in GUI Automation
              </h4>
              <p className="text-sm text-text-muted mb-4">
                Contexts are particularly valuable when your GUI automation
                workflow includes{" "}
                <code className="px-1 py-0.5 bg-surface-canvas rounded text-xs">
                  AI_PROMPT
                </code>{" "}
                actions. These inline AI steps allow real-time decision making
                during automation:
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {AI_ACTION_USE_CASES.map((useCase) => (
                  <div
                    key={useCase.title}
                    className="p-3 bg-surface-canvas/50 rounded-lg border border-border-default"
                  >
                    <div className="flex items-start gap-2">
                      <useCase.icon className="w-4 h-4 text-brand-primary mt-0.5 flex-shrink-0" />
                      <div>
                        <h5 className="text-sm font-medium text-text-primary">
                          {useCase.title}
                        </h5>
                        <p className="text-xs text-text-muted mt-1">
                          {useCase.description}
                        </p>
                        <p className="text-xs text-text-muted/70 mt-2 italic">
                          Example: {useCase.example}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* How AI Prompts Interact with Workflows */}
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-3">
                How AI Prompts Interact with Workflows
              </h4>
              <p className="text-sm text-text-muted mb-4">
                AI outputs are stored in variables and can drive conditional
                branching. Design prompts to return structured, predictable
                output.
              </p>

              {/* Output Storage */}
              <div className="mb-4">
                <h5 className="text-xs font-medium text-text-primary mb-2">
                  1. Store AI Output in a Variable
                </h5>
                <div className="p-2 bg-surface-canvas rounded border border-border-default font-mono text-xs">
                  <pre className="text-text-muted whitespace-pre-wrap">{`{
  "type": "AI_PROMPT",
  "config": {
    "prompt": "Is there an error? Return 'YES' or 'NO'",
    "outputVariable": "has_error"
  }
}`}</pre>
                </div>
              </div>

              {/* Conditional Branching */}
              <div className="mb-4">
                <h5 className="text-xs font-medium text-text-primary mb-2">
                  2. Branch with IF or SWITCH Actions
                </h5>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div className="p-2 bg-surface-canvas rounded border border-border-default">
                    <p className="text-xs text-text-muted mb-1 font-medium">
                      IF (boolean/comparison):
                    </p>
                    <pre className="font-mono text-xs text-text-muted whitespace-pre-wrap">{`{
  "type": "IF",
  "condition": {
    "variableName": "has_error",
    "operator": "==",
    "expectedValue": "YES"
  },
  "thenActions": ["handle_error"],
  "elseActions": ["continue"]
}`}</pre>
                  </div>
                  <div className="p-2 bg-surface-canvas rounded border border-border-default">
                    <p className="text-xs text-text-muted mb-1 font-medium">
                      SWITCH (multi-branch):
                    </p>
                    <pre className="font-mono text-xs text-text-muted whitespace-pre-wrap">{`{
  "type": "SWITCH",
  "expression": "severity",
  "cases": [
    {"value": "CRITICAL", "actions": ["alert"]},
    {"value": "WARNING", "actions": ["log"]}
  ],
  "defaultActions": ["skip"]
}`}</pre>
                  </div>
                </div>
              </div>

              {/* Variable References */}
              <div className="mb-4">
                <h5 className="text-xs font-medium text-text-primary mb-2">
                  3. Reference Variables in Subsequent Actions
                </h5>
                <div className="p-2 bg-surface-canvas rounded border border-border-default font-mono text-xs">
                  <pre className="text-text-muted whitespace-pre-wrap">{`// Use in another prompt:
"prompt": "Fix this issue: {{context.ai_analysis}}"

// Available namespaces:
{{context.myVar}}      // User-defined variables
{{execution.lastError}} // Auto-populated execution state`}</pre>
                </div>
              </div>

              {/* Prompt Design Tips */}
              <div className="p-3 bg-brand-primary/5 rounded-lg border border-brand-primary/20">
                <p className="text-xs font-medium text-brand-primary mb-2">
                  Prompt Design for Branching
                </p>
                <p className="text-xs text-text-muted">
                  AI output is raw text. For reliable branching, design prompts
                  that return predictable values:
                </p>
                <ul className="text-xs text-text-muted mt-2 space-y-1 list-disc list-inside">
                  <li>
                    Boolean:{" "}
                    <code className="px-1 bg-surface-canvas rounded">
                      &quot;Return only &apos;yes&apos; or &apos;no&apos;&quot;
                    </code>
                  </li>
                  <li>
                    Category:{" "}
                    <code className="px-1 bg-surface-canvas rounded">
                      &quot;Return &apos;CRITICAL&apos;, &apos;WARNING&apos;, or
                      &apos;MINOR&apos;&quot;
                    </code>
                  </li>
                  <li>
                    Structured:{" "}
                    <code className="px-1 bg-surface-canvas rounded">
                      &quot;Return JSON: {`{action, target}`}&quot;
                    </code>
                  </li>
                </ul>
              </div>
            </div>

            {/* When NOT to use inline AI */}
            <div className="p-4 bg-surface-canvas/50 rounded-lg border border-border-default">
              <h4 className="text-sm font-medium text-text-primary mb-2">
                When to Use Unified Workflows Instead
              </h4>
              <p className="text-sm text-text-muted mb-3">
                For development and debugging workflows, the{" "}
                <strong>Unified Workflow</strong> model in qontinui-runner
                provides better structure:
              </p>
              <ul className="text-sm text-text-muted space-y-1 list-disc list-inside">
                <li>
                  <strong>Iterative debugging</strong> - Run automation, verify
                  results, let AI fix issues in a loop
                </li>
                <li>
                  <strong>QA test automation</strong> - Run tests, analyze
                  failures, fix code automatically
                </li>
                <li>
                  <strong>Code improvement pipelines</strong> - Lint/type check,
                  then fix violations
                </li>
              </ul>
              <p className="text-xs text-text-muted/70 mt-3">
                Unified workflows separate GUI automation (verification) from AI
                analysis (agentic phase), providing clearer success criteria and
                accumulated knowledge across iterations.
              </p>
            </div>

            {/* Context Example */}
            <div>
              <h4 className="text-sm font-medium text-text-primary mb-3">
                Example Context for Login Flow
              </h4>
              <div className="p-3 bg-surface-canvas rounded-lg border border-border-default font-mono text-xs overflow-x-auto">
                <pre className="text-text-muted whitespace-pre-wrap">{`## Login Flow Architecture

The login uses these components:
- LoginForm at /app/(auth)/login/page.tsx
- Backend: POST /api/v1/auth/login
- JWT tokens in httpOnly cookies

### Common Issues
- **401 errors**: Check token expiration
- **CORS errors**: Verify BACKEND_CORS_ORIGINS
- **Redirect loops**: Check middleware auth guards

### Auto-Include Rules
- Task Mentions: login, auth, 401, unauthorized
- Error Patterns: 401 Unauthorized, Invalid credentials`}</pre>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

interface ContextFormData {
  name: string;
  content: string;
  category: string;
  tags: string;
  taskMentions: string;
  actionTypes: string;
  errorPatterns: string;
  filePatterns: string;
}

const emptyFormData: ContextFormData = {
  name: "",
  content: "",
  category: "",
  tags: "",
  taskMentions: "",
  actionTypes: "",
  errorPatterns: "",
  filePatterns: "",
};

function contextToFormData(context: Context): ContextFormData {
  return {
    name: context.name,
    content: context.content,
    category: context.category || "",
    tags: context.tags?.join(", ") || "",
    taskMentions: context.autoInclude?.taskMentions?.join(", ") || "",
    actionTypes: context.autoInclude?.actionTypes?.join(", ") || "",
    errorPatterns: context.autoInclude?.errorPatterns?.join(", ") || "",
    filePatterns: context.autoInclude?.filePatterns?.join(", ") || "",
  };
}

function formDataToContext(
  formData: ContextFormData,
  existingContext?: Context
): Context {
  const now = new Date().toISOString();
  const parseCommaSeparated = (value: string): string[] | undefined => {
    const items = value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return items.length > 0 ? items : undefined;
  };

  const autoInclude: ContextAutoInclude | undefined = {
    taskMentions: parseCommaSeparated(formData.taskMentions) ?? null,
    actionTypes: parseCommaSeparated(formData.actionTypes) ?? null,
    errorPatterns: parseCommaSeparated(formData.errorPatterns) ?? null,
    filePatterns: parseCommaSeparated(formData.filePatterns) ?? null,
  };

  // Only include autoInclude if at least one field has values
  const hasAutoIncludeRules =
    autoInclude.taskMentions ||
    autoInclude.actionTypes ||
    autoInclude.errorPatterns ||
    autoInclude.filePatterns;

  return {
    id: existingContext?.id || crypto.randomUUID(),
    name: formData.name.trim(),
    content: formData.content,
    category: formData.category || null,
    tags: parseCommaSeparated(formData.tags),
    autoInclude: hasAutoIncludeRules ? autoInclude : null,
    createdAt: existingContext?.createdAt || now,
    modifiedAt: now,
  };
}

export function ContextsManager() {
  const contexts = useAutomationStore((s) => s.contexts);
  const addContext = useAutomationStore((s) => s.addContext);
  const updateContext = useAutomationStore((s) => s.updateContext);
  const deleteContext = useAutomationStore((s) => s.deleteContext);

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingContext, setEditingContext] = useState<Context | null>(null);
  const [contextToDelete, setContextToDelete] = useState<Context | null>(null);
  const [formData, setFormData] = useState<ContextFormData>(emptyFormData);
  const [showAutoIncludeSection, setShowAutoIncludeSection] = useState(false);

  // Get unique categories from contexts
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    contexts.forEach((ctx) => {
      if (ctx.category) cats.add(ctx.category);
    });
    // Add predefined categories
    CONTEXT_CATEGORIES.forEach((cat) => cats.add(cat));
    return Array.from(cats).sort();
  }, [contexts]);

  // Count contexts by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: contexts.length };
    contexts.forEach((ctx) => {
      const cat = ctx.category || "uncategorized";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [contexts]);

  // Filter contexts by search query and category
  const filteredContexts = useMemo(() => {
    return contexts.filter((context) => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        context.name.toLowerCase().includes(searchLower) ||
        context.content.toLowerCase().includes(searchLower) ||
        context.tags?.some((tag) => tag.toLowerCase().includes(searchLower)) ||
        context.category?.toLowerCase().includes(searchLower);

      const matchesCategory =
        categoryFilter === "all" ||
        (categoryFilter === "uncategorized" && !context.category) ||
        context.category === categoryFilter;

      return matchesSearch && matchesCategory;
    });
  }, [contexts, searchQuery, categoryFilter]);

  // Open create dialog
  const handleOpenCreate = () => {
    setFormData(emptyFormData);
    setShowAutoIncludeSection(false);
    setShowCreateDialog(true);
  };

  // Open edit dialog
  const handleOpenEdit = (context: Context) => {
    setFormData(contextToFormData(context));
    setShowAutoIncludeSection(countAutoIncludeRules(context.autoInclude) > 0);
    setEditingContext(context);
  };

  // Save context (create or update)
  const handleSave = () => {
    if (!formData.name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (!formData.content.trim()) {
      toast.error("Content is required");
      return;
    }

    const context = formDataToContext(formData, editingContext || undefined);

    if (editingContext) {
      updateContext(context);
      toast.success("Context updated", {
        description: `"${context.name}" has been updated.`,
      });
      setEditingContext(null);
    } else {
      addContext(context);
      toast.success("Context created", {
        description: `"${context.name}" has been added to your library.`,
      });
      setShowCreateDialog(false);
    }

    setFormData(emptyFormData);
  };

  // Delete context
  const handleConfirmDelete = () => {
    if (!contextToDelete) return;
    deleteContext(contextToDelete.id);
    toast.success("Context deleted", {
      description: `"${contextToDelete.name}" has been removed.`,
    });
    setContextToDelete(null);
  };

  // Close dialogs
  const handleCloseCreate = () => {
    setShowCreateDialog(false);
    setFormData(emptyFormData);
  };

  const handleCloseEdit = () => {
    setEditingContext(null);
    setFormData(emptyFormData);
  };

  // Form dialog content (shared between create and edit)
  const formDialogContent = (isEdit: boolean) => (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Edit Context" : "Create New Context"}
        </DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Modify the context details and auto-include rules."
            : "Add a new context that can be injected into AI prompts."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="e.g., Error Handling Guidelines"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="bg-transparent border-border-default focus:border-brand-primary"
          />
        </div>

        {/* Category */}
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select
            value={formData.category}
            onValueChange={(value) =>
              setFormData({
                ...formData,
                category: value === "none" ? "" : value,
              })
            }
          >
            <SelectTrigger className="bg-transparent border-border-default focus:border-brand-primary">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No category</SelectItem>
              {CONTEXT_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat.charAt(0).toUpperCase() + cat.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tags */}
        <div className="space-y-2">
          <Label htmlFor="tags">Tags (comma-separated)</Label>
          <Input
            id="tags"
            placeholder="e.g., react, typescript, best-practices"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            className="bg-transparent border-border-default focus:border-brand-primary"
          />
        </div>

        {/* Content */}
        <div className="space-y-2">
          <Label htmlFor="content">Content (Markdown)</Label>
          <Textarea
            id="content"
            placeholder="Enter the context content in Markdown format..."
            value={formData.content}
            onChange={(e) =>
              setFormData({ ...formData, content: e.target.value })
            }
            className="bg-transparent border-border-default focus:border-brand-primary min-h-[200px] font-mono text-sm"
          />
        </div>

        {/* Auto-Include Rules */}
        <Collapsible
          open={showAutoIncludeSection}
          onOpenChange={setShowAutoIncludeSection}
        >
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 p-0 h-auto"
            >
              {showAutoIncludeSection ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <Sparkles className="w-4 h-4 text-brand-primary" />
              <span>Auto-Include Rules</span>
              {!showAutoIncludeSection &&
                countAutoIncludeRules({
                  taskMentions: formData.taskMentions
                    .split(",")
                    .filter(Boolean) as string[],
                  actionTypes: formData.actionTypes
                    .split(",")
                    .filter(Boolean) as string[],
                  errorPatterns: formData.errorPatterns
                    .split(",")
                    .filter(Boolean) as string[],
                  filePatterns: formData.filePatterns
                    .split(",")
                    .filter(Boolean) as string[],
                }) > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {countAutoIncludeRules({
                      taskMentions: formData.taskMentions
                        .split(",")
                        .filter(Boolean) as string[],
                      actionTypes: formData.actionTypes
                        .split(",")
                        .filter(Boolean) as string[],
                      errorPatterns: formData.errorPatterns
                        .split(",")
                        .filter(Boolean) as string[],
                      filePatterns: formData.filePatterns
                        .split(",")
                        .filter(Boolean) as string[],
                    })}{" "}
                    rules
                  </Badge>
                )}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <p className="text-sm text-text-muted">
              Define rules for automatically including this context in AI
              prompts.
            </p>

            {/* Task Mentions */}
            <div className="space-y-2">
              <Label htmlFor="taskMentions" className="text-sm">
                Task Mentions (comma-separated keywords)
              </Label>
              <Input
                id="taskMentions"
                placeholder="e.g., error, debug, fix, troubleshoot"
                value={formData.taskMentions}
                onChange={(e) =>
                  setFormData({ ...formData, taskMentions: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when task prompt contains these keywords
                (case-insensitive)
              </p>
            </div>

            {/* Action Types */}
            <div className="space-y-2">
              <Label htmlFor="actionTypes" className="text-sm">
                Action Types (comma-separated)
              </Label>
              <Input
                id="actionTypes"
                placeholder="e.g., CLICK, FIND, TYPE"
                value={formData.actionTypes}
                onChange={(e) =>
                  setFormData({ ...formData, actionTypes: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when loaded config contains these action types
              </p>
            </div>

            {/* Error Patterns */}
            <div className="space-y-2">
              <Label htmlFor="errorPatterns" className="text-sm">
                Error Patterns (comma-separated regex)
              </Label>
              <Input
                id="errorPatterns"
                placeholder="e.g., TypeError, NullPointerException"
                value={formData.errorPatterns}
                onChange={(e) =>
                  setFormData({ ...formData, errorPatterns: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when recent logs match these patterns
              </p>
            </div>

            {/* File Patterns */}
            <div className="space-y-2">
              <Label htmlFor="filePatterns" className="text-sm">
                File Patterns (comma-separated globs)
              </Label>
              <Input
                id="filePatterns"
                placeholder="e.g., *.rs, src/api/**, tests/**"
                value={formData.filePatterns}
                onChange={(e) =>
                  setFormData({ ...formData, filePatterns: e.target.value })
                }
                className="bg-transparent border-border-default focus:border-brand-primary"
              />
              <p className="text-xs text-text-muted">
                Include when working on files matching these patterns
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <DialogFooter>
        <Button
          variant="outline"
          onClick={isEdit ? handleCloseEdit : handleCloseCreate}
          className="border-border-default"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          className="bg-brand-success hover:bg-brand-success/80 text-black"
        >
          {isEdit ? "Save Changes" : "Create Context"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-bold">AI Contexts</h2>

          {/* Stats */}
          {contexts.length > 0 && (
            <div className="flex gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
                <span className="text-xs text-text-muted">Total Contexts:</span>
                <span className="text-sm font-bold text-brand-success">
                  {contexts.length}
                </span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-raised/50 border border-border-default rounded-lg">
                <span className="text-xs text-text-muted">
                  With Auto-Include:
                </span>
                <span className="text-sm font-bold text-brand-primary">
                  {
                    contexts.filter(
                      (c) => countAutoIncludeRules(c.autoInclude) > 0
                    ).length
                  }
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              placeholder="Search contexts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-64 bg-transparent border-border-default focus:border-brand-success"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                onClick={() => setSearchQuery("")}
              >
                <X className="w-3 h-3" />
              </Button>
            )}
          </div>

          {/* Create Button */}
          <Button
            onClick={handleOpenCreate}
            className="bg-brand-success hover:bg-brand-success/80 text-black"
          >
            <Plus className="w-4 h-4 mr-2" />
            New Context
          </Button>
        </div>
      </div>

      {/* Help Section */}
      <ContextsHelpSection />

      {/* Category Filter */}
      {contexts.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          <Badge
            variant={categoryFilter === "all" ? "default" : "outline"}
            className={`cursor-pointer transition-all ${
              categoryFilter === "all"
                ? "bg-brand-success text-black border-brand-success"
                : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
            }`}
            onClick={() => setCategoryFilter("all")}
          >
            All ({categoryCounts.all || 0})
          </Badge>
          {availableCategories.map((cat) => (
            <Badge
              key={cat}
              variant={categoryFilter === cat ? "default" : "outline"}
              className={`cursor-pointer transition-all ${
                categoryFilter === cat
                  ? "text-black"
                  : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
              }`}
              style={
                categoryFilter === cat
                  ? {
                      backgroundColor: getCategoryColor(cat),
                      borderColor: getCategoryColor(cat),
                    }
                  : {}
              }
              onClick={() => setCategoryFilter(cat)}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)} (
              {categoryCounts[cat] || 0})
            </Badge>
          ))}
          {(categoryCounts.uncategorized ?? 0) > 0 && (
            <Badge
              variant={
                categoryFilter === "uncategorized" ? "default" : "outline"
              }
              className={`cursor-pointer transition-all ${
                categoryFilter === "uncategorized"
                  ? "bg-surface-raised text-text-primary border-border-default"
                  : "bg-transparent border-border-default text-text-muted hover:border-border-subtle"
              }`}
              onClick={() => setCategoryFilter("uncategorized")}
            >
              Uncategorized ({categoryCounts.uncategorized})
            </Badge>
          )}
        </div>
      )}

      {/* Empty State */}
      {contexts.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <BookOpen className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No contexts created</p>
          <p className="text-sm mb-4 max-w-md mx-auto">
            Contexts inject domain knowledge into AI prompts during automation.
            Expand the help section above to learn about use cases for inline AI
            actions in GUI automation.
          </p>
          <Button
            onClick={handleOpenCreate}
            className="bg-brand-success hover:bg-brand-success/80 text-black"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create First Context
          </Button>
        </div>
      ) : filteredContexts.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <Filter className="w-16 h-16 mx-auto mb-4 opacity-50" />
          <p className="text-lg">No contexts found</p>
          <p className="text-sm">Try adjusting your search or filter</p>
        </div>
      ) : (
        /* Context Cards Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContexts.map((context) => (
            <Card
              key={context.id}
              className="border-border-default bg-surface-raised hover:border-border-subtle transition-colors group"
            >
              <CardContent className="p-4">
                <div className="space-y-3">
                  {/* Header */}
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium truncate" title={context.name}>
                        {context.name}
                      </h3>
                      {context.category && (
                        <Badge
                          className="mt-1 text-xs"
                          style={{
                            backgroundColor: getCategoryColor(context.category),
                            color: "black",
                          }}
                        >
                          {context.category}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-text-muted hover:text-brand-primary"
                        onClick={() => handleOpenEdit(context)}
                        title="Edit Context"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-text-muted hover:text-red-400"
                        onClick={() => setContextToDelete(context)}
                        title="Delete Context"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Content Preview */}
                  <div className="bg-surface-canvas/50 rounded p-2">
                    <p className="text-sm text-text-muted font-mono whitespace-pre-wrap line-clamp-4">
                      {truncateContent(context.content)}
                    </p>
                  </div>

                  {/* Tags */}
                  {context.tags && context.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {context.tags.slice(0, 5).map((tag) => (
                        <Badge
                          key={tag}
                          variant="outline"
                          className="text-xs border-border-subtle text-text-muted"
                        >
                          <Tag className="w-2.5 h-2.5 mr-1" />
                          {tag}
                        </Badge>
                      ))}
                      {context.tags.length > 5 && (
                        <Badge
                          variant="outline"
                          className="text-xs border-border-subtle text-text-muted"
                        >
                          +{context.tags.length - 5} more
                        </Badge>
                      )}
                    </div>
                  )}

                  {/* Auto-Include Indicators */}
                  {countAutoIncludeRules(context.autoInclude) > 0 && (
                    <div className="flex items-center gap-2 pt-2 border-t border-border-default">
                      <Sparkles className="w-3.5 h-3.5 text-brand-primary" />
                      <span className="text-xs text-text-muted">
                        {countAutoIncludeRules(context.autoInclude)}{" "}
                        auto-include rule
                        {countAutoIncludeRules(context.autoInclude) > 1
                          ? "s"
                          : ""}
                      </span>
                      <div className="flex gap-1 ml-auto">
                        {context.autoInclude?.taskMentions?.length && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-5"
                          >
                            <FileText className="w-2.5 h-2.5 mr-0.5" />
                            {context.autoInclude.taskMentions.length}
                          </Badge>
                        )}
                        {context.autoInclude?.errorPatterns?.length && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-5"
                          >
                            <AlertCircle className="w-2.5 h-2.5 mr-0.5" />
                            {context.autoInclude.errorPatterns.length}
                          </Badge>
                        )}
                        {context.autoInclude?.filePatterns?.length && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-5"
                          >
                            <FolderOpen className="w-2.5 h-2.5 mr-0.5" />
                            {context.autoInclude.filePatterns.length}
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Footer with dates */}
                  <div className="flex items-center justify-between text-xs text-text-muted pt-2">
                    <span>
                      Created:{" "}
                      {new Date(context.createdAt).toLocaleDateString()}
                    </span>
                    <span>
                      Modified:{" "}
                      {new Date(context.modifiedAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        {formDialogContent(false)}
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editingContext}
        onOpenChange={(open) => !open && handleCloseEdit()}
      >
        {formDialogContent(true)}
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={!!contextToDelete}
        onOpenChange={(open) => !open && setContextToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Context</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{contextToDelete?.name}
              &quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
