import Link from "next/link";
import {
  Calculator,
  FlaskConical,
  Database,
  FileCode,
  Github,
  CheckCircle2,
  Clock,
} from "lucide-react";

export const metadata = {
  title: "Example Projects - Qontinui Documentation",
  description:
    "Real, runnable example projects that ship with Qontinui — demo workflows for the runner and configuration samples for the Python library.",
};

export default function ExamplesDocPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs"
            className="text-primary hover:text-primary/80 text-sm mb-4 inline-block"
          >
            ← Back to Documentation
          </Link>
          <h1 className="text-4xl font-bold text-foreground mb-4">
            Example Projects
          </h1>
          <p className="text-xl text-muted-foreground">
            Real, runnable examples that ship in the Qontinui repositories
          </p>
        </div>

        {/* Intro */}
        <section className="mb-12">
          <p className="text-foreground mb-4">
            Every example below lives in source control and runs out of the box.
            The <strong>demo workflows</strong> are seeded into Qontinui Runner
            on first launch (or created by a setup script), and the{" "}
            <strong>configuration samples</strong> demonstrate execution modes
            for the Python library. Use them to learn the verification-agentic
            loop and the model-based automation patterns hands-on.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              The Core Idea
            </h3>
            <p className="text-sm text-foreground">
              In each demo you define what needs to be <strong>true</strong>{" "}
              (verification checks — tests, linters, type checkers), and the AI
              figures out <strong>how</strong> to make it true. The runner loops
              the verification and agentic phases until all checks pass.
            </p>
          </div>
        </section>

        {/* Demo Workflows */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Runner Demo Workflows
          </h2>
          <p className="text-muted-foreground mb-6">
            Three end-to-end demos in the runner repository. Each has a setup
            phase that creates its workspace, a verification phase that runs a
            test suite, and an agentic phase where the AI fixes or implements
            the code.
          </p>

          <div className="space-y-6">
            <ExampleCard
              icon={<Calculator className="w-7 h-7 text-primary" />}
              title="Fix Buggy Calculator"
              complexity="Simple"
              duration="~30s"
              demonstrates="The verification-agentic loop on a focused bug fix."
              points={[
                "A Python calculator ships with 3 arithmetic bugs (subtract adds, divide multiplies, modulo does integer division)",
                "Verification runs the test suite and reports failures",
                "The AI reads the failing tests, identifies the root cause, and edits the implementation",
                "Verification re-runs — all tests pass",
              ]}
              href="https://github.com/qontinui/qontinui-runner/tree/main/examples/demo-workflows"
            />

            <ExampleCard
              icon={<FlaskConical className="w-7 h-7 text-green-600" />}
              title="Implement from Tests (TDD)"
              complexity="Medium"
              duration="~35s"
              demonstrates="Building code from a test specification — true test-driven development."
              points={[
                "The test file is the specification; the implementation starts empty",
                "Verification fails initially because the functions don't exist",
                "The AI reads the tests and implements five string utilities — reverse_words, title_case, count_vowels, is_palindrome, truncate",
                "Verification passes (22 tests) in a single iteration",
              ]}
              href="https://github.com/qontinui/qontinui-runner/tree/main/examples/demo-workflows"
            />

            <ExampleCard
              icon={<Database className="w-7 h-7 text-purple-600" />}
              title="Fix Data Pipeline"
              complexity="Complex"
              duration="~40s"
              demonstrates="Validating computed output against expected values across a multi-step pipeline."
              points={[
                "A Python pipeline reads a sales CSV, computes revenue, and writes a JSON report",
                "Validation checks the output against manually calculated expected values",
                "The AI fixes a type-conversion bug (string→float), an arithmetic bug (multiply→divide), and an aggregation bug (min→max)",
                "Validation confirms the corrected report",
              ]}
              href="https://github.com/qontinui/qontinui-runner/tree/main/examples/demo-workflows"
            />
          </div>

          <div className="bg-muted border border-border rounded-lg p-4 mt-6">
            <p className="text-sm text-foreground">
              <strong>Running them:</strong> The demos are seeded automatically
              on the runner&apos;s first launch. If they&apos;re missing, run the{" "}
              <code className="font-mono bg-background border border-border px-1 rounded">
                create_demo_workflows.ps1
              </code>{" "}
              script in the <code className="font-mono">examples/demo-workflows</code>{" "}
              directory. They require Python and the Claude CLI to be installed.
            </p>
          </div>
        </section>

        {/* Library Config Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Configuration Samples
          </h2>
          <p className="text-muted-foreground mb-6">
            The runner repository also ships standalone configuration files that
            demonstrate the library&apos;s execution modes and patterns. Each is a
            complete JSON config you can load directly.
          </p>

          <div className="grid gap-4">
            <ConfigCard
              title="Mock Mode Example"
              file="config-mock-mode.json"
              description="Runs a click / wait / type workflow with executionMode set to mock — waits resolve instantly and no real GUI is touched."
            />
            <ConfigCard
              title="Real Mode Example"
              file="config-real-mode.json"
              description="The same patterns executed against the live GUI through the hardware abstraction layer."
            />
            <ConfigCard
              title="Screenshot Mode"
              file="config-screenshot-mode.json"
              description="Matches against captured screenshots rather than the live display for reproducible scene testing."
            />
            <ConfigCard
              title="Recursive Verification"
              file="config-recursive-verify.json"
              description="Demonstrates the verification loop that re-checks state after each action until conditions hold."
            />
            <ConfigCard
              title="Task Continuation"
              file="config-task-continuation.json"
              description="Shows how a multi-step task carries context forward across continuation points."
            />
            <ConfigCard
              title="Notepad Automation"
              file="notepad_automation.json"
              description="A classic visual-automation example driving the Windows Notepad application."
            />
          </div>
        </section>

        {/* Python Library */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Python Library
          </h2>
          <p className="text-muted-foreground mb-6">
            To use Qontinui programmatically, explore the core Python library
            source. It includes the mock subsystem, the find/action engine, and
            the state-management model that power every example above.
          </p>

          <Link
            href="https://github.com/qontinui/qontinui"
            target="_blank"
            rel="noopener noreferrer"
            className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
          >
            <div className="flex items-start gap-4">
              <FileCode className="w-7 h-7 text-secondary flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-foreground mb-2 flex items-center gap-1">
                  qontinui (core library)
                  <span className="text-xs text-muted-foreground">↗</span>
                </h3>
                <p className="text-sm text-muted-foreground">
                  Python source for the visual automation engine — model, mock,
                  actions, and state management. See the in-repo Python examples
                  and module READMEs.
                </p>
              </div>
            </div>
          </Link>
        </section>

        {/* Repositories */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Source Repositories
          </h2>
          <div className="grid md:grid-cols-2 gap-6">
            <RepoCard
              title="qontinui-runner"
              description="Desktop runner — demo workflows and configuration samples"
              href="https://github.com/qontinui/qontinui-runner"
            />
            <RepoCard
              title="qontinui"
              description="Core Python library — model-based GUI automation engine"
              href="https://github.com/qontinui/qontinui"
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
              title="Qontinui Web"
              description="Build your own automation in the visual configuration builder"
              href="/docs/web"
            />
            <NextStepCard
              title="Mock Testing"
              description="Learn how the mock-mode examples run deterministically"
              href="/docs/web/testing"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface ExampleCardProps {
  icon: React.ReactNode;
  title: string;
  complexity: string;
  duration: string;
  demonstrates: string;
  points: string[];
  href: string;
}

function ExampleCard({
  icon,
  title,
  complexity,
  duration,
  demonstrates,
  points,
  href,
}: ExampleCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0">{icon}</div>
        <div className="flex-grow">
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <h3 className="font-semibold text-foreground text-lg">{title}</h3>
            <span className="text-xs font-medium bg-primary/10 border border-primary/30 text-primary px-2 py-0.5 rounded">
              {complexity}
            </span>
            <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {duration}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            <strong className="text-foreground">Demonstrates:</strong>{" "}
            {demonstrates}
          </p>
          <ul className="space-y-2 mb-4">
            {points.map((point, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span className="text-sm text-foreground">{point}</span>
              </li>
            ))}
          </ul>
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
          >
            <Github className="w-4 h-4" />
            View source
            <span className="text-xs">↗</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

interface ConfigCardProps {
  title: string;
  file: string;
  description: string;
}

function ConfigCard({ title, file, description }: ConfigCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <h4 className="font-semibold text-foreground">{title}</h4>
        <code className="font-mono text-xs bg-background border border-border px-1.5 py-0.5 rounded text-muted-foreground">
          {file}
        </code>
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

interface RepoCardProps {
  title: string;
  description: string;
  href: string;
}

function RepoCard({ title, description, href }: RepoCardProps) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-card border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <div className="flex items-start gap-3">
        <Github className="w-5 h-5 text-foreground flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-foreground mb-1 flex items-center gap-1">
            {title}
            <span className="text-xs text-muted-foreground">↗</span>
          </h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </Link>
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
      className="block bg-muted border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
