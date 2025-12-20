import Link from "next/link";
import {
  Play,
  Settings,
  AlertCircle,
  CheckCircle2,
  FileJson,
} from "lucide-react";

export const metadata = {
  title: "Running Automations - Qontinui Runner Documentation",
  description:
    "Learn how to execute automation workflows with Qontinui Runner including configuration, monitoring, and troubleshooting.",
};

export default function ExecutionDocPage() {
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
            Running Automations
          </h1>
          <p className="text-xl text-muted-foreground">
            Execute your automation workflows with Qontinui Runner
          </p>
        </div>

        {/* Prerequisites */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Before You Begin
          </h2>

          <div className="space-y-4">
            <PrerequisiteCard
              icon={<FileJson className="w-5 h-5 text-primary" />}
              title="Export Configuration from Qontinui Web"
              description="Download your automation configuration as a JSON file from Qontinui Web."
              steps={[
                "Open your project in Qontinui Web",
                "Click the 'Export' button in the top menu",
                "Save the JSON file to your computer",
                "Note the file location for loading into Runner",
              ]}
            />

            <PrerequisiteCard
              icon={<Settings className="w-5 h-5 text-green-600" />}
              title="Install Qontinui Runner"
              description="Download and install Qontinui Runner for your operating system."
              link="/runner/download"
              linkText="Download Runner"
            />

            <PrerequisiteCard
              icon={<CheckCircle2 className="w-5 h-5 text-purple-600" />}
              title="Prepare Target Application"
              description="Ensure the application you're automating is running and in the expected initial state."
            />
          </div>
        </section>

        {/* Loading Configuration */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Loading Your Configuration
          </h2>

          <div className="space-y-6">
            <StepCard
              number={1}
              title="Launch Qontinui Runner"
              description="Open the Qontinui Runner application on your system."
            />

            <StepCard
              number={2}
              title="Load Configuration File"
              description="Click 'Load Configuration' and select your exported JSON file."
            />

            <StepCard
              number={3}
              title="Verify Configuration Loaded"
              description="Check that states, processes, and images appear in the Runner interface."
            />
          </div>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-foreground mb-2">
                  <strong>Configuration Validation:</strong> Runner
                  automatically validates your configuration on load. Check for
                  warnings or errors in the console output.
                </p>
                <p className="text-xs text-foreground">
                  Common issues: missing images, invalid state references,
                  malformed processes
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Execution Modes */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Execution Modes
          </h2>

          <div className="space-y-6">
            <ModeCard
              icon={<Play className="w-6 h-6 text-green-600" />}
              title="Run from Initial State"
              description="Start automation from states marked as is_initial=true"
              details={[
                "Runner identifies all initial states",
                "Verifies initial state is active (checks identifying images)",
                "Begins executing outgoing transitions",
                "Continues until final state or no transitions available",
              ]}
              bestFor="Most common mode - full automation workflows"
            />

            <ModeCard
              icon={<Play className="w-6 h-6 text-primary" />}
              title="Run Specific Process"
              description="Execute a single process by ID without state machine navigation"
              details={[
                "Select a process from the list",
                "Process actions execute sequentially",
                "No state transitions occur",
                "Useful for testing individual workflows",
              ]}
              bestFor="Testing and debugging individual processes"
            />

            <ModeCard
              icon={<Play className="w-6 h-6 text-purple-600" />}
              title="Run from Custom State"
              description="Start automation from a specific state (not necessarily initial)"
              details={[
                "Select target state from state list",
                "Runner verifies state is active",
                "Execution proceeds from that state",
                "Useful for resuming or testing specific sections",
              ]}
              bestFor="Debugging or running partial workflows"
            />
          </div>
        </section>

        {/* Execution Settings */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Execution Settings
          </h2>

          <p className="text-foreground mb-6">
            Configure how Qontinui Runner executes your automation. These
            settings are typically defined in your JSON configuration but can
            sometimes be overridden in Runner.
          </p>

          <div className="space-y-4">
            <SettingCard
              name="default_timeout"
              type="Integer (milliseconds)"
              defaultValue="10000"
              description="Maximum time to wait for actions and transitions to complete. Increase for slow applications."
            />

            <SettingCard
              name="default_retry_count"
              type="Integer"
              defaultValue="3"
              description="Number of retry attempts for failed actions. Higher values improve reliability but increase execution time."
            />

            <SettingCard
              name="action_delay"
              type="Integer (milliseconds)"
              defaultValue="100"
              description="Delay between consecutive actions. Increase if UI doesn't have time to respond between actions."
            />

            <SettingCard
              name="failure_strategy"
              type="String"
              defaultValue="stop"
              description="How to handle failures: 'stop' (halt on error), 'continue' (log and proceed), 'retry' (retry then stop)."
            />
          </div>
        </section>

        {/* Monitoring Execution */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Monitoring Execution
          </h2>

          <div className="space-y-6">
            <MonitoringFeature
              title="Real-Time Console Output"
              description="Watch execution progress with detailed logging:"
              items={[
                "Current state and active transitions",
                "Actions being executed with parameters",
                "Image recognition results and similarity scores",
                "Errors, warnings, and retry attempts",
                "Execution timing and performance metrics",
              ]}
            />

            <MonitoringFeature
              title="State Transition Visualization"
              description="See the automation flow through your state machine:"
              items={[
                "Highlighted current state(s)",
                "Executed transitions marked",
                "State history breadcrumb trail",
                "Parallel state indicators",
              ]}
            />

            <MonitoringFeature
              title="Screenshot Capture"
              description="Automatically capture screenshots during execution:"
              items={[
                "Before and after each critical action",
                "On errors or failed image recognition",
                "At state transitions for verification",
                "Saved to timestamped execution folder",
              ]}
            />
          </div>
        </section>

        {/* Common Execution Issues */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Troubleshooting Execution Issues
          </h2>

          <div className="space-y-6">
            <TroubleshootingCard
              problem="Execution stops immediately: 'Initial state not found'"
              solutions={[
                "Verify at least one state has is_initial=true in your configuration",
                "Check that initial state's identifying images match current screen",
                "Lower similarity thresholds if images aren't being recognized",
                "Ensure target application is in the expected initial state",
              ]}
            />

            <TroubleshootingCard
              problem="Actions timing out or failing repeatedly"
              solutions={[
                "Increase default_timeout for slow applications (e.g., 15000ms)",
                "Increase action_delay to give UI more time between actions",
                "Check if application is waiting for user input or has modal dialogs",
                "Verify images are still accurate and haven't changed",
                "Look for loading animations or spinners blocking interactions",
              ]}
            />

            <TroubleshootingCard
              problem="Image recognition failing: 'Image not found on screen'"
              solutions={[
                "Verify image is actually visible on current screen",
                "Lower similarity threshold (try 0.8 instead of 0.9)",
                "Recapture image if UI has changed",
                "Check if image is outside search region",
                "Enable multi-scale search if resolution differs",
                "Look for overlapping windows or notifications covering element",
              ]}
            />

            <TroubleshootingCard
              problem="State machine stuck: 'No applicable transitions found'"
              solutions={[
                "Check that current state has outgoing transitions defined",
                "Verify transition conditions are met",
                "Ensure to_state exists and is reachable",
                "Review state history to see how automation arrived at stuck state",
                "Add transitions to connect isolated states",
              ]}
            />

            <TroubleshootingCard
              problem="Execution too slow or hanging"
              solutions={[
                "Reduce default_retry_count if not needed (try 1 or 2)",
                "Decrease action_delay for faster execution (try 50ms)",
                "Use search regions to limit image search areas",
                "Disable multi-scale search if not needed",
                "Check for infinite loops in state transitions",
                "Review process complexity - break into smaller steps",
              ]}
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
              title="Test with mock execution first"
              description="Always test your automation with mock execution in Qontinui Web before running with Runner. This validates logic without requiring a real GUI environment."
            />

            <BestPractice
              title="Start with slower, more reliable settings"
              description="Use higher timeouts, more retries, and longer delays initially. Optimize for speed only after confirming reliability."
            />

            <BestPractice
              title="Monitor the first few executions"
              description="Watch execution closely the first few times. Check console output for warnings, verify image recognition scores, note timing issues."
            />

            <BestPractice
              title="Add wait actions for slow operations"
              description="After actions that trigger page loads, animations, or API calls, add explicit WAIT actions or use VANISH to wait for loading spinners."
            />

            <BestPractice
              title="Use FIND before CLICK for reliability"
              description="Always use FIND action before CLICK to verify element exists and update 'Last Find Result'. This catches missing elements early."
            />

            <BestPractice
              title="Capture execution screenshots"
              description="Enable automatic screenshot capture during execution. Screenshots are invaluable for debugging failures and verifying behavior."
            />

            <BestPractice
              title="Handle errors gracefully"
              description="Use continue_on_error for optional actions. Add error handling transitions to recover from common failure scenarios."
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
              title="Monitoring & Logs"
              description="Learn about execution logs and performance monitoring"
              href="/docs/runner/monitoring"
            />
            <NextStepCard
              title="Troubleshooting"
              description="Detailed troubleshooting guide for common issues"
              href="/docs/runner/troubleshooting"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface PrerequisiteCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  steps?: string[];
  link?: string;
  linkText?: string;
}

function PrerequisiteCard({
  icon,
  title,
  description,
  steps,
  link,
  linkText,
}: PrerequisiteCardProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-6">
      <div className="flex items-start gap-4 mb-3">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div className="flex-grow">
          <h3 className="font-semibold text-foreground mb-1">{title}</h3>
          <p className="text-sm text-muted-foreground mb-3">{description}</p>
          {steps && (
            <ol className="text-sm text-foreground space-y-1">
              {steps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-primary font-semibold">{idx + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
          {link && (
            <Link
              href={link}
              className="inline-block mt-3 text-sm text-primary hover:text-primary/80 font-semibold"
            >
              {linkText} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

interface StepCardProps {
  number: number;
  title: string;
  description: string;
}

function StepCard({ number, title, description }: StepCardProps) {
  return (
    <div className="flex gap-4">
      <div className="w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-foreground">{description}</p>
      </div>
    </div>
  );
}

interface ModeCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  details: string[];
  bestFor: string;
}

function ModeCard({
  icon,
  title,
  description,
  details,
  bestFor,
}: ModeCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-foreground mb-1">{title}</h3>
          <p className="text-muted-foreground text-sm mb-3">{description}</p>
          <ul className="space-y-1 mb-3">
            {details.map((detail, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-sm text-foreground"
              >
                <span className="text-primary">•</span>
                <span>{detail}</span>
              </li>
            ))}
          </ul>
          <div className="bg-green-500/10 border border-green-500/30 rounded px-3 py-2">
            <p className="text-xs text-foreground">
              <strong>Best for:</strong> {bestFor}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface SettingCardProps {
  name: string;
  type: string;
  defaultValue: string;
  description: string;
}

function SettingCard({
  name,
  type,
  defaultValue,
  description,
}: SettingCardProps) {
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-2">
        <h4 className="font-mono font-semibold text-foreground">{name}</h4>
        <span className="text-xs font-mono bg-muted px-2 py-1 rounded text-muted-foreground">
          {type}
        </span>
      </div>
      <p className="text-sm text-foreground mb-2">{description}</p>
      <p className="text-xs text-muted-foreground">
        Default:{" "}
        <span className="font-mono bg-muted px-1 rounded">{defaultValue}</span>
      </p>
    </div>
  );
}

interface MonitoringFeatureProps {
  title: string;
  description: string;
  items: string[];
}

function MonitoringFeature({
  title,
  description,
  items,
}: MonitoringFeatureProps) {
  return (
    <div className="bg-muted border border-border rounded-lg p-6">
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground mb-3">{description}</p>
      <ul className="space-y-1">
        {items.map((item, idx) => (
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

interface TroubleshootingCardProps {
  problem: string;
  solutions: string[];
}

function TroubleshootingCard({ problem, solutions }: TroubleshootingCardProps) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6">
      <div className="flex items-start gap-3 mb-3">
        <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
        <h3 className="font-semibold text-red-900">{problem}</h3>
      </div>
      <p className="text-xs font-semibold text-red-700 mb-2">Solutions:</p>
      <ul className="space-y-2">
        {solutions.map((solution, idx) => (
          <li key={idx} className="flex items-start gap-2 text-sm text-red-900">
            <span className="text-red-600 font-bold">•</span>
            <span>{solution}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BestPracticeProps {
  title: string;
  description: string;
}

function BestPractice({ title, description }: BestPracticeProps) {
  return (
    <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
      <h4 className="font-semibold text-foreground mb-2">{title}</h4>
      <p className="text-sm text-foreground">{description}</p>
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
      className="block bg-muted border border-border rounded-lg p-6 hover:shadow-md hover:border-primary/50 transition-all"
    >
      <h3 className="font-semibold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
    </Link>
  );
}
