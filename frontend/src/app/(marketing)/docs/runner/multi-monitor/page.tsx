import Link from "next/link";
import {
  Monitor,
  AlertCircle,
  CheckCircle2,
  Info,
  Lightbulb,
} from "lucide-react";

export const metadata = {
  title: "Multi-Monitor Support - Qontinui Runner Documentation",
  description:
    "Learn how to automate across multiple monitors with Qontinui Runner, including monitor selection, coordinate systems, and best practices.",
};

export default function MultiMonitorDocPage() {
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
            Multi-Monitor Support
          </h1>
          <p className="text-xl text-slate-600">
            Automate workflows across multiple displays with Qontinui Runner
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Overview</h2>
          <p className="text-slate-700 mb-4">
            Qontinui Runner provides full support for multi-monitor setups,
            allowing you to target specific displays or automate across multiple
            screens simultaneously. Whether you have a dual-monitor setup, a
            triple-monitor workstation, or an ultrawide display, the Runner
            handles coordinate mapping and screen capture seamlessly.
          </p>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-blue-900 mb-2">
                  <strong>Key Capability:</strong> The Runner can capture and
                  automate across the bounding region of multiple selected
                  monitors, treating them as a unified workspace.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            How Multi-Monitor Works
          </h2>

          <div className="space-y-6">
            <ConceptCard
              title="Virtual Desktop Coordinate System"
              description="Windows (and other operating systems) use a 'virtual desktop' coordinate system where all monitors are combined into one large coordinate space."
              details={[
                "The primary monitor is typically at position (0, 0)",
                "Other monitors have positions relative to the primary",
                "Monitors to the left may have negative X coordinates",
                "Monitors above may have negative Y coordinates",
              ]}
              example="Example: Left monitor at (-1920, 0), Primary at (0, 0), Right at (1920, 0)"
            />

            <ConceptCard
              title="Monitor Detection"
              description="The Runner automatically detects all connected monitors and their properties:"
              details={[
                "Monitor index (0, 1, 2, etc.)",
                "Physical position (x, y coordinates)",
                "Resolution (width x height)",
                "Primary monitor designation",
                "Position labels (left, middle, right)",
              ]}
            />

            <ConceptCard
              title="Bounding Region Capture"
              description="When multiple monitors are selected, the Runner captures the bounding rectangle:"
              details={[
                "Calculates minimum X and Y across all selected monitors",
                "Calculates maximum X+width and Y+height",
                "Captures the entire rectangular region containing all monitors",
                "Handles coordinate translation automatically",
              ]}
              example="Selecting left and right monitors captures all three monitors in between"
            />
          </div>
        </section>

        {/* Selecting Monitors */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Selecting Monitors
          </h2>

          <p className="text-slate-700 mb-6">
            There are several ways to specify which monitor(s) to use for
            automation:
          </p>

          <div className="space-y-4">
            <MethodCard
              title="Visual Selection (Runner UI)"
              description="Use the monitor selector in the Runner interface:"
              steps={[
                "Click on individual monitors to select/deselect",
                "Select multiple monitors for multi-monitor automation",
                "Use the 'All' button to select all monitors",
                "The interface shows monitor position, resolution, and primary status",
              ]}
              badge="Recommended"
              badgeColor="green"
            />

            <MethodCard
              title="By Position (MCP/API)"
              description="Reference monitors by their spatial position:"
              steps={[
                "'left' - Leftmost monitor in your setup",
                "'right' - Rightmost monitor",
                "'middle' - Center monitor (in 3+ monitor setups)",
                "'primary' - Your primary display",
              ]}
              example={`monitors: ['left', 'right']  // Automate across left and right displays`}
            />

            <MethodCard
              title="By Index (MCP/API)"
              description="Reference monitors by their numerical index:"
              steps={[
                "Monitor 0 - First detected monitor",
                "Monitor 1 - Second detected monitor",
                "Monitor 2 - Third detected monitor (if present)",
                "Indices are stable across sessions",
              ]}
              example={`monitors: ['0', '2']  // Automate on monitors 0 and 2`}
            />
          </div>
        </section>

        {/* Configuration */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Configuration Examples
          </h2>

          <div className="space-y-6">
            <CodeExample
              title="MCP Tool - Single Monitor"
              description="Run a workflow on a specific monitor using the MCP tool:"
              code={`mcp__qontinui__run_workflow(
  workflow_name="My Workflow",
  monitors=["left"]
)`}
            />

            <CodeExample
              title="MCP Tool - Multiple Monitors"
              description="Run a workflow across multiple monitors:"
              code={`mcp__qontinui__run_workflow(
  workflow_name="Multi-Screen Workflow",
  monitors=["left", "right"]
)`}
            />

            <CodeExample
              title="HTTP API - Monitor Indices"
              description="Use the HTTP API with monitor indices:"
              code={`POST http://localhost:9876/run-workflow
{
  "workflow_name": "Trading Dashboard",
  "monitor_indices": [0, 1, 2]
}`}
            />

            <CodeExample
              title="List Available Monitors"
              description="Query available monitors via MCP:"
              code={`mcp__qontinui__list_monitors()

// Returns:
{
  "count": 3,
  "monitors": [
    {
      "index": 0,
      "position": "left",
      "width": 1920,
      "height": 1080,
      "is_primary": false
    },
    // ...
  ]
}`}
            />
          </div>
        </section>

        {/* Use Cases */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Common Use Cases
          </h2>

          <div className="space-y-4">
            <UseCaseCard
              title="Trading Dashboards"
              description="Monitor multiple trading terminals across displays, executing trades based on signals from different screens."
              monitors="3+ monitors"
              benefit="Real-time monitoring across all displays simultaneously"
            />

            <UseCaseCard
              title="Multi-Application Workflows"
              description="Automate workflows that span multiple applications on different monitors (e.g., email on left, CRM on right)."
              monitors="2 monitors"
              benefit="Natural workspace organization without window switching"
            />

            <UseCaseCard
              title="Development Environments"
              description="Automate testing across IDE, browser, and terminal windows spread across monitors."
              monitors="2-3 monitors"
              benefit="Maintain natural development layout during automation"
            />

            <UseCaseCard
              title="Data Entry from Reference Material"
              description="Read data from a reference document on one monitor while entering it into a system on another."
              monitors="2 monitors"
              benefit="Parallel viewing of source and destination"
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
              title="Consistent Monitor Arrangement"
              description="Keep your physical monitor arrangement stable. Qontinui Runner relies on monitor positions, so moving monitors may require updating workflows."
              icon={<Lightbulb className="w-5 h-5 text-yellow-600" />}
            />

            <BestPractice
              title="Test Single Monitor First"
              description="When developing multi-monitor workflows, test on a single monitor first to ensure basic automation logic works before adding complexity."
              icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
            />

            <BestPractice
              title="Use Position Labels for Portability"
              description="Prefer 'left', 'right', 'primary' over numeric indices when possible. Position labels are more portable across different setups."
              icon={<Info className="w-5 h-5 text-blue-600" />}
            />

            <BestPractice
              title="Mind the Gaps"
              description="When selecting non-adjacent monitors (e.g., monitors 0 and 2), remember the capture includes the bounding region, which may include monitor 1."
              icon={<AlertCircle className="w-5 h-5 text-amber-600" />}
            />

            <BestPractice
              title="Account for Different Resolutions"
              description="If monitors have different resolutions or DPI scaling, test image recognition carefully. You may need to adjust similarity thresholds."
              icon={<Monitor className="w-5 h-5 text-purple-600" />}
            />
          </div>
        </section>

        {/* Troubleshooting */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Troubleshooting
          </h2>

          <div className="space-y-6">
            <TroubleshootingCard
              problem="Clicks landing on wrong monitor"
              solutions={[
                "Verify monitor selection includes the target monitor",
                "Check that monitor positions haven't changed in OS settings",
                "Restart Runner after connecting/disconnecting monitors",
                "Test with monitor_indices instead of position labels",
              ]}
            />

            <TroubleshootingCard
              problem="Image not found in multi-monitor setup"
              solutions={[
                "Ensure the monitor containing the image is selected",
                "Try selecting all monitors to eliminate selection issues",
                "Verify image was captured from the same monitor arrangement",
                "Check if DPI scaling differs between monitors",
              ]}
            />

            <TroubleshootingCard
              problem="Performance issues with multi-monitor"
              solutions={[
                "Reduce number of selected monitors to minimum required",
                "Use search regions to limit image search area",
                "Lower screenshot capture frequency if enabled",
                "Consider splitting workflow into monitor-specific segments",
              ]}
            />

            <TroubleshootingCard
              problem="Monitor position labels incorrect"
              solutions={[
                "Check Windows display settings for actual arrangement",
                "Use numeric indices as fallback",
                "Call list_monitors MCP tool to verify detected positions",
                "Primary monitor might not be leftmost - verify physically",
              ]}
            />
          </div>
        </section>

        {/* Technical Details */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Technical Details
          </h2>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
            <h3 className="font-semibold text-slate-900 mb-4">
              Coordinate System Internals
            </h3>
            <p className="text-sm text-slate-700 mb-4">
              Understanding how Qontinui Runner handles multi-monitor
              coordinates:
            </p>

            <div className="space-y-4 text-sm">
              <div>
                <h4 className="font-semibold text-slate-900 mb-1">
                  1. Virtual Desktop Origin
                </h4>
                <p className="text-slate-700 mb-2">
                  The Runner calculates the virtual desktop origin as the
                  minimum X and minimum Y coordinates across all monitors. This
                  is NOT necessarily (0, 0).
                </p>
                <code className="block bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
                  {`// Example: 3 monitors
Left:    (-1920, 702)  1920x1080
Primary: (0, 0)        3840x2160
Right:   (3840, 702)   1920x1080

Virtual Desktop Origin: (-1920, 0)
Virtual Desktop Size:    7680 x 2160`}
                </code>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-1">
                  2. Screenshot Capture
                </h4>
                <p className="text-slate-700">
                  When finding images, the Runner captures the entire bounding
                  region of selected monitors. Image coordinates are relative to
                  the virtual desktop origin, ensuring clicks land correctly
                  regardless of which monitor contains the target.
                </p>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-1">
                  3. Coordinate Translation
                </h4>
                <p className="text-slate-700">
                  The Python executor (qontinui library) handles coordinate
                  translation using MSS (multi-monitor screenshot library),
                  ensuring consistency between screenshot capture and mouse
                  positioning.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Next Steps */}
        <section className="border-t border-slate-200 pt-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Next Steps</h2>
          <div className="grid md:grid-cols-2 gap-6">
            <NextStepCard
              title="Running Automations"
              description="Learn how to execute workflows with monitor selection"
              href="/docs/runner/execution"
            />
            <NextStepCard
              title="AI Integration"
              description="Control multi-monitor automation with Claude via MCP"
              href="/docs/runner/ai-integration"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

interface ConceptCardProps {
  title: string;
  description: string;
  details?: string[];
  example?: string;
}

function ConceptCard({
  title,
  description,
  details,
  example,
}: ConceptCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <h3 className="text-lg font-bold text-slate-900 mb-2">{title}</h3>
      <p className="text-slate-700 mb-3">{description}</p>
      {details && (
        <ul className="space-y-1 mb-3">
          {details.map((detail, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2 text-sm text-slate-600"
            >
              <span className="text-blue-600">•</span>
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      )}
      {example && (
        <div className="bg-blue-50 border border-blue-200 rounded px-3 py-2">
          <p className="text-xs text-blue-900">
            <strong>Example:</strong> {example}
          </p>
        </div>
      )}
    </div>
  );
}

interface MethodCardProps {
  title: string;
  description: string;
  steps: string[];
  badge?: string;
  badgeColor?: "green" | "blue";
  example?: string;
}

function MethodCard({
  title,
  description,
  steps,
  badge,
  badgeColor = "blue",
  example,
}: MethodCardProps) {
  const badgeColors = {
    green: "bg-green-100 text-green-800",
    blue: "bg-blue-100 text-blue-800",
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
      <div className="flex items-start justify-between mb-3">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {badge && (
          <span
            className={`text-xs font-semibold px-2 py-1 rounded ${badgeColors[badgeColor]}`}
          >
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 mb-3">{description}</p>
      <ul className="space-y-1 mb-3">
        {steps.map((step, idx) => (
          <li
            key={idx}
            className="flex items-start gap-2 text-sm text-slate-700"
          >
            <span className="text-blue-600">•</span>
            <span>{step}</span>
          </li>
        ))}
      </ul>
      {example && (
        <code className="block bg-slate-900 text-slate-100 p-3 rounded font-mono text-xs">
          {example}
        </code>
      )}
    </div>
  );
}

interface CodeExampleProps {
  title: string;
  description: string;
  code: string;
}

function CodeExample({ title, description, code }: CodeExampleProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <h3 className="font-semibold text-slate-900 mb-2">{title}</h3>
      <p className="text-sm text-slate-600 mb-3">{description}</p>
      <code className="block bg-slate-900 text-slate-100 p-4 rounded font-mono text-xs whitespace-pre">
        {code}
      </code>
    </div>
  );
}

interface UseCaseCardProps {
  title: string;
  description: string;
  monitors: string;
  benefit: string;
}

function UseCaseCard({
  title,
  description,
  monitors,
  benefit,
}: UseCaseCardProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex items-start gap-3 mb-3">
        <Monitor className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <h3 className="font-semibold text-slate-900 mb-1">{title}</h3>
          <p className="text-sm text-slate-700 mb-2">{description}</p>
          <div className="flex gap-4 text-xs">
            <span className="text-slate-600">
              <strong>Monitors:</strong> {monitors}
            </span>
            <span className="text-green-700">
              <strong>Benefit:</strong> {benefit}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface BestPracticeProps {
  title: string;
  description: string;
  icon: React.ReactNode;
}

function BestPractice({ title, description, icon }: BestPracticeProps) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{icon}</div>
        <div>
          <h4 className="font-semibold text-slate-900 mb-2">{title}</h4>
          <p className="text-sm text-slate-700">{description}</p>
        </div>
      </div>
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
