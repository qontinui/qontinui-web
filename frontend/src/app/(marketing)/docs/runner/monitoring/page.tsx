import Link from "next/link";
import {
  FileText,
  Activity,
  AlertCircle,
  CheckCircle2,
  Database,
  Terminal,
  FolderOpen,
  Download,
} from "lucide-react";

export const metadata = {
  title: "Monitoring & Logs - Qontinui Runner Documentation",
  description:
    "Learn how to monitor automation execution, view logs, and debug issues with Qontinui Runner's comprehensive logging system.",
};

export default function MonitoringDocPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs"
            className="text-blue-600 hover:text-blue-700 text-sm mb-4 inline-block"
          >
            ← Back to Documentation
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Monitoring &amp; Logs
          </h1>
          <p className="text-xl text-slate-600">
            Monitor execution, analyze logs, and debug automation issues
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Overview</h2>
          <p className="text-slate-700 mb-4">
            Qontinui Runner provides comprehensive logging and monitoring
            capabilities to help you understand what your automation is doing,
            diagnose issues, and optimize performance.
          </p>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Activity className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-blue-900">
                  <strong>Three Types of Logs:</strong> Runner maintains
                  separate logs for general execution (info, warnings, errors),
                  image recognition results, and action execution details.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Log File Locations */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Log File Locations
          </h2>

          <p className="text-slate-700 mb-6">
            In development mode, logs are stored in the{" "}
            <code className="bg-slate-100 px-2 py-1 rounded text-sm">
              .dev-logs/
            </code>{" "}
            directory at the project root. In production, logs are stored in
            your system&apos;s application data directory.
          </p>

          <div className="space-y-4">
            <LogFileCard
              name="runner-frontend.log"
              icon={<Terminal className="w-5 h-5 text-green-600" />}
              description="Vite/React dev server output, HMR updates, and frontend console logs"
              location=".dev-logs/runner-frontend.log"
            />

            <LogFileCard
              name="runner-backend.log"
              icon={<Terminal className="w-5 h-5 text-orange-600" />}
              description="Rust/Cargo build output, tracing logs, and Python stderr"
              location=".dev-logs/runner-backend.log"
            />

            <LogFileCard
              name="runner-rust-logs/"
              icon={<FolderOpen className="w-5 h-5 text-red-600" />}
              description="Detailed Rust tracing logs (junction to AppData)"
              location=".dev-logs/runner-rust-logs/"
            />

            <LogFileCard
              name="qontinui-lib.log"
              icon={<FileText className="w-5 h-5 text-purple-600" />}
              description="Python library logs: web extraction, vision, and state detection"
              location=".dev-logs/qontinui-lib.log"
            />

            <LogFileCard
              name="ai-output.jsonl"
              icon={<Database className="w-5 h-5 text-blue-600" />}
              description="AI chat logs in JSONL format (prompts and responses)"
              location=".dev-logs/ai-output.jsonl"
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-6">
            <h4 className="font-semibold text-slate-900 mb-2 text-sm">
              Production Log Locations
            </h4>
            <ul className="space-y-1 text-sm text-slate-700">
              <li>
                <strong>Windows:</strong>{" "}
                <code className="bg-slate-100 px-1 rounded text-xs">
                  %LOCALAPPDATA%\qontinui-runner\logs\
                </code>
              </li>
              <li>
                <strong>macOS:</strong>{" "}
                <code className="bg-slate-100 px-1 rounded text-xs">
                  ~/Library/Application Support/qontinui-runner/logs/
                </code>
              </li>
              <li>
                <strong>Linux:</strong>{" "}
                <code className="bg-slate-100 px-1 rounded text-xs">
                  ~/.local/share/qontinui-runner/logs/
                </code>
              </li>
            </ul>
          </div>
        </section>

        {/* Log Levels */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Log Levels</h2>

          <p className="text-slate-700 mb-6">
            Logs are categorized by severity level. You can filter logs by level
            in the Runner UI or when viewing log files.
          </p>

          <div className="space-y-3">
            <LogLevelCard
              level="DEBUG"
              color="text-slate-600"
              bgColor="bg-slate-50"
              borderColor="border-slate-200"
              description="Detailed diagnostic information for debugging"
              examples={[
                "Python executor message parsing",
                "Image recognition scores and coordinates",
                "Internal state transitions",
              ]}
            />

            <LogLevelCard
              level="INFO"
              color="text-blue-600"
              bgColor="bg-blue-50"
              borderColor="border-blue-200"
              description="Normal execution information and progress updates"
              examples={[
                "Workflow started/completed",
                "Actions executed successfully",
                "Configuration loaded",
              ]}
            />

            <LogLevelCard
              level="WARN"
              color="text-yellow-600"
              bgColor="bg-yellow-50"
              borderColor="border-yellow-200"
              description="Warning conditions that don't prevent execution"
              examples={[
                "Image recognition below threshold",
                "Retry attempts for failed actions",
                "Health check timeouts",
              ]}
            />

            <LogLevelCard
              level="ERROR"
              color="text-red-600"
              bgColor="bg-red-50"
              borderColor="border-red-200"
              description="Error conditions that cause failures"
              examples={[
                "Python process crashed",
                "Image not found on screen",
                "Configuration validation failed",
              ]}
            />
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-6">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-blue-900 mb-2">
                  <strong>Adjusting Log Levels:</strong> Set the{" "}
                  <code className="bg-blue-100 px-1 rounded text-xs">
                    RUST_LOG
                  </code>{" "}
                  environment variable to control log verbosity.
                </p>
                <code className="block bg-blue-100 px-2 py-1 rounded text-xs text-blue-900 mt-2">
                  RUST_LOG=qontinui_runner=debug,tauri=info
                </code>
              </div>
            </div>
          </div>
        </section>

        {/* Real-Time Monitoring */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Real-Time Monitoring
          </h2>

          <p className="text-slate-700 mb-6">
            Monitor automation execution in real-time through the Runner
            UI&apos;s Logs tab, which provides three specialized log views.
          </p>

          <div className="space-y-6">
            <MonitoringViewCard
              title="General Logs"
              icon={<FileText className="w-6 h-6 text-blue-600" />}
              description="View all execution events, errors, and system messages in real-time"
              features={[
                "Filter by log level (Debug, Info, Warn, Error)",
                "Search logs by keyword",
                "Auto-scroll to follow execution",
                "Copy logs to clipboard for sharing",
                "Color-coded by severity",
              ]}
            />

            <MonitoringViewCard
              title="Image Recognition Logs"
              icon={<Activity className="w-6 h-6 text-green-600" />}
              description="Track image matching results with similarity scores and coordinates"
              features={[
                "Similarity scores for each match attempt",
                "Screen coordinates where images were found",
                "Multi-scale search results",
                "Match confidence levels",
                "Performance metrics (search time)",
              ]}
            />

            <MonitoringViewCard
              title="Action Logs"
              icon={<CheckCircle2 className="w-6 h-6 text-purple-600" />}
              description="Hierarchical view of workflow execution with action details"
              features={[
                "Tree structure showing workflow → action hierarchy",
                "Action status (success, failed, pending)",
                "Execution timestamps and duration",
                "Action parameters and results",
                "Expand/collapse for detailed inspection",
              ]}
            />
          </div>
        </section>

        {/* Health Monitoring */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Health Monitoring
          </h2>

          <p className="text-slate-700 mb-6">
            Runner includes an automatic health monitoring system that tracks
            the Python executor&apos;s responsiveness.
          </p>

          <div className="space-y-4">
            <HealthFeatureCard
              title="Ping/Pong Health Checks"
              description="Every 5 seconds, Runner sends a ping to the Python executor"
              details={[
                "Pong response expected within 3 seconds",
                "After 3 consecutive failures, executor marked as unhealthy",
                "Health status visible in UI status indicator",
              ]}
            />

            <HealthFeatureCard
              title="Process Monitoring"
              description="Runner monitors the Python subprocess for unexpected termination"
              details={[
                "Detects if Python process crashes or exits",
                "Logs stdout/stderr closure events",
                "Emits error events to frontend for user notification",
              ]}
            />

            <HealthFeatureCard
              title="Performance Tracking"
              description="Measures response latency for health checks"
              details={[
                "Ping-pong latency logged at DEBUG level",
                "Helps identify performance degradation",
                "Useful for diagnosing slow automation execution",
              ]}
            />
          </div>
        </section>

        {/* Viewing Logs */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Viewing Logs
          </h2>

          <div className="space-y-6">
            <ViewMethodCard
              title="In Runner UI (Recommended)"
              description="Use the built-in Logs tab for real-time monitoring with filtering and search"
              steps={[
                'Click the "Logs" tab in Runner',
                "Select log type: General, Image Recognition, or Actions",
                "Use filters to narrow down by level or keyword",
                "Click actions for detailed information",
              ]}
              icon={<Terminal className="w-8 h-8 text-blue-600" />}
            />

            <ViewMethodCard
              title="Via Command Line"
              description="Tail log files directly for development and debugging"
              steps={[
                "Windows PowerShell: Get-Content .dev-logs\\runner-backend.log -Tail 100 -Wait",
                "macOS/Linux: tail -f .dev-logs/runner-backend.log",
                'Search for errors: Select-String -Path .dev-logs\\runner-backend.log -Pattern "error" -CaseSensitive:$false',
              ]}
              icon={<FileText className="w-8 h-8 text-green-600" />}
            />

            <ViewMethodCard
              title="In Text Editor"
              description="Open log files in your preferred text editor for analysis"
              steps={[
                "Navigate to .dev-logs/ directory",
                "Open runner-backend.log or runner-frontend.log",
                "Search for timestamps or error patterns",
                "Use syntax highlighting for JSONL files",
              ]}
              icon={<Download className="w-8 h-8 text-purple-600" />}
            />
          </div>
        </section>

        {/* Debugging Tips */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Debugging Tips
          </h2>

          <div className="space-y-4">
            <DebuggingTip
              title="Check logs immediately after errors"
              description="The most recent logs contain crucial context about what went wrong. Look for ERROR or WARN level messages immediately before the failure."
            />

            <DebuggingTip
              title="Use log levels strategically"
              description="Start with ERROR level to find failures, then switch to WARN or INFO to see context. Use DEBUG only when you need detailed execution traces."
            />

            <DebuggingTip
              title="Search for specific patterns"
              description='Look for keywords like "failed", "timeout", "not found", "exception", or action names. This quickly narrows down the problem area.'
            />

            <DebuggingTip
              title="Compare successful vs failed runs"
              description="If an automation works sometimes and fails other times, compare logs from both scenarios to identify what's different."
            />

            <DebuggingTip
              title="Check image recognition scores"
              description="Low similarity scores (< 0.8) in Image Logs indicate images aren't matching well. This often means UI changed or image needs recapture."
            />

            <DebuggingTip
              title="Monitor health check failures"
              description="Consecutive ping timeout warnings indicate the Python executor is overloaded or stuck. This can cause overall automation slowness."
            />

            <DebuggingTip
              title="Review AI chat logs for context"
              description="The ai-output.jsonl file contains all AI interactions. This is useful for understanding what the AI agent was trying to do during TRIGGER_AI_ANALYSIS actions."
            />
          </div>
        </section>

        {/* Performance Monitoring */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Performance Monitoring
          </h2>

          <p className="text-slate-700 mb-6">
            Use logs to identify performance bottlenecks and optimize automation
            execution speed.
          </p>

          <div className="space-y-4">
            <PerformanceMetricCard
              metric="Action Duration"
              description="Action logs include execution timestamps"
              howToUse="Compare start and end times to find slow actions. Common culprits: WAIT actions, slow API calls, complex image searches."
            />

            <PerformanceMetricCard
              metric="Image Search Time"
              description="Image recognition logs show search duration"
              howToUse="Multi-scale searches take longer. Use search regions to limit area and speed up matching."
            />

            <PerformanceMetricCard
              metric="Health Check Latency"
              description="Ping-pong latency indicates executor responsiveness"
              howToUse="Rising latency over time suggests memory leaks or resource exhaustion. Restart executor if latency exceeds 500ms."
            />

            <PerformanceMetricCard
              metric="Screenshot Capture Time"
              description="Logged when screenshots are captured"
              howToUse="Slow capture (>100ms) can indicate display driver issues or high system load."
            />
          </div>
        </section>

        {/* Log Management */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Log Management
          </h2>

          <div className="space-y-4">
            <LogManagementCard
              title="Clearing Logs"
              description="Logs can be cleared from the Runner UI or by deleting log files"
              actions={[
                "UI: Click 'Clear Logs' button in Logs tab",
                "Manual: Delete files from .dev-logs/ directory",
                "AI output: Clear with clear_ai_output_log() Rust command",
              ]}
            />

            <LogManagementCard
              title="Log Rotation"
              description="Production logs rotate daily to prevent excessive disk usage"
              actions={[
                "Daily rotation: qontinui-runner.log becomes qontinui-runner.log.YYYY-MM-DD",
                "Old logs deleted automatically after 30 days",
                "Development logs (.dev-logs/) are not rotated",
              ]}
            />

            <LogManagementCard
              title="Exporting Logs"
              description="Share logs for troubleshooting or bug reports"
              actions={[
                "Copy from UI: Use 'Copy Logs' button",
                "Export file: Zip entire .dev-logs/ directory",
                "Include: Workflow config JSON for full context",
              ]}
            />
          </div>
        </section>

        {/* Common Log Patterns */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Common Log Patterns
          </h2>

          <div className="space-y-6">
            <LogPatternCard
              pattern="Image not found on screen"
              meaning="The image recognition failed to locate the target image"
              solutions={[
                "Check if the UI element is actually visible",
                "Lower similarity threshold (try 0.8 instead of 0.9)",
                "Recapture the image if UI has changed",
                "Verify the correct monitor is being searched",
              ]}
            />

            <LogPatternCard
              pattern="Pong timeout: no response for X seconds"
              meaning="Python executor is not responding to health checks"
              solutions={[
                "Executor may be stuck in a long-running operation",
                "Check for infinite loops in workflow logic",
                "Increase timeout if operations are legitimately slow",
                "Restart Runner if timeouts persist",
              ]}
            />

            <LogPatternCard
              pattern="Failed to parse executor message"
              meaning="Rust couldn't parse JSON from Python stdout"
              solutions={[
                "Check for Python print statements (use stderr instead)",
                "Verify Python is outputting valid JSON",
                "Look for stack traces mixed with JSON output",
                "Update qontinui library if format changed",
              ]}
            />

            <LogPatternCard
              pattern="Python process stdout closed unexpectedly"
              meaning="Python executor terminated without clean shutdown"
              solutions={[
                "Check Python logs for exceptions or errors",
                "Verify Python dependencies are installed",
                "Look for segmentation faults or crashes",
                "Check for uncaught exceptions in workflow code",
              ]}
            />
          </div>
        </section>

        {/* Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Best Practices
          </h2>

          <div className="space-y-4">
            <BestPractice
              title="Keep logs open during development"
              description="Always have the Logs tab visible when testing new workflows. This lets you see errors immediately and understand execution flow."
            />

            <BestPractice
              title="Use INFO level for production"
              description="DEBUG level generates excessive output and can slow execution. INFO level provides sufficient detail for most scenarios."
            />

            <BestPractice
              title="Review logs after every automation run"
              description="Even successful runs may have warnings that indicate potential issues. Check for retry attempts or low similarity scores."
            />

            <BestPractice
              title="Archive logs for debugging sessions"
              description="Before troubleshooting, copy the entire .dev-logs/ directory. This preserves the exact state for analysis."
            />

            <BestPractice
              title="Search before scrolling"
              description="Don't scroll through thousands of log lines. Use search functionality to find relevant entries quickly."
            />

            <BestPractice
              title="Correlate logs with screenshots"
              description="When debugging, review screenshots alongside logs. Screenshots show what the automation saw, logs show what it decided to do."
            />
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-slate-200 pt-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Next Steps</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Troubleshooting Guide"
              description="Detailed solutions for common automation issues"
              href="/docs/runner/troubleshooting"
            />
            <NextStepCard
              title="AI Integration"
              description="Enable AI assistants to select and run workflows"
              href="/docs/runner/ai-integration"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface LogFileCardProps {
  name: string;
  icon: React.ReactNode;
  description: string;
  location: string;
}

function LogFileCard({ name, icon, description, location }: LogFileCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start gap-3 mb-2">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div className="flex-grow">
          <h4 className="font-mono font-semibold text-slate-900 text-sm">
            {name}
          </h4>
          <p className="text-sm text-slate-600 mt-1">{description}</p>
          <code className="block bg-slate-50 px-2 py-1 rounded text-xs text-slate-700 mt-2 font-mono">
            {location}
          </code>
        </div>
      </div>
    </div>
  );
}

interface LogLevelCardProps {
  level: string;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
  examples: string[];
}

function LogLevelCard({
  level,
  color,
  bgColor,
  borderColor,
  description,
  examples,
}: LogLevelCardProps) {
  return (
    <div className={`border rounded-lg p-4 ${bgColor} ${borderColor}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className={`font-mono font-bold ${color} text-sm`}>{level}</span>
      </div>
      <p className="text-sm text-slate-700 mb-2">{description}</p>
      <div className="text-xs text-slate-600 space-y-1">
        <p className="font-semibold">Examples:</p>
        <ul className="space-y-1 ml-4">
          {examples.map((example, idx) => (
            <li key={idx} className="list-disc">
              {example}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

interface MonitoringViewCardProps {
  title: string;
  icon: React.ReactNode;
  description: string;
  features: string[];
}

function MonitoringViewCard({
  title,
  icon,
  description,
  features,
}: MonitoringViewCardProps) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
      <div className="flex items-start gap-4 mb-3">
        <div className="flex-shrink-0 mt-1">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">{title}</h3>
          <p className="text-sm text-slate-600 mb-3">{description}</p>
          <ul className="space-y-1">
            {features.map((feature, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-sm text-slate-700"
              >
                <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface HealthFeatureCardProps {
  title: string;
  description: string;
  details: string[];
}

function HealthFeatureCard({
  title,
  description,
  details,
}: HealthFeatureCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h4 className="font-semibold text-slate-900 mb-2">{title}</h4>
      <p className="text-sm text-slate-600 mb-3">{description}</p>
      <ul className="space-y-1">
        {details.map((detail, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-sm text-slate-700"
          >
            <span className="text-blue-600">•</span>
            <span>{detail}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ViewMethodCardProps {
  title: string;
  description: string;
  steps: string[];
  icon: React.ReactNode;
}

function ViewMethodCard({
  title,
  description,
  steps,
  icon,
}: ViewMethodCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-shrink-0">{icon}</div>
        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-1">{title}</h3>
          <p className="text-sm text-slate-600 mb-3">{description}</p>
          <div className="space-y-2">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="text-blue-600 font-semibold text-sm">
                  {idx + 1}.
                </span>
                <code className="text-xs bg-slate-100 px-2 py-1 rounded flex-grow">
                  {step}
                </code>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DebuggingTipProps {
  title: string;
  description: string;
}

function DebuggingTip({ title, description }: DebuggingTipProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <h4 className="font-semibold text-green-900 mb-2">{title}</h4>
      <p className="text-sm text-green-800">{description}</p>
    </div>
  );
}

interface PerformanceMetricCardProps {
  metric: string;
  description: string;
  howToUse: string;
}

function PerformanceMetricCard({
  metric,
  description,
  howToUse,
}: PerformanceMetricCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h4 className="font-semibold text-slate-900 mb-1">{metric}</h4>
      <p className="text-sm text-slate-600 mb-2">{description}</p>
      <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2">
        <p className="text-xs text-blue-900">
          <strong>How to use:</strong> {howToUse}
        </p>
      </div>
    </div>
  );
}

interface LogManagementCardProps {
  title: string;
  description: string;
  actions: string[];
}

function LogManagementCard({
  title,
  description,
  actions,
}: LogManagementCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h4 className="font-semibold text-slate-900 mb-2">{title}</h4>
      <p className="text-sm text-slate-600 mb-3">{description}</p>
      <ul className="space-y-1">
        {actions.map((action, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-sm text-slate-700"
          >
            <span className="text-blue-600">•</span>
            <span>{action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LogPatternCardProps {
  pattern: string;
  meaning: string;
  solutions: string[];
}

function LogPatternCard({ pattern, meaning, solutions }: LogPatternCardProps) {
  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
      <div className="flex items-start gap-3 mb-3">
        <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
        <div>
          <code className="font-mono font-semibold text-yellow-900 text-sm block mb-2">
            {pattern}
          </code>
          <p className="text-sm text-yellow-800 mb-3">
            <strong>Meaning:</strong> {meaning}
          </p>
          <p className="text-xs font-semibold text-yellow-700 mb-2">
            Solutions:
          </p>
          <ul className="space-y-2">
            {solutions.map((solution, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-sm text-yellow-900"
              >
                <span className="text-yellow-600 font-bold">•</span>
                <span>{solution}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

interface BestPracticeProps {
  title: string;
  description: string;
}

function BestPractice({ title, description }: BestPracticeProps) {
  return (
    <div className="bg-green-50 border border-green-200 rounded-lg p-4">
      <h4 className="font-semibold text-green-900 mb-2">{title}</h4>
      <p className="text-sm text-green-800">{description}</p>
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
      className="block bg-slate-50 border border-slate-200 rounded-lg p-6 hover:shadow-md hover:border-blue-300 transition-all"
    >
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600">{description}</p>
    </Link>
  );
}
