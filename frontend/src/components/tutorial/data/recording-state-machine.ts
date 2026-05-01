/**
 * Tutorial: Recording-Based State Machine Bootstrapping
 *
 * Informational tutorial explaining how the recording system automatically
 * discovers states and transitions by observing user interactions with a
 * UI Bridge-connected app. Covers the full pipeline from recording to
 * playbook generation.
 */

import type { Tutorial } from "@/types/tutorial";

export const recordingStateMachineTutorial: Tutorial = {
  id: "recording-state-machine",
  title: "Record Interactions to Build State Machines",
  description:
    "Learn how the recording system captures your interactions with a UI Bridge-connected app and automatically discovers states, transitions, and generates replayable playbooks — no manual configuration needed.",
  duration: "10 minutes",
  estimatedTime: 10,
  difficulty: "intermediate",
  mode: "contextual",
  focusPage: "state-machine",
  category: "State Machine",
  tags: [
    "recording",
    "state-machine",
    "discovery",
    "playbook",
    "fingerprints",
    "featured",
  ],
  learningObjectives: [
    "Understand what element fingerprints are and how they identify UI states",
    "Know the three-phase recording pipeline: capture → discover → persist",
    "Understand how the state machine enables deterministic replay without AI",
    "Know what variables and playbooks are generated from recordings",
    "Understand incremental recording and experience memory",
  ],
  steps: [
    // ========================================================================
    // Step 1: The Problem
    // ========================================================================
    {
      id: "the-problem",
      title: "The Problem: Manual State Machine Configuration",
      content:
        "State machines power qontinui's ability to navigate applications **deterministically** — without needing an LLM for every click. But traditionally, setting up a state machine required manually:\n\n" +
        "- Defining each UI state\n" +
        "- Mapping which elements belong to which state\n" +
        "- Creating transitions between states\n" +
        "- Assigning actions to transitions\n\n" +
        "The recording system **automates all of this** by watching you use the app.",
      tips: [
        "The state machine uses graph-based pathfinding (Dijkstra/A*) to navigate between states — no LLM needed for replay",
        "States are identified by element fingerprints, not brittle CSS selectors",
      ],
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 2: What Are Element Fingerprints?
    // ========================================================================
    {
      id: "element-fingerprints",
      title: "Element Fingerprints: Stable Identity",
      content:
        "The UI Bridge SDK is **embedded inside** the target application. It has access to far richer information than external tools like Playwright.\n\n" +
        "For each element, the SDK computes a **fingerprint** from five stable properties:\n\n" +
        "| Property | Example |\n" +
        "|----------|--------|\n" +
        "| Structural path | `main > form > div > button` |\n" +
        "| Position zone | `header`, `main`, `modal` |\n" +
        "| ARIA role | `button`, `textbox`, `link` |\n" +
        "| Accessible name | `Sign In`, `Email` |\n" +
        "| Size category | `icon`, `button`, `panel` |",
      details:
        "### Why Fingerprints Instead of Selectors?\n\n" +
        "CSS selectors (`#submit-btn`, `.form-row:nth-child(3)`) break when:\n" +
        "- IDs change between deploys\n" +
        "- CSS classes are renamed\n" +
        "- DOM structure is reorganized\n\n" +
        "Fingerprints survive these changes because they capture **semantic identity** — the element's role, name, and structural position — not implementation details.\n\n" +
        "### Hash Computation\n\n" +
        "The five properties are concatenated and hashed with FNV-1a to produce a 16-character hex identifier. The same algorithm runs in both TypeScript (SDK) and Python (backend) for cross-language consistency.",
      tips: [
        "Fingerprints are computed client-side in the embedded SDK — no network round-trips needed",
      ],
      estimatedDuration: 1.5,
    },

    // ========================================================================
    // Step 3: What Is a State?
    // ========================================================================
    {
      id: "what-is-a-state",
      title: "States = Groups of Co-occurring Elements",
      content:
        "A **state** is a set of elements that always appear together. The discovery system finds these groups through **co-occurrence analysis**:\n\n" +
        "1. During recording, the SDK takes **fingerprint snapshots** before and after each interaction\n" +
        "2. Each snapshot captures which fingerprints are visible\n" +
        "3. After recording stops, the system groups fingerprints that appear in **exactly the same set of snapshots**\n" +
        "4. Each group becomes a state\n\n" +
        "For example, if the `sidebar`, `nav-menu`, and `user-avatar` fingerprints always appear together, they form a **Navigation** state.",
      details:
        "### Position Zone Classification\n\n" +
        "Elements in `header` and `footer` zones are treated as **global states** — they appear in all other states and don't trigger transitions.\n\n" +
        "Elements in `modal` zones become **blocking states** — they prevent interaction with underlying states (just like a dialog overlay).\n\n" +
        "### Confidence Scoring\n\n" +
        "Each state gets a confidence score based on:\n" +
        "- How consistently the elements co-occur (30%)\n" +
        "- Number of observations (30%)\n" +
        "- Success rate of transitions involving this state (40%)",
      estimatedDuration: 1.5,
    },

    // ========================================================================
    // Step 4: The Recording Flow
    // ========================================================================
    {
      id: "recording-flow",
      title: "The Recording Flow",
      content:
        "Here's what happens when you click **Record** in the State Machine Recording panel:\n\n" +
        "1. **Start** — SDK takes an initial fingerprint snapshot of all registered elements\n" +
        "2. **Interact** — You click, type, and navigate normally. The SDK's `InteractionInterceptor` captures each action on registered elements\n" +
        '3. **Capture** — For each interaction: a "before" snapshot is taken, the DOM settles, then an "after" snapshot captures what changed\n' +
        "4. **Diff** — The system computes which fingerprints appeared and disappeared\n" +
        "5. **Stop** — All snapshots, transitions, and extracted variables are bundled into a `CooccurrenceExport`",
      targetElement: {
        selector: "[data-tutorial-id='discovery-record-tab']",
        highlightType: "border",
        position: "right",
        scrollIntoView: true,
        allowInteraction: false,
      },
      tips: [
        "The SDK only captures interactions on registered elements — mouse movements, scrolls, and focus changes are filtered out (event segmentation)",
        "Rapid keystrokes on the same input are coalesced into a single 'type' interaction",
        "Auto-save snapshots are taken every 30 seconds for crash recovery",
      ],
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 5: Variable Extraction
    // ========================================================================
    {
      id: "variable-extraction",
      title: "Automatic Variable Extraction",
      content:
        "When you type in a text field or select from a dropdown during recording, the system detects these as **variable candidates**.\n\n" +
        "For each detected variable:\n" +
        "- **fingerprint** — which element was used\n" +
        "- **inputType** — `text`, `select`, `checkbox`, etc.\n" +
        "- **enteredValue** — what you typed or selected\n" +
        "- **suggestedParamName** — derived from the field's accessible name (e.g., `emailAddress`)\n\n" +
        "Variables make recorded workflows **reusable** — you can replay with different inputs without re-recording.",
      details:
        "### How Variables Become Parameters\n\n" +
        "When a playbook is generated, each variable becomes a YAML `parameters` entry:\n\n" +
        "```yaml\n" +
        "parameters:\n" +
        "  - name: emailAddress\n" +
        "    type: string\n" +
        '    description: "Email input field"\n' +
        '    default: "user@example.com"\n' +
        "```\n\n" +
        "The generated playbook body references variables with `{{emailAddress}}` syntax.",
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 6: The Pipeline
    // ========================================================================
    {
      id: "the-pipeline",
      title: "Processing: From Recording to State Machine",
      content:
        "When you click **Discover State Machine**, the `CooccurrenceExport` is sent to the backend pipeline which runs three stages:\n\n" +
        "**Stage 1: State Discovery** (`FingerprintStateDiscovery`)\n" +
        "Groups fingerprints by co-occurrence → discovers states with confidence scores\n\n" +
        "**Stage 2: Transition Detection** (`TransitionDetector`)\n" +
        "Maps recorded actions to state changes → builds transitions with reliability tracking\n\n" +
        "**Stage 3: Persistence**\n" +
        "Saves states and transitions to PostgreSQL → available for pathfinding and export",
      details:
        "### Confidence-Based Path Costs\n\n" +
        "Each transition gets a path cost inversely proportional to its confidence: `cost = 1.0 / confidence`. This means the pathfinding algorithm (Dijkstra/A*) will prefer transitions that were observed more reliably.\n\n" +
        "### Multi-Target Pathfinding\n\n" +
        "Unlike traditional pathfinding that finds a path to one target, the state machine supports **multi-target** pathfinding — finding the optimal path that reaches ALL specified target states. This is key for workflows that need multiple panels or dialogs open simultaneously.",
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 7: What the UI Shows After Discovery
    // ========================================================================
    {
      id: "ui-after-discovery",
      title: "What You See After Discovery",
      content:
        "After the pipeline completes, the SDK Recording Panel shows:\n\n" +
        "- **State Machine Discovered** banner with state and transition counts\n" +
        "- **Interactive Graph** — states as colored nodes (green >=80% confidence, blue >=50%, gray <50%), transitions as edges with confidence-weighted stroke\n" +
        "- **States List** — each state with its name, confidence %, and modal/global badges\n" +
        "- **Generated Playbook** — markdown with YAML frontmatter, step descriptions, variable references, and transition mappings",
      tips: [
        "The graph uses dagre for hierarchical layout — states flow top-to-bottom",
        "Modal states use amber coloring to stand out",
        "Global states (header/footer) are filtered from the graph since they're always present",
      ],
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 8: Deterministic Replay
    // ========================================================================
    {
      id: "deterministic-replay",
      title: "Why This Beats LLM-Based Replay",
      content:
        "Once the state machine is populated, navigation is **pure graph traversal** — no AI needed:\n\n" +
        "```\nCurrent state: [LoginForm]\nTarget: [Dashboard]\n\nPathfinder finds: LoginForm →(submit)→ Dashboard\n\nExecute transition: click 'Sign In' button\nResult: Dashboard state active ✓\n```\n\n" +
        "This is fundamentally different from tools like Playwright or workflow-use that replay by **selector** or need **LLM fallback** when selectors break.\n\n" +
        "The state machine survives UI changes because states are identified by fingerprint composition — as long as the elements retain their semantic identity, navigation works.",
      details:
        "### Three Paradigms Compared\n\n" +
        "| Approach | Replay Method | UI Change Tolerance |\n" +
        "|----------|--------------|--------------------|\n" +
        "| Selector-based (Selenium/Playwright) | Replay cached XPaths/CSS | Breaks on DOM restructure |\n" +
        "| LLM-fallback (workflow-use) | Deterministic + AI recovery | Slow, expensive fallback |\n" +
        "| **Fingerprint state machine** | Graph traversal via pathfinding | Survives restructure if element identity holds |\n\n" +
        "The scout analysis (2026-03-30) identified this as qontinui's key architectural advantage over all scouted record-and-replay tools.",
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 9: Incremental Recording
    // ========================================================================
    {
      id: "incremental-recording",
      title: "Incremental Recording: Building Over Time",
      content:
        "You don't have to capture everything in one session. The system supports **incremental merge**:\n\n" +
        "1. **First recording** discovers states A, B, C with transitions A→B, B→C\n" +
        "2. **Second recording** (same app) discovers states B, D with transition B→D\n" +
        "3. **Merge** matches state B by fingerprint overlap (Jaccard >=0.5), unions their fingerprints, and adds the new B→D transition\n\n" +
        "Result: A richer state machine with states A, B, C, D and transitions A→B, B→C, B→D — each with updated confidence scores.\n\n" +
        "Confidence increases with each observation, and path costs decrease — the system gets **more reliable** over time.",
      tips: [
        "The merge endpoint (POST /merge) replaces old states/transitions atomically in PostgreSQL",
        "Experience memory stores past sessions by app domain for automatic retrieval on future recordings",
      ],
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 10: Experience Memory
    // ========================================================================
    {
      id: "experience-memory",
      title: "Experience Memory: Learning Across Sessions",
      content:
        "Every completed recording session is stored as **experience memory** in PostgreSQL, indexed by app domain.\n\n" +
        "When you connect to an app with past sessions, the UI shows:\n\n" +
        "- **Past recordings for this app** — state count, transition count, confidence\n" +
        '- A hint: *"New recordings will merge with discovered states via incremental merge"*\n\n' +
        "This means the system **learns your application over time** — each recording session adds to the collective understanding, just like the Agent-S experience memory pattern identified in the scout.",
      estimatedDuration: 0.5,
    },

    // ========================================================================
    // Step 11: Playbook Generation
    // ========================================================================
    {
      id: "playbook-generation",
      title: "Generated Playbooks",
      content:
        "The pipeline can optionally generate a **playbook** — a markdown file with YAML frontmatter that describes the recorded workflow:\n\n" +
        "```yaml\n" +
        "---\n" +
        'name: "Login → Dashboard"\n' +
        "category: recorded-workflow\n" +
        "context: ui-bridge\n" +
        "parameters:\n" +
        "  - name: emailAddress\n" +
        '    default: "user@example.com"\n' +
        "---\n" +
        "### Step 1: Enter email\n" +
        '- **Action**: type on "Email"\n' +
        "- **Variable**: `{{emailAddress}}`\n" +
        "### Step 2: Click submit\n" +
        "- **Transition**: LoginForm → Dashboard\n" +
        "```\n\n" +
        "Playbooks are **machine-executable** — the runner's `ExecutePlaybookHandler` reads the steps, resolves variables, and drives the state machine through transitions.",
      details:
        "### Playbook Execution Flow\n\n" +
        "1. Runner parses playbook markdown → extracts `### Step` headers, `**Transition**`, `**Action**`, `**Variable**` lines\n" +
        "2. For each step with a transition: calls `go_to_state(target)` which uses multistate pathfinding\n" +
        "3. For variables: resolves `{{name}}` from the shared variable store\n" +
        "4. Result: deterministic workflow replay with parameterized inputs",
      estimatedDuration: 1,
    },

    // ========================================================================
    // Step 12: The Full Picture
    // ========================================================================
    {
      id: "full-picture",
      title: "The Complete Pipeline",
      content:
        "Here's the end-to-end flow:\n\n" +
        "```\n" +
        "User clicks Record\n" +
        "  ↓\n" +
        "SDK captures interactions + fingerprint snapshots\n" +
        "  ↓\n" +
        "User clicks Stop → CooccurrenceExport produced\n" +
        "  ↓\n" +
        "Pipeline: FingerprintStateDiscovery → TransitionDetector → PostgreSQL\n" +
        "  ↓\n" +
        "Graph visualization + playbook generation\n" +
        "  ↓\n" +
        "State machine navigates via pathfinding (no LLM)\n" +
        "  ↓\n" +
        "Incremental merge improves confidence over time\n" +
        "```\n\n" +
        "For apps **without** the embedded SDK, the visual GUI recording path uses screenshots + accessibility trees via the HAL layer to produce the same `CooccurrenceExport` format.",
      tips: [
        "The floating recording indicator (bottom-right corner) shows when any recording is active across all pages",
        "The Graph tab in StateMachineViewer shows the discovered state machine visually",
      ],
      resources: [
        {
          title: "Recording Pipeline Source",
          url: "https://github.com/qontinui/qontinui/blob/main/qontinui/src/qontinui/state_machine/recording_pipeline.py",
        },
        {
          title: "Element Fingerprint Source",
          url: "https://github.com/qontinui/ui-bridge/blob/main/packages/ui-bridge/src/core/element-fingerprint.ts",
        },
      ],
      estimatedDuration: 0.5,
    },
  ],
};
