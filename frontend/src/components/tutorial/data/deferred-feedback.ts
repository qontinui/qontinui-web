/**
 * Tutorial: Deferred Feedback — Autonomous Decision Review
 *
 * Informational tutorial explaining the deferred human-in-the-loop
 * feedback system. Covers what deferred questions are, how the
 * confidence gate works, where questions appear in the UI, and
 * how reviewing decisions triggers targeted rework.
 */

import type { Tutorial } from "@/types/tutorial";

export const deferredFeedbackTutorial: Tutorial = {
  id: "deferred-feedback",
  title: "Deferred Feedback: Reviewing Autonomous Decisions",
  description:
    "Understand how Qontinui records decisions during autonomous workflow execution and how you can review, approve, or reject them — even after the run completes.",
  duration: "8 minutes",
  estimatedTime: 8,
  difficulty: "intermediate",
  mode: "contextual",
  category: "AI Features",
  tags: ["autonomous", "feedback", "decisions", "review", "featured"],
  learningObjectives: [
    "Understand what deferred questions are and why they exist",
    "Know how the confidence gate decides when to ask questions",
    "Find and review deferred questions in the Decisions tab",
    "Understand what happens when you reject a decision (rework)",
    "Know how the system learns from your reviews over time",
  ],
  steps: [
    {
      id: "intro-problem",
      title: "The Overnight Problem",
      content:
        "Qontinui workflows run autonomously — often for hours, even overnight. Traditional approval gates **pause execution** and wait for a human response. If you're asleep, the workflow sits idle for 8 hours.\n\n" +
        "Deferred feedback solves this: the system **records questions** and **continues working**. You review decisions when you're ready.",
      tips: [
        "This is the default behavior — no configuration needed",
        "Blocking approval mode is still available for interactive sessions",
      ],
      estimatedDuration: 1,
    },
    {
      id: "how-it-works",
      title: "How It Works",
      content:
        "At every approval point, the system does four things:\n\n" +
        "1. **Computes confidence** — how likely is the auto-decision correct?\n" +
        "2. **Classifies risk** — is this change reversible or irreversible?\n" +
        "3. **Decides** — high confidence + low risk = silently proceed; otherwise, record a question\n" +
        "4. **Continues** — execution never pauses, regardless of the decision",
      details:
        "### Confidence Sources\n\n" +
        "- **Iteration pass/fail rate** — recent verification results\n" +
        "- **Convergence health** — is the workflow making progress?\n" +
        "- **Learned baselines** — approval rates from your past reviews\n\n" +
        "### Risk Classification\n\n" +
        "- **Low**: Reversible code changes\n" +
        "- **Medium**: Config file changes (.toml, .json, .yaml)\n" +
        "- **High**: Sensitive files (.env, Dockerfile, CI configs)\n" +
        "- **Irreversible**: Schema migrations (DROP TABLE), destructive operations\n\n" +
        "Irreversible actions **always** generate a question, regardless of confidence.",
      estimatedDuration: 1.5,
    },
    {
      id: "terminal-output",
      title: "Questions in the Terminal Output",
      content:
        "When a deferred question is created, it appears immediately in the workflow's terminal output — visible if you happen to be watching:\n\n" +
        "```\n=== DEFERRED QUESTION (Iteration 3) ===\n" +
        "Risk: MEDIUM | Confidence: 45%\n\n" +
        "The AI has completed iteration 3...\n\n" +
        "Auto-decision: Continued as planned\n" +
        "Question ID: dq-abc123\n" +
        "================================================\n```\n\n" +
        "The system assumes you're **not** watching — this is just for transparency if you are.",
      tips: [
        "Terminal output is synced to the backend, so you can see these blocks even after the run completes",
      ],
      estimatedDuration: 1,
    },
    {
      id: "floating-panel",
      title: "Real-Time: The Floating Panel",
      content:
        "If you're on the **Active Dashboard** while a workflow runs, a floating panel appears in the bottom-right corner whenever pending decisions exist.\n\n" +
        "- Shows the count of pending decisions with an amber badge\n" +
        "- Expand it to see each question with inline **Approve** / **Reject** buttons\n" +
        "- Dismiss it with the X — it reappears when a new question arrives\n" +
        "- Toast notifications pop up for each new question with risk level and confidence",
      tips: [
        "The panel only appears when there are pending questions — it's not visible otherwise",
        "You can approve/reject directly from the panel without leaving the dashboard",
      ],
      estimatedDuration: 1,
    },
    {
      id: "active-runs-badge",
      title: "Real-Time: The Badge Counter",
      content:
        "When multiple workflows run simultaneously, the **Active Runs Bar** shows a compact card for each run. An **amber badge** with a number appears on any run that has pending deferred questions.\n\n" +
        "This gives you a quick glance at which runs need attention — without interrupting your current work.",
      estimatedDuration: 0.5,
    },
    {
      id: "decisions-tab",
      title: "Post-Run: The Decisions Tab",
      content:
        "After a workflow completes (or while it's running), open the run detail page and click the **Decisions** tab.\n\n" +
        "Questions are grouped into three sections:\n" +
        "- **Pending Review** — decisions that need your input\n" +
        "- **Rejected** — decisions you overruled (rework was triggered)\n" +
        "- **Approved** — decisions you confirmed were correct\n\n" +
        "Each card shows the iteration number, risk level badge, confidence percentage, and the question text.",
      targetElement: {
        selector: '[role="tab"][value="decisions"]',
        highlightType: "spotlight",
        position: "bottom",
        allowInteraction: true,
        scrollIntoView: true,
      },
      tips: [
        "The tab appears for all runs, even if no questions were generated (it shows an empty state)",
      ],
      estimatedDuration: 1,
    },
    {
      id: "expanding-details",
      title: "Expanding Question Details",
      content:
        "Click the **chevron** on any question card to expand it and see:\n\n" +
        "- **Auto-decision** — what the system chose to do\n" +
        "- **Summary** — what the AI accomplished in that iteration\n" +
        "- **Files modified** — which files were changed\n" +
        "- **Git checkpoint** — the commit hash before the decision (for rollback)\n" +
        "- **Timestamps** — when created and when reviewed",
      estimatedDuration: 0.5,
    },
    {
      id: "approving",
      title: "Approving a Decision",
      content:
        "Click **Approve** on a pending question to confirm the system made the right call.\n\n" +
        "This is a no-op for the current run — the work is already done. But it feeds into the **learning loop**: approved decisions increase the confidence baseline for that workflow, meaning fewer questions next time.",
      tips: [
        "Use 'Approve all' to bulk-approve when the run succeeded and all decisions look correct",
      ],
      estimatedDuration: 0.5,
    },
    {
      id: "rejecting-rework",
      title: "Rejecting a Decision: Targeted Rework",
      content:
        'Click **Reject** and you\'ll be prompted for feedback: *"Why was this decision wrong?"*\n\n' +
        "This triggers **targeted rework**:\n\n" +
        "1. The codebase is **rolled back** to the git checkpoint before the rejected decision\n" +
        "2. A new **rework task run** is spawned as a child of the original\n" +
        "3. Your feedback is injected into the AI's prompt so it takes a different approach\n" +
        "4. The rework run appears in the runs list with `parent_task_run_id` linking to the original",
      details:
        "### What Gets Rolled Back\n\n" +
        "The system uses the `git_checkpoint` stored with each deferred question. This is the commit hash " +
        "captured *before* the decision was made. A `git reset --hard` to that checkpoint reverts all " +
        "changes from that iteration onward.\n\n" +
        "### Contingent Iterations\n\n" +
        "Each deferred question tracks which subsequent iterations depended on it " +
        "(`contingent_iterations` field). This tells you the blast radius of a rejection — " +
        "how much downstream work was built on top of the rejected decision.",
      estimatedDuration: 1,
    },
    {
      id: "learning-loop",
      title: "The Learning Loop",
      content:
        "After each workflow run completes, the system aggregates your approval/rejection history:\n\n" +
        "- **Approved decisions** at a given confidence level raise the threshold — fewer questions next time\n" +
        "- **Rejected decisions** lower the threshold — more questions in uncertain areas\n\n" +
        "The learned threshold is stored per-workflow in `agentic_metric_baselines`. Over time, " +
        "workflows you run frequently will generate fewer questions as the system earns your trust.",
      tips: [
        "A minimum of 5 reviewed questions is needed before the threshold adjusts",
        "The threshold is clamped between 0.30 and 0.95 to prevent extreme behavior",
        "New workflows default to confidence 0.0 (conservative — always ask)",
      ],
      estimatedDuration: 1,
    },
    {
      id: "backend-sync",
      title: "Cross-Computer Sync",
      content:
        "Deferred questions are synced to the backend database, so you can review them from **any computer** — " +
        "not just the machine running the workflow.\n\n" +
        "Sync happens automatically:\n" +
        "- When a question is created\n" +
        "- When a question is reviewed\n" +
        "- When the workflow completes\n\n" +
        "If the runner is offline, the Decisions tab falls back to the backend's synced copy.",
      estimatedDuration: 0.5,
    },
    {
      id: "summary",
      title: "Key Takeaways",
      content:
        "**Deferred feedback makes autonomy practical:**\n\n" +
        "- Workflows **never pause** — questions are recorded and displayed, but execution continues\n" +
        "- **Confidence gating** means you only see questions when the system is uncertain\n" +
        "- **Rejecting** a decision triggers targeted rework with your feedback\n" +
        "- The system **learns** from your reviews — fewer questions over time\n" +
        "- Everything is **synced** for cross-computer access\n\n" +
        "The design philosophy: *the system earns autonomy by demonstrating competence.*",
      resources: [
        {
          title: "SCOPE Framework (confidence-gated escalation)",
          url: "https://github.com/devchilll/scope",
        },
        {
          title: "Agent Inbox (structured interrupt schema)",
          url: "https://github.com/langchain-ai/agent-inbox",
        },
      ],
      estimatedDuration: 0.5,
    },
  ],
};
