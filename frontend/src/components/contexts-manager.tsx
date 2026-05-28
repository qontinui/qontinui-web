"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DestructiveButton } from "@/components/ui/destructive-button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Plus,
  Search,
  X,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Lightbulb,
} from "lucide-react";
import { useContextsManager } from "./_hooks/useContextsManager";
import { AI_ACTION_USE_CASES } from "./context-utils";
import { ContextFormDialog } from "./_components/ContextFormDialog";
import { ContextCard } from "./_components/ContextCard";
import { CategoryFilterBar } from "./_components/CategoryFilterBar";
import { ContextsEmptyState } from "./_components/ContextsEmptyState";

// Help section component (self-contained with its own state)
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

export function ContextsManager() {
  const {
    contexts,
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    showCreateDialog,
    setShowCreateDialog,
    editingContext,
    contextToDelete,
    setContextToDelete,
    formData,
    setFormData,
    showAutoIncludeSection,
    setShowAutoIncludeSection,
    filteredContexts,
    handleOpenCreate,
    handleOpenEdit,
    handleSave,
    handleConfirmDelete,
    handleCloseCreate,
    handleCloseEdit,
  } = useContextsManager();

  return (
    <div className="h-full overflow-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-bold">AI Contexts</h2>

          {/* Stats */}
          {contexts.length > 0 && (
            <CategoryFilterBar
              contexts={contexts}
              categoryFilter={categoryFilter}
              setCategoryFilter={setCategoryFilter}
              statsOnly
            />
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

      {/* Category Filter Badges */}
      {contexts.length > 0 && (
        <CategoryFilterBar
          contexts={contexts}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          badgesOnly
        />
      )}

      {/* Empty State or Context Cards Grid */}
      {contexts.length === 0 || filteredContexts.length === 0 ? (
        <ContextsEmptyState
          hasContexts={contexts.length > 0}
          hasFilteredResults={filteredContexts.length > 0}
          onCreateClick={handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContexts.map((context) => (
            <ContextCard
              key={context.id}
              context={context}
              onEdit={handleOpenEdit}
              onDelete={setContextToDelete}
            />
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <ContextFormDialog
          isEdit={false}
          formData={formData}
          setFormData={setFormData}
          showAutoIncludeSection={showAutoIncludeSection}
          setShowAutoIncludeSection={setShowAutoIncludeSection}
          onSave={handleSave}
          onClose={handleCloseCreate}
        />
      </Dialog>

      {/* Edit Dialog */}
      <Dialog
        open={!!editingContext}
        onOpenChange={(open) => !open && handleCloseEdit()}
      >
        <ContextFormDialog
          isEdit={true}
          formData={formData}
          setFormData={setFormData}
          showAutoIncludeSection={showAutoIncludeSection}
          setShowAutoIncludeSection={setShowAutoIncludeSection}
          onSave={handleSave}
          onClose={handleCloseEdit}
        />
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
            <AlertDialogAction asChild>
              <DestructiveButton onClick={handleConfirmDelete}>
                Delete
              </DestructiveButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
