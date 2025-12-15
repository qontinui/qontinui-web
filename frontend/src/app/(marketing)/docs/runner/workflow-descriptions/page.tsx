import Link from "next/link";
import {
  FileText,
  Workflow,
  CheckCircle,
  AlertCircle,
  Lightbulb,
} from "lucide-react";

export const metadata = {
  title: "Workflow Descriptions - Qontinui Runner Documentation",
  description:
    "Learn how to write structured workflow descriptions that enable AI assistants to intelligently select and execute automation workflows via MCP.",
};

export default function WorkflowDescriptionsPage() {
  return (
    <div className="min-h-screen bg-white">
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        {/* Header */}
        <div className="mb-12">
          <Link
            href="/docs/runner"
            className="text-blue-600 hover:text-blue-700 text-sm mb-4 inline-block"
          >
            &larr; Back to Runner Documentation
          </Link>
          <div className="flex items-center gap-3 mb-4">
            <FileText className="w-10 h-10 text-blue-600" />
            <h1 className="text-4xl font-bold text-slate-900">
              Writing Workflow Descriptions
            </h1>
          </div>
          <p className="text-xl text-slate-600">
            Create structured descriptions that enable AI to intelligently
            select and execute your automation workflows
          </p>
        </div>

        {/* Overview */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">Overview</h2>
          <p className="text-slate-700 mb-4">
            When AI assistants like Claude control Qontinui Runner through the
            MCP (Model Context Protocol) server, they need to understand:
          </p>
          <ul className="space-y-2 text-slate-700 mb-4">
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>What each workflow does</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>When to use it</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>What order to run multiple workflows</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-purple-600 font-bold">•</span>
              <span>How to verify success or diagnose failures</span>
            </li>
          </ul>
          <p className="text-slate-700">
            <strong>Structured workflow descriptions</strong> provide this
            context in a format that both humans and AI can easily understand
            and parse.
          </p>
        </section>

        {/* Why It Matters */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Why This Matters
          </h2>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="font-semibold text-slate-900 mb-3">
              Example: AI-Driven Verification
            </h3>
            <p className="text-slate-700 mb-4">
              You make code changes to the web extraction feature and ask
              Claude:
              <em className="block mt-2 italic">
                &ldquo;Verify the extraction feature works end-to-end&rdquo;
              </em>
            </p>
            <p className="text-slate-700 mb-4">
              With good workflow descriptions, Claude will:
            </p>
            <ol className="space-y-2 text-slate-700">
              <li className="flex items-start gap-2">
                <span className="font-bold">1.</span>
                <span>Load your workflow config and read all descriptions</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">2.</span>
                <span>
                  Identify workflows related to extraction based on &ldquo;Use
                  when&rdquo; and &ldquo;Verifies&rdquo; fields
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">3.</span>
                <span>
                  Check &ldquo;Depends on&rdquo; to determine execution order
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">4.</span>
                <span>
                  Run workflows in sequence (e.g., create extraction data first,
                  then verify it displays)
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">5.</span>
                <span>Analyze results using success/failure indicators</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="font-bold">6.</span>
                <span>Report findings or autonomously fix issues</span>
              </li>
            </ol>
          </div>
        </section>

        {/* Description Format */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Structured Description Format
          </h2>
          <p className="text-slate-700 mb-4">
            Use the existing{" "}
            <code className="bg-slate-100 px-1 rounded">description</code> field
            in your workflow JSON. No schema changes or additional fields are
            required. Structure your description using this natural language
            format:
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

          <h3 className="text-lg font-semibold text-slate-900 mb-3">
            Field Reference
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-4 py-2 text-left font-semibold">
                    Field
                  </th>
                  <th className="border border-slate-300 px-4 py-2 text-left font-semibold">
                    Required
                  </th>
                  <th className="border border-slate-300 px-4 py-2 text-left font-semibold">
                    Purpose
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Summary
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    First line, clear action-oriented description of what the
                    workflow does
                  </td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Use when
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Conditions or situations when AI should choose this workflow
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Verifies
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    Recommended
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    What features or functionality this workflow tests or
                    validates
                  </td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Prerequisites
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    Recommended
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Required state before running (services running, apps open,
                    login state, etc.)
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Produces
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    Optional
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Side effects or outputs (new data created, state changes,
                    files written)
                  </td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Depends on
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    Optional
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Other workflow names that must run first (use exact names,
                    case-sensitive)
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Success indicators
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    Optional
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Observable indicators that the workflow succeeded (visible
                    UI elements, log messages, data created)
                  </td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Failure indicators
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    Optional
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Signs that something went wrong (error messages, missing
                    elements, API failures)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Examples */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">Examples</h2>

          {/* Example 1 */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Workflow className="w-5 h-5 text-blue-600" />
              Example 1: Navigation Workflow
            </h3>
            <p className="text-slate-700 mb-3 text-sm">
              A simple workflow that navigates to a page and verifies it loads
              correctly.
            </p>
            <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
              <pre>{`Clicks Build > State Machine in the website navigation menu to open the State Machine Builder page.

Use when: Need to test or verify the State Machine Builder feature, or after making changes to state machine related code (state-machine-canvas, state nodes, transitions).
Verifies: Navigation menu works, Build dropdown opens, State Machine Builder page loads, canvas renders correctly, no console errors.
Prerequisites: qontinui-web frontend running on localhost:3001, user logged in to the application, a project is selected.
Success indicators: State Machine canvas is visible, toolbar appears, no errors in browser console, URL shows /build/state-machine, page title shows "State Machine".
Failure indicators: 404 error, blank page, canvas doesn't render, console errors about missing components, navigation menu doesn't respond to clicks.`}</pre>
            </div>
          </div>

          {/* Example 2 */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Workflow className="w-5 h-5 text-green-600" />
              Example 2: Data-Producing Workflow
            </h3>
            <p className="text-slate-700 mb-3 text-sm">
              A workflow that creates new data which other workflows may depend
              on.
            </p>
            <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
              <pre>{`Opens the runner's extraction panel and performs a new web extraction on the currently visible application.

Use when: Need to create new extraction data for testing, or to verify the extraction feature works after code changes to extraction, element detection, or screenshot capture.
Verifies: Runner extraction panel opens, screenshot capture works, element detection runs, accessibility tree is parsed, states are identified and classified.
Prerequisites: qontinui-runner is running, target application is visible on screen and fully loaded, a project is loaded in the runner with valid configuration.
Produces: New extraction data (states, screenshots, element annotations, state metadata) in the current project configuration. Data is immediately available for web display.
Success indicators: Extraction completes without errors, at least one state is detected, screenshots are captured successfully, elements are annotated with bounding boxes, state names are generated.
Failure indicators: Extraction hangs or times out, no states detected ("0 items found" in logs), screenshot capture fails with permission errors, accessibility tree parse errors, Python subprocess crashes.`}</pre>
            </div>
          </div>

          {/* Example 3 */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
              <Workflow className="w-5 h-5 text-purple-600" />
              Example 3: Verification Workflow with Dependencies
            </h3>
            <p className="text-slate-700 mb-3 text-sm">
              A workflow that depends on data from another workflow.
            </p>
            <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
              <pre>{`Navigates to the Web Extraction page in the website and verifies that extraction data is displayed correctly in the UI.

Use when: After creating new extraction data, need to verify it appears correctly in the web interface. Use when testing web display logic, image rendering, or state list components.
Verifies: Web Extraction page loads, extraction data is fetched from API, images render correctly without broken image icons, state list is populated with correct count, element annotations are visible on hover.
Prerequisites: qontinui-web frontend running on localhost:3001, user logged in to the application, extraction data exists in the current project (must have run extraction first).
Depends on: "Start New Web Extraction" (if no extraction data exists yet for this project)
Success indicators: Extraction data visible in the UI, images load successfully, state count matches expected (e.g., 3 states detected), element bounding boxes render on hover, state metadata (timestamps, confidence scores) displays correctly, no API errors in network tab.
Failure indicators: Empty state list, broken image icons, "No extractions found" message appears, API returns 404 or 500 errors, network tab shows failed /api/extractions requests, images fail to load with CORS errors, state count is 0 when data should exist.`}</pre>
            </div>
          </div>
        </section>

        {/* Multi-Workflow Sequences */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Multi-Workflow Sequences
          </h2>
          <p className="text-slate-700 mb-4">
            For complex verification tasks that require multiple workflows, the{" "}
            <code className="bg-slate-100 px-1 rounded">Depends on</code> field
            enables AI to understand ordering requirements and execute workflows
            in the correct sequence.
          </p>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
            <h3 className="font-semibold text-slate-900 mb-3">
              How AI Chains Workflows
            </h3>
            <p className="text-slate-700 mb-4">
              When you ask:{" "}
              <em>&ldquo;Verify web extraction works end-to-end&rdquo;</em>
            </p>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <p className="text-slate-700">
                    <strong>Load and analyze:</strong> AI loads the workflow
                    config and reads all descriptions
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  2
                </div>
                <div>
                  <p className="text-slate-700">
                    <strong>Identify relevant workflows:</strong> Finds
                    &ldquo;Start New Web Extraction&rdquo; and &ldquo;Navigate
                    to Web Extraction Page&rdquo; based on &ldquo;Use
                    when&rdquo; and &ldquo;Verifies&rdquo; fields
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  3
                </div>
                <div>
                  <p className="text-slate-700">
                    <strong>Determine order:</strong> Sees that page
                    verification &ldquo;Depends on&rdquo; extraction workflow
                    (which &ldquo;Produces&rdquo; data)
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  4
                </div>
                <div>
                  <p className="text-slate-700">
                    <strong>Execute in sequence:</strong> Runs extraction first
                    (produces data), then page verification (consumes data)
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  5
                </div>
                <div>
                  <p className="text-slate-700">
                    <strong>Verify results:</strong> Checks success/failure
                    indicators in logs, screenshots, and API responses
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="bg-purple-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm font-bold flex-shrink-0 mt-0.5">
                  6
                </div>
                <div>
                  <p className="text-slate-700">
                    <strong>Report or fix:</strong> Reports findings and can
                    autonomously fix issues discovered during verification
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Best Practices */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-6">
            Best Practices
          </h2>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Do's */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-6">
              <h3 className="font-semibold text-green-800 mb-4 flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Do
              </h3>
              <ul className="space-y-3 text-slate-700">
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>
                    Write the summary as a clear, action-oriented first line
                    (e.g., &ldquo;Clicks the login button...&rdquo;)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>
                    Be specific about prerequisites: which services must be
                    running, ports, login state
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>
                    List concrete, observable success/failure indicators AI can
                    verify in logs or screenshots
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>
                    Use consistent terminology across all workflows in your
                    configuration
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>
                    Reference specific UI elements, page names, routes, and
                    features
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>
                    Use exact workflow names in &ldquo;Depends on&rdquo;
                    (case-sensitive)
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">✓</span>
                  <span>
                    Include specific error messages or log patterns in failure
                    indicators
                  </span>
                </li>
              </ul>
            </div>

            {/* Don'ts */}
            <div className="bg-red-50 border border-red-200 rounded-lg p-6">
              <h3 className="font-semibold text-red-800 mb-4 flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                Don&apos;t
              </h3>
              <ul className="space-y-3 text-slate-700">
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span>
                    Leave descriptions empty or use vague text like &ldquo;Tests
                    stuff&rdquo; or &ldquo;Automation workflow&rdquo;
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span>
                    Assume AI knows your application&apos;s structure, routes,
                    or component names
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span>
                    Forget to mention required login state or authentication
                    tokens
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span>
                    Use ambiguous terms like &ldquo;the page&rdquo; without
                    specifying which page
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span>
                    Skip the &ldquo;Use when&rdquo; field - it&apos;s critical
                    for AI workflow selection
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span>
                    Omit failure indicators - AI needs to diagnose what went
                    wrong
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-600 mt-0.5">✗</span>
                  <span>
                    Use generic indicators like &ldquo;check if it works&rdquo;
                    without specifics
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Writing Tips */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            <Lightbulb className="inline w-6 h-6 mr-2 text-yellow-500" />
            Writing Tips
          </h2>

          <div className="space-y-6">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
              <h3 className="font-semibold text-slate-900 mb-2">
                1. Start with the Action
              </h3>
              <p className="text-slate-700 mb-3">
                Begin your summary with an active verb that describes what the
                workflow does.
              </p>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="bg-green-50 border border-green-200 rounded p-3">
                  <p className="font-semibold text-green-800 mb-1">Good</p>
                  <p className="text-slate-700">
                    &ldquo;Clicks the Submit button and verifies the form
                    submits&rdquo;
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="font-semibold text-red-800 mb-1">Bad</p>
                  <p className="text-slate-700">
                    &ldquo;Form submission workflow&rdquo;
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
              <h3 className="font-semibold text-slate-900 mb-2">
                2. Be Specific About State
              </h3>
              <p className="text-slate-700 mb-3">
                Clearly describe what state the system should be in before and
                after the workflow.
              </p>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="bg-green-50 border border-green-200 rounded p-3">
                  <p className="font-semibold text-green-800 mb-1">Good</p>
                  <p className="text-slate-700">
                    Prerequisites: User logged in with admin role, database
                    contains test data
                    <br />
                    Produces: New project record in database with status
                    &ldquo;active&rdquo;
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="font-semibold text-red-800 mb-1">Bad</p>
                  <p className="text-slate-700">
                    Prerequisites: Logged in
                    <br />
                    Produces: New project
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
              <h3 className="font-semibold text-slate-900 mb-2">
                3. Make Indicators Observable
              </h3>
              <p className="text-slate-700 mb-3">
                Success and failure indicators should be things AI can verify in
                logs, screenshots, or API responses.
              </p>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="bg-green-50 border border-green-200 rounded p-3">
                  <p className="font-semibold text-green-800 mb-1">Good</p>
                  <p className="text-slate-700">
                    Success: &ldquo;Success message appears&rdquo;, API returns
                    200 status, log shows &ldquo;Project created&rdquo;
                    <br />
                    Failure: 404 error, blank screen, console error
                    &ldquo;Cannot read property&rdquo;
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="font-semibold text-red-800 mb-1">Bad</p>
                  <p className="text-slate-700">
                    Success: It works
                    <br />
                    Failure: Something broke
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-6">
              <h3 className="font-semibold text-slate-900 mb-2">
                4. Link Related Workflows
              </h3>
              <p className="text-slate-700 mb-3">
                Use &ldquo;Depends on&rdquo; to create workflow chains.
                Reference the exact workflow name as it appears in the config.
              </p>
              <div className="grid md:grid-cols-2 gap-4 text-sm">
                <div className="bg-green-50 border border-green-200 rounded p-3">
                  <p className="font-semibold text-green-800 mb-1">Good</p>
                  <p className="text-slate-700">
                    Depends on: &ldquo;Create Test User&rdquo; (if no test user
                    exists), &ldquo;Start Backend Server&rdquo;
                  </p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <p className="font-semibold text-red-800 mb-1">Bad</p>
                  <p className="text-slate-700">
                    Depends on: The user workflow
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* JSON Format */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            JSON Format Example
          </h2>
          <p className="text-slate-700 mb-4">
            The description is stored as a single string field in the workflow
            JSON. Use <code className="bg-slate-100 px-1 rounded">\n</code> for
            newlines:
          </p>
          <div className="bg-slate-900 text-slate-100 rounded-lg p-6 font-mono text-sm overflow-x-auto">
            <pre>{`{
  "id": "workflow-navigate-state-machine",
  "name": "Navigate to State Machine Builder",
  "description": "Clicks Build > State Machine in the website navigation menu to open the State Machine Builder page.\\n\\nUse when: Need to test or verify the State Machine Builder feature, or after making changes to state machine related code.\\nVerifies: Navigation menu works, State Machine Builder page loads, canvas renders correctly.\\nPrerequisites: Website running on localhost:3001, user logged in.\\nSuccess indicators: Canvas visible, no console errors, URL shows /build/state-machine.\\nFailure indicators: 404 error, blank page, console errors.",
  "category": "Main",
  "format": "graph",
  "version": "1.0.0",
  "actions": [
    // ... workflow actions
  ],
  "connections": {
    // ... action connections
  }
}`}</pre>
          </div>
        </section>

        {/* Workflow Categories */}
        <section className="mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Workflow Categories
          </h2>
          <p className="text-slate-700 mb-4">
            Organize workflows into categories to help AI understand their
            purpose and whether they can be executed directly:
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-slate-300 px-4 py-2 text-left font-semibold">
                    Category
                  </th>
                  <th className="border border-slate-300 px-4 py-2 text-left font-semibold">
                    Purpose
                  </th>
                  <th className="border border-slate-300 px-4 py-2 text-left font-semibold">
                    Executable
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Main
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Primary workflows for execution
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Testing
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Test verification workflows
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    UI Automation
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    UI interaction workflows
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                </tr>
                <tr className="bg-slate-50">
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Utilities
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    Helper workflows
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    <span className="text-green-600 font-semibold">Yes</span>
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 px-4 py-2 font-mono text-sm">
                    Transitions
                  </td>
                  <td className="border border-slate-300 px-4 py-2 text-slate-700">
                    State machine transitions
                  </td>
                  <td className="border border-slate-300 px-4 py-2">
                    Via state machine only
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Related Documentation */}
        <section className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-lg p-8">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Related Documentation
          </h2>
          <p className="text-slate-700 mb-6">
            Learn more about AI-powered automation with Qontinui Runner:
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Link
              href="/docs/runner/ai-integration"
              className="block bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md hover:border-purple-300 transition-all"
            >
              <h3 className="font-semibold text-slate-900 mb-1">
                AI Integration Overview
              </h3>
              <p className="text-sm text-slate-600">
                Learn how AI assistants use workflow descriptions
              </p>
            </Link>
            <Link
              href="/docs/runner/execution"
              className="block bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md hover:border-purple-300 transition-all"
            >
              <h3 className="font-semibold text-slate-900 mb-1">
                Running Automations
              </h3>
              <p className="text-sm text-slate-600">
                Execute workflows via Runner or MCP server
              </p>
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
