import Link from "next/link";
import {
  Search,
  Brain,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Database,
  Eye,
} from "lucide-react";

export const metadata = {
  title: "Findings & Knowledge - Qontinui Runner Documentation",
  description:
    "Understand the difference between findings and knowledge entries in Qontinui Runner's workflow analysis system.",
};

export default function FindingsAndKnowledgePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/runner"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            &larr; Back to Runner Documentation
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Findings &amp; Knowledge
          </h1>
          <p className="text-xl text-muted-foreground">
            Two complementary systems for tracking issues and accumulating
            context during workflow execution
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">Overview</h2>
          <p className="text-foreground mb-4">
            When a unified workflow runs its verification-agentic loop, the
            runner captures two kinds of structured data:{" "}
            <strong>findings</strong> and <strong>knowledge entries</strong>.
            They serve different audiences and have different lifecycles, but
            work together to make each iteration smarter than the last.
          </p>
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Brain className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <p className="text-sm text-foreground">
                <strong>In short:</strong> Findings are for you (the user) to
                track issues. Knowledge is for the AI to learn from past
                iterations. Both are visible in the Summary page after a
                workflow completes.
              </p>
            </div>
          </div>
        </section>

        {/* Side-by-side comparison */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            At a Glance
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <ConceptCard
              title="Findings"
              icon={<Search className="w-6 h-6 text-orange-500" />}
              audience="You"
              purpose="Structured issue tracker with lifecycle management"
              color="orange"
              highlights={[
                "Parsed from AI output markers",
                "Has status flow: detected, in progress, resolved",
                "Categorized by type: bug, security, performance",
                "Severity levels: critical, high, medium, low",
                "Deduplicated across sessions",
                "Supports user input requests",
              ]}
            />
            <ConceptCard
              title="Knowledge"
              icon={<Brain className="w-6 h-6 text-blue-500" />}
              audience="The AI"
              purpose="Cross-iteration context for smarter retries"
              color="blue"
              highlights={[
                "Recorded automatically by the runner",
                "Categories: verification feedback, observation, solution",
                "Tracks which iteration created each entry",
                "Fed back into the AI's prompt on the next iteration",
                "Resolved automatically when verification passes",
                "Visible in Summary page's Knowledge tab",
              ]}
            />
          </div>
        </section>

        {/* Findings detail */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            <span className="inline-flex items-center gap-2">
              <Search className="w-6 h-6 text-orange-500" />
              Findings
            </span>
          </h2>
          <p className="text-foreground mb-6">
            Findings are structured issues detected during workflow execution.
            They work like a built-in issue tracker &mdash; each finding has a
            category, severity, and lifecycle status.
          </p>

          <h3 className="text-lg font-semibold text-foreground mb-3">
            How findings are created
          </h3>
          <p className="text-foreground mb-4">
            The AI emits findings using special markers in its output:
          </p>
          <div className="bg-muted border border-border rounded-lg p-4 mb-6">
            <code className="block text-sm text-foreground font-mono whitespace-pre">
              {`[FINDING:code_bug:high]
Title: Null pointer in login handler
Description: The user object is not checked
  for null before accessing .email
File: src/auth/login.ts
Line: 42
[/FINDING]`}
            </code>
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-3">
            Finding categories
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-6">
            {[
              "code_bug",
              "security",
              "performance",
              "todo",
              "enhancement",
              "config_issue",
              "test_issue",
              "documentation",
              "runtime_issue",
              "already_fixed",
              "expected_behavior",
              "warning",
            ].map((cat) => (
              <div
                key={cat}
                className="bg-card border border-border rounded px-3 py-2 text-sm font-mono text-foreground"
              >
                {cat}
              </div>
            ))}
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-3">
            Status lifecycle
          </h3>
          <div className="flex flex-wrap items-center gap-2 mb-6">
            <StatusBadge status="detected" />
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <StatusBadge status="in_progress" />
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <StatusBadge status="resolved" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Findings can also be marked as{" "}
            <code className="bg-muted px-1 rounded text-xs">wont_fix</code>,{" "}
            <code className="bg-muted px-1 rounded text-xs">deferred</code>, or{" "}
            <code className="bg-muted px-1 rounded text-xs">needs_input</code>{" "}
            (waiting for your decision).
          </p>

          <h3 className="text-lg font-semibold text-foreground mb-3">
            Deduplication
          </h3>
          <p className="text-foreground mb-4">
            Each finding has a signature hash computed from its category, title,
            and code location. If the AI reports the same finding across multiple
            iterations or sessions, it won&apos;t create duplicates.
          </p>
        </section>

        {/* Knowledge detail */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            <span className="inline-flex items-center gap-2">
              <Brain className="w-6 h-6 text-blue-500" />
              Knowledge Entries
            </span>
          </h2>
          <p className="text-foreground mb-6">
            Knowledge entries are the runner&apos;s memory system. They
            accumulate context across iterations of the verification-agentic
            loop so the AI doesn&apos;t repeat mistakes or lose track of what it
            has learned.
          </p>

          <h3 className="text-lg font-semibold text-foreground mb-3">
            How knowledge is recorded
          </h3>
          <p className="text-foreground mb-4">
            The runner automatically records knowledge at key points during
            workflow execution. You don&apos;t need to do anything to enable it.
          </p>
          <div className="space-y-3 mb-6">
            <KnowledgeSource
              trigger="After verification fails"
              category="verification_feedback"
              description="Records which checks failed and why, so the AI knows exactly what to fix on the next attempt"
              icon={
                <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
              }
            />
            <KnowledgeSource
              trigger="After agentic phase completes"
              category="finding, root_cause, solution, observation"
              description="Parses the AI's output for [FINDING:type] markers and stores them as knowledge entries for cross-iteration context"
              icon={
                <Eye className="w-5 h-5 text-purple-500 flex-shrink-0" />
              }
            />
            <KnowledgeSource
              trigger="When verification passes"
              category="(all categories)"
              description="All unresolved knowledge entries are automatically marked as resolved since the issues they describe have been addressed"
              icon={
                <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
              }
            />
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-3">
            Knowledge categories
          </h3>
          <div className="space-y-2 mb-6">
            <CategoryRow
              category="verification_feedback"
              description="What verification checks failed and detailed failure context"
            />
            <CategoryRow
              category="finding"
              description="A discovered issue in the codebase or configuration"
            />
            <CategoryRow
              category="root_cause"
              description="An identified root cause of a problem"
            />
            <CategoryRow
              category="solution"
              description="A fix that was attempted or applied"
            />
            <CategoryRow
              category="observation"
              description="General context about execution progress or outcome"
            />
            <CategoryRow
              category="environment"
              description="Infrastructure issues (missing tools, disk space, permissions)"
            />
          </div>

          <h3 className="text-lg font-semibold text-foreground mb-3">
            How knowledge improves the AI
          </h3>
          <p className="text-foreground mb-4">
            On iteration 2 and beyond, the runner builds a{" "}
            <strong>Previous Iteration Context</strong> section from accumulated
            knowledge and injects it into the AI&apos;s prompt. This includes:
          </p>
          <ul className="space-y-2 text-foreground mb-4">
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">1.</span>
              <span>
                The most recent verification feedback (what failed and why)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">2.</span>
              <span>
                Unresolved findings and root causes from earlier iterations
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">3.</span>
              <span>
                Previous solution attempts (so the AI doesn&apos;t retry failed
                approaches)
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-primary font-bold">4.</span>
              <span>
                Recent observations about execution state
              </span>
            </li>
          </ul>
        </section>

        {/* How they relate */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            How They Work Together
          </h2>
          <p className="text-foreground mb-6">
            Findings and knowledge are complementary. The same information can
            exist in both systems, serving different purposes:
          </p>

          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-foreground mb-4">
              Example: A bug is found during iteration 1
            </h3>
            <div className="space-y-4">
              <FlowStep
                step={1}
                description="The AI identifies a null pointer bug and outputs a [FINDING:code_bug:high] marker"
              />
              <FlowStep
                step={2}
                description='A finding is created in the Findings tab with status "detected" — you can see it, filter it, and track its resolution'
              />
              <FlowStep
                step={3}
                description="A knowledge entry is also created with category 'finding' — this feeds into the AI's context on the next iteration"
              />
              <FlowStep
                step={4}
                description="When verification runs again and fails, the failure details are recorded as verification_feedback knowledge"
              />
              <FlowStep
                step={5}
                description="On iteration 2, the AI receives all of this as context — it knows what it found, what it tried, and what still fails"
              />
              <FlowStep
                step={6}
                description="When verification finally passes, all knowledge entries are marked as resolved"
              />
            </div>
          </div>
        </section>

        {/* Where to see them */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Where to See Them
          </h2>
          <div className="space-y-4">
            <LocationCard
              title="Findings Tab"
              icon={<Search className="w-5 h-5 text-orange-500" />}
              description="Shows all findings for a task run, with filters for category, severity, and status. Available in the task run detail view."
              location="Summary page > Findings tab"
            />
            <LocationCard
              title="Knowledge Tab"
              icon={<Brain className="w-5 h-5 text-blue-500" />}
              description="Shows knowledge entries grouped by iteration, with category labels and resolution status. Appears in the Summary page after workflow completion."
              location="Summary page > Knowledge tab"
            />
            <LocationCard
              title="Runner API"
              icon={<Database className="w-5 h-5 text-green-500" />}
              description="Query findings and knowledge programmatically via the runner's HTTP API for integration with external tools."
              location="http://localhost:9876/task-runs/{id}/knowledge"
            />
          </div>
        </section>

        {/* API reference */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            API Access
          </h2>
          <p className="text-foreground mb-4">
            Both findings and knowledge entries can be queried via the
            runner&apos;s HTTP API:
          </p>
          <div className="space-y-3">
            <ApiEndpoint
              method="GET"
              path="/task-runs/{id}/knowledge"
              description="All knowledge entries for a task run"
            />
            <ApiEndpoint
              method="GET"
              path="/task-runs/{id}/knowledge?category=finding"
              description="Only findings/bugs from knowledge"
            />
            <ApiEndpoint
              method="GET"
              path="/task-runs/{id}/knowledge?unresolved_only=true"
              description="Only unresolved knowledge entries"
            />
          </div>
        </section>

        {/* Comparison table */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Detailed Comparison
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-foreground">
                    Aspect
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-orange-600">
                    Findings
                  </th>
                  <th className="text-left py-3 px-4 font-semibold text-blue-600">
                    Knowledge
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <ComparisonRow
                  aspect="Primary audience"
                  findings="You (the user)"
                  knowledge="The AI agent"
                />
                <ComparisonRow
                  aspect="Purpose"
                  findings="Issue tracking with lifecycle"
                  knowledge="Cross-iteration context propagation"
                />
                <ComparisonRow
                  aspect="Created by"
                  findings="Parsed from AI output markers"
                  knowledge="Recorded automatically by runner"
                />
                <ComparisonRow
                  aspect="Status lifecycle"
                  findings="detected > in_progress > resolved / wont_fix"
                  knowledge="Unresolved or resolved (binary)"
                />
                <ComparisonRow
                  aspect="Deduplication"
                  findings="Yes (signature hash)"
                  knowledge="No"
                />
                <ComparisonRow
                  aspect="User interaction"
                  findings="Supports needs_input / user_response"
                  knowledge="No user interaction"
                />
                <ComparisonRow
                  aspect="Iteration tracking"
                  findings="Session-level only"
                  knowledge="Explicit iteration field"
                />
                <ComparisonRow
                  aspect="Feeds back to AI"
                  findings="Included in iteration context"
                  knowledge="Primary source of iteration context"
                />
                <ComparisonRow
                  aspect="Auto-resolved"
                  findings="No"
                  knowledge="Yes, when verification passes"
                />
                <ComparisonRow
                  aspect="Database table"
                  findings="task_run_findings"
                  knowledge="task_knowledge"
                />
              </tbody>
            </table>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-border pt-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Next Steps
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="AI Integration"
              description="Learn how the AI agent uses context during workflow execution"
              href="/docs/runner/ai-integration"
            />
            <NextStepCard
              title="Monitoring & Logs"
              description="Track execution progress and debug workflow issues"
              href="/docs/runner/monitoring"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// Component definitions
// =============================================================================

interface ConceptCardProps {
  title: string;
  icon: React.ReactNode;
  audience: string;
  purpose: string;
  color: string;
  highlights: string[];
}

function ConceptCard({
  title,
  icon,
  audience,
  purpose,
  highlights,
  color,
}: ConceptCardProps) {
  const borderClass =
    color === "orange" ? "border-orange-300" : "border-blue-300";
  const bgClass =
    color === "orange" ? "bg-orange-500/10" : "bg-blue-500/10";
  const badgeBg =
    color === "orange" ? "bg-orange-500/20" : "bg-blue-500/20";
  const badgeText =
    color === "orange" ? "text-orange-700" : "text-blue-700";

  return (
    <div className={`border ${borderClass} ${bgClass} rounded-lg p-6`}>
      <div className="flex items-center gap-3 mb-3">
        {icon}
        <h3 className="text-xl font-bold text-foreground">{title}</h3>
      </div>
      <div
        className={`inline-block ${badgeBg} ${badgeText} text-xs font-semibold px-2 py-1 rounded mb-3`}
      >
        For: {audience}
      </div>
      <p className="text-sm text-foreground mb-4">{purpose}</p>
      <ul className="space-y-2">
        {highlights.map((item, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-sm text-foreground"
          >
            <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    detected: "bg-yellow-500/20 text-yellow-700 border-yellow-300",
    in_progress: "bg-blue-500/20 text-blue-700 border-blue-300",
    resolved: "bg-green-500/20 text-green-700 border-green-300",
  };
  return (
    <span
      className={`inline-block px-3 py-1 rounded-full text-xs font-mono font-semibold border ${colorMap[status] || "bg-muted text-foreground border-border"}`}
    >
      {status}
    </span>
  );
}

interface KnowledgeSourceProps {
  trigger: string;
  category: string;
  description: string;
  icon: React.ReactNode;
}

function KnowledgeSource({
  trigger,
  category,
  description,
  icon,
}: KnowledgeSourceProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold text-foreground text-sm">{trigger}</h4>
          <p className="text-xs text-muted-foreground mb-1">
            Category:{" "}
            <code className="bg-muted px-1 rounded">{category}</code>
          </p>
          <p className="text-sm text-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  category,
  description,
}: {
  category: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <code className="bg-muted px-2 py-1 rounded text-xs font-mono text-foreground flex-shrink-0 min-w-[180px]">
        {category}
      </code>
      <span className="text-sm text-foreground">{description}</span>
    </div>
  );
}

function FlowStep({
  step,
  description,
}: {
  step: number;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold">
        {step}
      </div>
      <p className="text-sm text-foreground pt-1">{description}</p>
    </div>
  );
}

interface LocationCardProps {
  title: string;
  icon: React.ReactNode;
  description: string;
  location: string;
}

function LocationCard({
  title,
  icon,
  description,
  location,
}: LocationCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold text-foreground text-sm">{title}</h4>
          <p className="text-sm text-muted-foreground mb-2">{description}</p>
          <code className="block bg-muted px-2 py-1 rounded text-xs text-foreground font-mono">
            {location}
          </code>
        </div>
      </div>
    </div>
  );
}

function ApiEndpoint({
  method,
  path,
  description,
}: {
  method: string;
  path: string;
  description: string;
}) {
  return (
    <div className="bg-muted border border-border rounded-lg px-4 py-3 flex items-start gap-3">
      <span className="bg-green-500/20 text-green-700 text-xs font-mono font-bold px-2 py-0.5 rounded flex-shrink-0">
        {method}
      </span>
      <div>
        <code className="text-sm font-mono text-foreground">{path}</code>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </div>
  );
}

function ComparisonRow({
  aspect,
  findings,
  knowledge,
}: {
  aspect: string;
  findings: string;
  knowledge: string;
}) {
  return (
    <tr>
      <td className="py-3 px-4 font-medium text-foreground">{aspect}</td>
      <td className="py-3 px-4 text-foreground">{findings}</td>
      <td className="py-3 px-4 text-foreground">{knowledge}</td>
    </tr>
  );
}

function NextStepCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block bg-muted border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
