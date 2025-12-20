import Link from "next/link";
import {
  Sparkles,
  ListOrdered,
  GitBranch,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Zap,
} from "lucide-react";

export const metadata = {
  title: "AI Actions - Qontinui Web Documentation",
  description:
    "Guide to AI-powered automation actions in Qontinui: single prompts, prompt sequences, and checkpoint workflows.",
};

export default function AIActionsDocPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/web"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Qontinui Web Docs
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            AI Actions
          </h1>
          <p className="text-xl text-muted-foreground">
            Integrate AI-powered automation into your workflows using Claude
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">Overview</h2>
          <p className="text-foreground mb-4">
            Qontinui provides three AI action types that enable intelligent
            automation. Each serves a different purpose depending on your
            workflow complexity and requirements.
          </p>

          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-3">
              When to Use AI Actions
            </h3>
            <ul className="space-y-2 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Autonomous code analysis, fixes, and improvements</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Test generation and documentation</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Multi-step refactoring and migration tasks</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>
                  Long-running tasks that exceed single session context limits
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* Quick Comparison */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Quick Comparison
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-border text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="border border-border p-3 text-left">
                    Feature
                  </th>
                  <th className="border border-border p-3 text-left">
                    AI Prompt
                  </th>
                  <th className="border border-border p-3 text-left">
                    Prompt Sequence
                  </th>
                  <th className="border border-border p-3 text-left">
                    Checkpoint Workflow
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border p-3 font-medium">
                    Sessions
                  </td>
                  <td className="border border-border p-3">Single</td>
                  <td className="border border-border p-3">Multiple (fixed)</td>
                  <td className="border border-border p-3">
                    Multiple (dynamic)
                  </td>
                </tr>
                <tr className="bg-muted">
                  <td className="border border-border p-3 font-medium">
                    Control Flow
                  </td>
                  <td className="border border-border p-3">None</td>
                  <td className="border border-border p-3">
                    Pre-defined steps
                  </td>
                  <td className="border border-border p-3">AI-driven phases</td>
                </tr>
                <tr>
                  <td className="border border-border p-3 font-medium">
                    Progress Tracking
                  </td>
                  <td className="border border-border p-3">None</td>
                  <td className="border border-border p-3">Step index</td>
                  <td className="border border-border p-3">Checkpoint file</td>
                </tr>
                <tr className="bg-muted">
                  <td className="border border-border p-3 font-medium">
                    Best For
                  </td>
                  <td className="border border-border p-3">Quick tasks</td>
                  <td className="border border-border p-3">
                    Repeatable pipelines
                  </td>
                  <td className="border border-border p-3">
                    Complex, adaptive tasks
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Action Types */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Action Types
          </h2>

          <div className="space-y-8">
            {/* AI Prompt */}
            <ActionTypeSection
              icon={<Sparkles className="w-6 h-6 text-purple-600" />}
              title="AI_PROMPT"
              subtitle="Single AI Session"
              description="Execute a single AI prompt in its own session. The simplest way to add AI capabilities to your workflow."
              color="purple"
            >
              <div className="space-y-4">
                <ConfigOption
                  name="prompt"
                  type="string"
                  description="The prompt to send to Claude. Can be natural language or a slash command."
                  example="Fix all TypeScript errors in src/components/"
                />
                <ConfigOption
                  name="templateId"
                  type="string"
                  description="Reference to a reusable prompt template (alternative to inline prompt)."
                  example="fix-type-errors"
                />
                <ConfigOption
                  name="freshContext"
                  type="boolean"
                  description="Start a new AI session (recommended). Prevents context overflow."
                  example="true (default)"
                />
                <ConfigOption
                  name="outputVariable"
                  type="string"
                  description="Store the AI output in a workflow variable for use by subsequent actions."
                  example="ai_result"
                />
              </div>

              <UseCase
                title="Quick Bug Fix"
                description="Run a focused prompt to fix a specific issue"
                steps={[
                  "AI_PROMPT: 'Fix the null pointer exception in UserService.java'",
                  "SHELL: 'npm test' (verify fix)",
                ]}
              />
            </ActionTypeSection>

            {/* Prompt Sequence */}
            <ActionTypeSection
              icon={<ListOrdered className="w-6 h-6 text-indigo-600" />}
              title="RUN_PROMPT_SEQUENCE"
              subtitle="Pre-defined Multi-Step Pipeline"
              description="Execute a sequence of AI prompts, each in a fresh context. Ideal for repeatable, deterministic workflows."
              color="indigo"
            >
              <div className="space-y-4">
                <ConfigOption
                  name="sequenceId"
                  type="string"
                  description="Reference to a saved sequence definition."
                  example="code-quality-pipeline"
                />
                <ConfigOption
                  name="inlineSequence"
                  type="object"
                  description="Define the sequence inline with steps array."
                  example='{ "steps": [{ "inlinePrompt": "..." }, ...] }'
                />
                <ConfigOption
                  name="onFailure"
                  type="'stop' | 'continue' | 'retry'"
                  description="What to do when a step fails."
                  example="stop (default)"
                />
              </div>

              <div className="bg-indigo-500/10 border border-indigo-500/30 rounded p-4 my-4">
                <h5 className="font-semibold text-foreground mb-2">
                  How It Works
                </h5>
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <span className="px-2 py-1 bg-background rounded">
                    Step 1
                  </span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="px-2 py-1 bg-background rounded">
                    Step 2
                  </span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="px-2 py-1 bg-background rounded">
                    Step 3
                  </span>
                  <ArrowRight className="w-4 h-4" />
                  <span className="px-2 py-1 bg-indigo-500/30 rounded">
                    Done
                  </span>
                </div>
                <p className="text-xs text-foreground mt-2">
                  Each step runs in a fresh AI session. Steps communicate via
                  files and variables.
                </p>
              </div>

              <UseCase
                title="Code Quality Pipeline"
                description="Run a standard sequence of quality checks"
                steps={[
                  "Step 1: 'Run linting and fix errors'",
                  "Step 2: 'Add missing type annotations'",
                  "Step 3: 'Run tests and fix failures'",
                  "Step 4: 'Generate documentation'",
                ]}
              />
            </ActionTypeSection>

            {/* Checkpoint Workflow */}
            <ActionTypeSection
              icon={<GitBranch className="w-6 h-6 text-emerald-600" />}
              title="CHECKPOINT_WORKFLOW"
              subtitle="Dynamic Multi-Session Workflow"
              description="Run AI sessions that dynamically progress through phases. The AI decides when each phase is complete by updating a checkpoint file."
              color="emerald"
            >
              <div className="space-y-4">
                <ConfigOption
                  name="initialPrompt"
                  type="string"
                  description="Prompt for the first session. Should include checkpoint instructions."
                  example="Read checkpoint, complete phases 1-2, update checkpoint"
                />
                <ConfigOption
                  name="continuationPrompt"
                  type="string"
                  description="Prompt for subsequent sessions after the first."
                  example="Continue from checkpoint, complete 2 more phases"
                />
                <ConfigOption
                  name="checkpoint.path"
                  type="string"
                  description="Path to the JSON checkpoint file the AI will read/write."
                  example="C:/project/.dev-logs/workflow-checkpoint.json"
                />
                <ConfigOption
                  name="checkpoint.completionValue"
                  type="number"
                  description="When the phase field reaches this value, the workflow is complete."
                  example="12"
                />
                <ConfigOption
                  name="phases"
                  type="array"
                  description="Visual phase definitions for the workflow builder UI."
                  example='[{ "phase": 1, "name": "Audit" }, ...]'
                />
              </div>

              <div className="bg-green-500/10 border border-green-500/30 rounded p-4 my-4">
                <h5 className="font-semibold text-foreground mb-2">
                  How It Works
                </h5>
                <div className="space-y-2 text-sm text-foreground">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-green-500/30 flex items-center justify-center text-xs font-bold">
                      1
                    </span>
                    <span>Session runs with initial prompt</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-green-500/30 flex items-center justify-center text-xs font-bold">
                      2
                    </span>
                    <span>AI works and updates checkpoint file</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-green-500/30 flex items-center justify-center text-xs font-bold">
                      3
                    </span>
                    <span>Workflow checks: phase &gt;= completion?</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-green-500/30 flex items-center justify-center text-xs font-bold">
                      4
                    </span>
                    <span>If not complete, spawn continuation immediately</span>
                  </div>
                </div>
              </div>

              <UseCase
                title="Large Codebase Improvement"
                description="Multi-phase improvement across many files"
                steps={[
                  "Phase 0: Detect changed repos",
                  "Phase 1: Clean and commit",
                  "Phase 2: Full audit",
                  "Phase 3-8: Fix issues by category",
                  "Phase 9-11: Verify and push",
                  "Phase 12: Finalize",
                ]}
              />

              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded p-4 mt-4">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-yellow-600 mt-0.5" />
                  <div>
                    <h5 className="font-semibold text-foreground">
                      Checkpoint File Required
                    </h5>
                    <p className="text-sm text-foreground">
                      Your prompt must instruct the AI to create and update the
                      checkpoint JSON file. The workflow reads this file to
                      determine progress.
                    </p>
                  </div>
                </div>
              </div>
            </ActionTypeSection>
          </div>
        </section>

        {/* Choosing the Right Action */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Choosing the Right Action
          </h2>

          <div className="space-y-4">
            <DecisionCard
              icon={<Zap className="w-5 h-5 text-purple-600" />}
              title="Use AI_PROMPT when..."
              items={[
                "You have a single, focused task",
                "The task can complete in one session (< 10 minutes)",
                "You don't need to track progress",
                "Examples: quick fixes, code review, simple generation",
              ]}
              color="purple"
            />

            <DecisionCard
              icon={<ListOrdered className="w-5 h-5 text-indigo-600" />}
              title="Use RUN_PROMPT_SEQUENCE when..."
              items={[
                "You have a repeatable, multi-step pipeline",
                "Steps are known in advance and don't change",
                "Each step is independent (no shared context needed)",
                "Examples: CI/CD-style pipelines, quality checks",
              ]}
              color="indigo"
            />

            <DecisionCard
              icon={<GitBranch className="w-5 h-5 text-emerald-600" />}
              title="Use CHECKPOINT_WORKFLOW when..."
              items={[
                "The task is large and may take multiple sessions",
                "The AI needs to decide when phases are complete",
                "You want to resume from where you left off",
                "Examples: large refactoring, multi-repo improvements",
              ]}
              color="emerald"
            />
          </div>
        </section>

        {/* Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Best Practices
          </h2>

          <div className="space-y-4">
            <BestPractice
              title="Always use fresh context for isolated tasks"
              description="Fresh context prevents context overflow and ensures each task starts clean. Only disable for very short follow-up tasks."
            />

            <BestPractice
              title="Include checkpoint instructions in prompts"
              description="For CHECKPOINT_WORKFLOW, your prompt must clearly explain where the checkpoint file is, what format to use, and when to update it."
              example={`Checkpoint file: C:/project/.dev-logs/checkpoint.json
Format: { "current_phase": 0 }
Update after completing each phase.`}
            />

            <BestPractice
              title="Set reasonable session limits"
              description="Use maxSessions to prevent infinite loops. Most workflows complete in 5-10 sessions. Start with 10 and adjust based on your task."
            />

            <BestPractice
              title="Use output variables for chaining"
              description="Store AI output in workflow variables to pass information between actions. This is especially useful in sequences."
            />

            <BestPractice
              title="Design idempotent phases"
              description="For checkpoint workflows, design phases that can be safely re-run. If a session crashes mid-phase, the next session should be able to complete it."
            />
          </div>
        </section>

        {/* Example Checkpoint File */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Example: Checkpoint File Structure
          </h2>

          <div className="bg-slate-900 rounded-lg p-4 text-sm font-mono text-slate-100 overflow-x-auto">
            <pre>{`{
  "started_at": "2024-01-15T10:00:00Z",
  "current_phase": 3,
  "phases_completed": ["audit", "security", "architecture"],
  "repos_processed": ["repo-a", "repo-b"],
  "issues_found": 42,
  "issues_fixed": 38,
  "items_needing_review": [
    { "file": "src/api.ts", "reason": "Breaking change" }
  ]
}`}</pre>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            The workflow reads <code>current_phase</code> to determine progress.
            Additional fields help the AI resume intelligently.
          </p>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Action Types Reference"
              description="Complete reference for all automation actions"
              href="/docs/web/actions"
            />
            <NextStepCard
              title="Runner AI Integration"
              description="Configure the runner for AI-powered automation"
              href="/docs/runner/ai-integration"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface ActionTypeSectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  color: "purple" | "indigo" | "emerald";
  children: React.ReactNode;
}

function ActionTypeSection({
  icon,
  title,
  subtitle,
  description,
  color,
  children,
}: ActionTypeSectionProps) {
  const colorClasses = {
    purple: "border-purple-200 bg-purple-50/30",
    indigo: "border-indigo-200 bg-indigo-50/30",
    emerald: "border-emerald-200 bg-emerald-50/30",
  };

  return (
    <div className={`border rounded-lg p-6 ${colorClasses[color]}`}>
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <div>
          <h3 className="text-xl font-bold text-foreground font-mono">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      <p className="text-foreground mb-6">{description}</p>
      {children}
    </div>
  );
}

interface ConfigOptionProps {
  name: string;
  type: string;
  description: string;
  example: string;
}

function ConfigOption({ name, type, description, example }: ConfigOptionProps) {
  return (
    <div className="bg-card border border-border rounded p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-mono font-semibold text-foreground">{name}</span>
        <span className="text-xs font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
          {type}
        </span>
      </div>
      <p className="text-sm text-muted-foreground mb-1">{description}</p>
      <p className="text-xs text-muted-foreground">
        Example: <code className="bg-muted px-1 rounded">{example}</code>
      </p>
    </div>
  );
}

interface UseCaseProps {
  title: string;
  description: string;
  steps: string[];
}

function UseCase({ title, description, steps }: UseCaseProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4 mt-4">
      <h5 className="font-semibold text-foreground mb-1">{title}</h5>
      <p className="text-sm text-muted-foreground mb-3">{description}</p>
      <ol className="text-xs text-foreground space-y-1">
        {steps.map((step, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="font-mono text-muted-foreground">{idx + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface DecisionCardProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  color: "purple" | "indigo" | "emerald";
}

function DecisionCard({ icon, title, items, color }: DecisionCardProps) {
  const colorClasses = {
    purple: "border-purple-500/30 bg-purple-500/10",
    indigo: "border-indigo-500/30 bg-indigo-500/10",
    emerald: "border-green-500/30 bg-green-500/10",
  };

  const textClasses = {
    purple: "text-foreground",
    indigo: "text-foreground",
    emerald: "text-foreground",
  };

  return (
    <div className={`border rounded-lg p-4 ${colorClasses[color]}`}>
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h4 className={`font-semibold ${textClasses[color]}`}>{title}</h4>
      </div>
      <ul className={`text-sm space-y-1 ${textClasses[color]}`}>
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0 opacity-60" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BestPracticeProps {
  title: string;
  description: string;
  example?: string;
}

function BestPractice({ title, description, example }: BestPracticeProps) {
  return (
    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
      <h4 className="font-semibold text-foreground mb-2">{title}</h4>
      <p className="text-sm text-foreground mb-2">{description}</p>
      {example && (
        <pre className="text-xs font-mono bg-card border border-border rounded p-2 text-foreground whitespace-pre-wrap">
          {example}
        </pre>
      )}
    </div>
  );
}

interface NextStepCardProps {
  title: string;
  description: string;
  href: string;
}

function NextStepCard({ title, description, href }: NextStepCardProps) {
  return (
    <Link
      href={href}
      className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
