import Link from "next/link";
import { Bot, Workflow, CheckCircle, AlertCircle } from "lucide-react";

export const metadata = {
  title: "AI Integration - Qontinui Runner Documentation",
  description:
    "Learn how to write workflow descriptions that enable AI assistants like Claude to intelligently select and execute automation workflows.",
};

export default function AIIntegrationPage() {
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
          <div className="flex items-center gap-3 mb-4">
            <Bot className="w-10 h-10 text-purple-600" />
            <h1 className="text-4xl font-bold text-foreground">
              AI Integration
            </h1>
          </div>
          <p className="text-xl text-muted-foreground">
            Enable AI assistants to intelligently select and execute your
            automation workflows
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">Overview</h2>
          <p className="text-foreground mb-4">
            Qontinui Runner can be controlled by AI assistants like Claude
            through the MCP (Model Context Protocol) server. For AI to make
            intelligent decisions about which workflows to run and in what
            order, your workflows need{" "}
            <strong>rich, structured descriptions</strong>.
          </p>
          <p className="text-foreground">
            This guide explains how to write workflow descriptions that AI can
            understand, enabling autonomous development workflows where AI
            verifies code changes by running your automation.
          </p>
        </section>

        {/* Why This Matters */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Why Workflow Descriptions Matter
          </h2>
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-6 mb-6">
            <p className="text-foreground">
              When you ask an AI assistant to &ldquo;verify the login feature
              works,&rdquo; it needs to understand:
            </p>
            <ul className="mt-4 space-y-2 text-foreground">
              <li className="flex items-start gap-2">
                <span className="text-purple-600 font-bold">1.</span>
                <span>Which workflows are relevant to login</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600 font-bold">2.</span>
                <span>What order to run them in</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600 font-bold">3.</span>
                <span>What prerequisites must be met</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-purple-600 font-bold">4.</span>
                <span>How to know if the verification succeeded</span>
              </li>
            </ul>
          </div>
          <p className="text-foreground">
            Good descriptions enable AI to autonomously run the right workflows,
            analyze results, and even fix issues it discovers.
          </p>
        </section>

        {/* Description Format */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Description Format
          </h2>
          <p className="text-foreground mb-4">
            Use the existing{" "}
            <code className="bg-muted px-1 rounded">description</code> field in
            your workflow. No additional fields are needed. Structure your
            description with these sections:
          </p>

          <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto mb-6">
            <pre>{`[One-line summary of what this workflow does]

Use when: [Conditions that indicate this workflow should be run]
Verifies: [What features/functionality this workflow tests]
Prerequisites: [What must be true before running]
Produces: [What state changes or outputs result from running]
Depends on: [Other workflows that must run first, if any]
Success indicators: [How to know the workflow succeeded]
Failure indicators: [Signs that something went wrong]`}</pre>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-muted">
                  <th className="border border-border px-4 py-2 text-left font-semibold">
                    Field
                  </th>
                  <th className="border border-border px-4 py-2 text-left font-semibold">
                    Required
                  </th>
                  <th className="border border-border px-4 py-2 text-left font-semibold">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Summary
                  </td>
                  <td className="border border-border px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    First line, brief description of the workflow&apos;s action
                  </td>
                </tr>
                <tr className="bg-card">
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Use when
                  </td>
                  <td className="border border-border px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    Conditions/situations when this workflow is appropriate
                  </td>
                </tr>
                <tr>
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Verifies
                  </td>
                  <td className="border border-border px-4 py-2">
                    Recommended
                  </td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    Features or functionality being tested
                  </td>
                </tr>
                <tr className="bg-card">
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Prerequisites
                  </td>
                  <td className="border border-border px-4 py-2">
                    Recommended
                  </td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    Required state before running (apps open, logged in, etc.)
                  </td>
                </tr>
                <tr>
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Produces
                  </td>
                  <td className="border border-border px-4 py-2">Optional</td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    Side effects or outputs (new data, state changes)
                  </td>
                </tr>
                <tr className="bg-card">
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Depends on
                  </td>
                  <td className="border border-border px-4 py-2">Optional</td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    Other workflow names that must run first
                  </td>
                </tr>
                <tr>
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Success indicators
                  </td>
                  <td className="border border-border px-4 py-2">Optional</td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    How to verify success (visible elements, data created)
                  </td>
                </tr>
                <tr className="bg-card">
                  <td className="border border-border px-4 py-2 font-mono text-sm">
                    Failure indicators
                  </td>
                  <td className="border border-border px-4 py-2">Optional</td>
                  <td className="border border-border px-4 py-2 text-foreground">
                    Signs of failure (error messages, missing elements)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">Examples</h2>

          {/* Example 1 */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Workflow className="w-5 h-5 text-primary" />
              Example 1: Navigation Workflow
            </h3>
            <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
              <pre>{`Clicks Build > State Machine in the website navigation menu to open the State Machine Builder page.

Use when: Need to test or verify the State Machine Builder feature, or after making changes to state machine related code.
Verifies: Navigation menu works, State Machine Builder page loads, canvas renders correctly.
Prerequisites: Website running on localhost:3001, user logged in to the application.
Success indicators: State Machine canvas is visible, no console errors, page title shows "State Machine".
Failure indicators: 404 error, blank page, console errors, navigation menu not responding.`}</pre>
            </div>
          </div>

          {/* Example 2 */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Workflow className="w-5 h-5 text-green-600" />
              Example 2: Data-Producing Workflow
            </h3>
            <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
              <pre>{`Opens the runner's extraction panel and performs a new web extraction on the currently visible application.

Use when: Need to create new extraction data for testing, or to verify the extraction feature works after code changes.
Verifies: Runner extraction panel opens, screenshot capture works, element detection runs, states are identified.
Prerequisites: Qontinui Runner is running, target application is visible on screen, a project is loaded.
Produces: New extraction data (states, images, elements) in the current project configuration.
Success indicators: Extraction completes without errors, at least one state is detected, images are captured.
Failure indicators: Extraction hangs, no states detected, "0 items found" in logs, screenshot capture fails.`}</pre>
            </div>
          </div>

          {/* Example 3 */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
              <Workflow className="w-5 h-5 text-purple-600" />
              Example 3: Workflow with Dependencies
            </h3>
            <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
              <pre>{`Navigates to the Web Extraction page in the website and verifies that extraction data is displayed correctly.

Use when: After creating new extraction data, need to verify it appears correctly in the web interface.
Verifies: Web Extraction page loads, extraction data is displayed, images render correctly, state list is populated.
Prerequisites: Website running, user logged in, extraction data exists in the project.
Depends on: "Start New Web Extraction" (if no extraction data exists yet)
Success indicators: Extraction data visible in the UI, images load, state count matches expected.
Failure indicators: Empty state list, broken images, "No extractions found" message, API errors.`}</pre>
            </div>
          </div>
        </section>

        {/* Multi-Workflow Sequences */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Multi-Workflow Sequences
          </h2>
          <p className="text-foreground mb-4">
            For complex verification tasks, AI assistants can chain multiple
            workflows together. The{" "}
            <code className="bg-muted px-1 rounded">Depends on</code> field
            helps AI understand the correct order.
          </p>

          <div className="bg-primary/10 border border-primary/30 rounded-lg p-6">
            <h3 className="font-semibold text-foreground mb-3">
              Example: End-to-End Extraction Verification
            </h3>
            <p className="text-foreground mb-4">
              When you ask AI to &ldquo;verify web extraction works
              end-to-end,&rdquo; it will:
            </p>
            <ol className="space-y-2 text-foreground">
              <li className="flex items-start gap-2">
                <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  1
                </span>
                <span>
                  Load the workflow configuration and read all descriptions
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  2
                </span>
                <span>
                  Find relevant workflows: &ldquo;Start New Web
                  Extraction&rdquo; and &ldquo;Navigate to Web Extraction
                  Page&rdquo;
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  3
                </span>
                <span>
                  Check dependencies: Page verification depends on extraction
                  data existing
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  4
                </span>
                <span>
                  Run &ldquo;Start New Web Extraction&rdquo; first, then
                  &ldquo;Navigate to Web Extraction Page&rdquo;
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0">
                  5
                </span>
                <span>
                  Analyze results using success/failure indicators and report
                  findings
                </span>
              </li>
            </ol>
          </div>
        </section>

        {/* Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-6">
            Best Practices
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-6">
              <h3 className="font-semibold text-green-800 mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Do
              </h3>
              <ul className="space-y-2 text-foreground">
                <li>
                  Write the summary as a clear, action-oriented first line
                </li>
                <li>
                  Be specific about prerequisites (which services must be
                  running)
                </li>
                <li>List concrete success/failure indicators AI can verify</li>
                <li>Use consistent terminology across workflows</li>
                <li>
                  Reference specific UI elements, page names, and features
                </li>
                <li>
                  Include the workflow name in &ldquo;Depends on&rdquo; exactly
                  as written
                </li>
              </ul>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h3 className="font-semibold text-red-800 mb-3 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Don&apos;t
              </h3>
              <ul className="space-y-2 text-foreground">
                <li>
                  Leave descriptions empty or vague (&ldquo;Tests stuff&rdquo;)
                </li>
                <li>Assume AI knows your application&apos;s structure</li>
                <li>Forget to mention required login state</li>
                <li>Use ambiguous terms without context</li>
                <li>
                  Skip the &ldquo;Use when&rdquo; field - it&apos;s essential
                  for AI selection
                </li>
                <li>
                  Omit failure indicators - AI needs to know what went wrong
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* How AI Uses Descriptions */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            How AI Uses These Descriptions
          </h2>
          <p className="text-foreground mb-4">
            When you ask an AI assistant like Claude to run automation, it
            follows this process:
          </p>

          <div className="space-y-4">
            <Step
              number={1}
              title="Load Configuration"
              description="Reads the workflow configuration file to see all available workflows"
            />
            <Step
              number={2}
              title="Parse Descriptions"
              description='Extracts "Use when" and "Verifies" fields to understand each workflow&apos;s purpose'
            />
            <Step
              number={3}
              title="Match Request"
              description="Compares your request against workflow purposes to find relevant matches"
            />
            <Step
              number={4}
              title="Check Dependencies"
              description='Reads "Depends on" fields to determine correct execution order'
            />
            <Step
              number={5}
              title="Execute Workflows"
              description="Runs workflows in sequence via the MCP server"
            />
            <Step
              number={6}
              title="Verify Results"
              description="Checks success/failure indicators in logs and screenshots"
            />
            <Step
              number={7}
              title="Report or Fix"
              description="Reports findings and can autonomously fix issues discovered during verification"
            />
          </div>
        </section>

        {/* MCP Integration */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            MCP Server Integration
          </h2>
          <p className="text-foreground mb-4">
            AI assistants interact with Qontinui Runner through the MCP (Model
            Context Protocol) server. The key commands are:
          </p>

          <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
            <pre>{`# Load a workflow configuration
mcp__qontinui__load_config("/path/to/config.json")

# Check what workflows are available
mcp__qontinui__get_loaded_config()

# Run a specific workflow
mcp__qontinui__run_workflow("Navigate to State Machine Builder")

# Run on a specific monitor
mcp__qontinui__run_workflow("My Workflow", monitor="left")`}</pre>
          </div>

          <p className="text-foreground mt-4">
            The MCP server is available as{" "}
            <code className="bg-muted px-1 rounded">qontinui-mcp</code> on PyPI
            and works with Claude Desktop, Claude Code, Cursor, and other
            MCP-compatible tools.
          </p>
        </section>

        {/* Next Steps */}
        <section className="bg-gradient-to-r from-purple-500/10 to-primary/10 border border-purple-500/30 rounded-lg p-8">
          <h2 className="text-2xl font-bold text-foreground mb-4">
            Next Steps
          </h2>
          <p className="text-foreground mb-6">
            Ready to enable AI-powered automation? Here&apos;s how to get
            started:
          </p>
          <ol className="space-y-3 text-foreground mb-6">
            <li className="flex items-start gap-2">
              <span className="font-bold">1.</span>
              <span>
                Review your existing workflows and add structured descriptions{" "}
                <Link
                  href="/docs/runner/workflow-descriptions"
                  className="text-purple-600 underline"
                >
                  (see guide)
                </Link>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold">2.</span>
              <span>
                Install the MCP server:{" "}
                <code className="bg-background/50 px-1 rounded">
                  pip install qontinui-mcp
                </code>
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold">3.</span>
              <span>Configure your AI assistant to use the MCP server</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="font-bold">4.</span>
              <span>
                Ask AI to &ldquo;verify [feature] works&rdquo; and watch it run
                the right workflows
              </span>
            </li>
          </ol>
          <div className="flex flex-wrap gap-4">
            <Link
              href="/docs/runner/workflow-descriptions"
              className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              Writing Workflow Descriptions &rarr;
            </Link>
            <Link
              href="/docs/runner/execution"
              className="inline-flex items-center gap-2 bg-background hover:bg-card text-foreground border border-border px-6 py-3 rounded-lg font-semibold transition-colors"
            >
              Running Automations
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

interface StepProps {
  number: number;
  title: string;
  description: string;
}

function Step({ number, title, description }: StepProps) {
  return (
    <div className="flex items-start gap-4 bg-card border border-border rounded-lg p-4">
      <div className="bg-purple-600 text-white rounded-full w-8 h-8 flex items-center justify-center font-bold flex-shrink-0">
        {number}
      </div>
      <div>
        <h3 className="font-semibold text-foreground">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}
