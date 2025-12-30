import Link from "next/link";
import { Sparkles, CheckCircle2 } from "lucide-react";

export const metadata = {
  title: "AI Actions - Qontinui Web Documentation",
  description:
    "Guide to AI-powered automation actions in Qontinui using the AI Prompt action.",
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
            Qontinui provides the AI Prompt action type that enables intelligent
            automation powered by Claude. Use it to add AI capabilities to your
            workflows for autonomous code analysis, fixes, and improvements.
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
                <span>Analyzing automation results and fixing issues</span>
              </li>
            </ul>
          </div>
        </section>

        {/* Action Types */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            AI Prompt Action
          </h2>

          <div className="space-y-8">
            {/* AI Prompt */}
            <ActionTypeSection
              icon={<Sparkles className="w-6 h-6 text-purple-600" />}
              title="AI_PROMPT"
              subtitle="Execute AI Prompts with Claude"
              description="Execute an AI prompt with context isolation. The simplest and most powerful way to add AI capabilities to your workflow. Supports single-shot execution or auto-continuation for longer tasks."
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
                  name="maxSessions"
                  type="number | null"
                  description="Maximum sessions to spawn. 1 = one-shot, null = unlimited auto-continuation until [TASK_COMPLETE]."
                  example="1 (default, one-shot)"
                />
                <ConfigOption
                  name="outputVariable"
                  type="string"
                  description="Store the AI output in a workflow variable for use by subsequent actions."
                  example="ai_result"
                />
                <ConfigOption
                  name="timeout"
                  type="number"
                  description="Execution timeout in milliseconds."
                  example="600000 (10 minutes, default)"
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

              <UseCase
                title="Multi-Session Task"
                description="Allow AI to continue across sessions for larger tasks"
                steps={[
                  "Set maxSessions to null for unlimited auto-continuation",
                  "AI will spawn new sessions until it outputs [TASK_COMPLETE]",
                  "Results are accumulated across all sessions",
                ]}
              />
            </ActionTypeSection>
          </div>
        </section>

        {/* Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Best Practices
          </h2>

          <div className="space-y-4">
            <BestPractice
              title="Use one-shot for focused tasks"
              description="Set maxSessions to 1 (default) for quick, focused tasks that can complete in a single session. This prevents unexpected long-running operations."
            />

            <BestPractice
              title="Use auto-continuation for complex tasks"
              description="Set maxSessions to null for tasks that may need multiple sessions, like large refactoring or multi-file changes. The AI will continue until it outputs [TASK_COMPLETE]."
            />

            <BestPractice
              title="Use output variables for chaining"
              description="Store AI output in workflow variables to pass information between actions. This is especially useful in sequences."
            />

            <BestPractice
              title="Combine with SHELL actions for verification"
              description="After AI makes changes, use SHELL actions to run tests, linting, or type checking to verify the changes are correct."
            />
          </div>
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
