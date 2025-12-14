# AI Integration for Workflow Automation

This document provides detailed guidance on writing workflow descriptions that enable AI assistants (like Claude) to intelligently select and execute automation workflows.

## Overview

Qontinui Runner can be controlled by AI assistants through the MCP (Model Context Protocol) server. For AI to make intelligent decisions about which workflows to run and in what order, workflows need **rich, structured descriptions**.

## Architecture

```
AI Assistant (Claude, etc.)
    ↓ MCP Protocol
qontinui-mcp (Python MCP Server)
    ↓ HTTP API
qontinui-runner (Tauri Desktop App, port 9876)
    ↓ Python Bridge
Qontinui Library (Automation Execution)
```

## Workflow Description Schema

### Format

Use the existing `description` field in the workflow JSON. No schema changes required. Structure descriptions using this format:

```
[One-line summary of what this workflow does]

Use when: [Conditions that indicate this workflow should be run]
Verifies: [What features/functionality this workflow tests]
Prerequisites: [What must be true before running]
Produces: [What state changes or outputs result from running]
Depends on: [Other workflows that must run first, if any]
Success indicators: [How to know the workflow succeeded]
Failure indicators: [Signs that something went wrong]
```

### Field Reference

| Field | Required | Purpose | Example |
|-------|----------|---------|---------|
| **Summary** | Yes | First line, action-oriented description | "Clicks Build > State Machine to open the builder" |
| **Use when** | Yes | When AI should choose this workflow | "Testing state machine features or after code changes" |
| **Verifies** | Recommended | Features being tested | "Navigation, page load, canvas rendering" |
| **Prerequisites** | Recommended | Required state before running | "Website on localhost:3001, user logged in" |
| **Produces** | Optional | Side effects/outputs | "New extraction data in project configuration" |
| **Depends on** | Optional | Other workflows that must run first | "Start New Web Extraction" |
| **Success indicators** | Optional | How to verify success | "Canvas visible, no console errors" |
| **Failure indicators** | Optional | Signs of failure | "404 error, blank page, console errors" |

## Complete Example

### Workflow Configuration

```json
{
  "id": "workflow-navigate-state-machine",
  "name": "Navigate to State Machine Builder",
  "description": "Clicks Build > State Machine in the website navigation menu to open the State Machine Builder page.\n\nUse when: Need to test or verify the State Machine Builder feature, or after making changes to state machine related code (state-machine-canvas, state nodes, transitions).\nVerifies: Navigation menu works, Build dropdown opens, State Machine Builder page loads, canvas renders correctly, no console errors.\nPrerequisites: qontinui-web frontend running on localhost:3001, user logged in to the application, a project is selected.\nSuccess indicators: State Machine canvas is visible, toolbar appears, no errors in browser console, URL shows /build/state-machine.\nFailure indicators: 404 error, blank page, canvas doesn't render, console errors about missing components, navigation menu doesn't respond to clicks.",
  "category": "Main",
  "format": "graph",
  "version": "1.0.0",
  "actions": [...]
}
```

### Multi-Workflow Sequence Example

For end-to-end testing that requires multiple workflows:

**Workflow 1: Start New Web Extraction**
```
Opens the runner's extraction panel and initiates a new web extraction.

Use when: Need to create new extraction data for testing.
Verifies: Runner extraction panel, screenshot capture, element detection.
Prerequisites: Runner running, target app visible, project loaded.
Produces: New extraction data (states, images, elements) in configuration.
Success indicators: Extraction completes, states detected, images captured.
Failure indicators: Extraction hangs, 0 states detected, capture fails.
```

**Workflow 2: Navigate to Web Extraction Page**
```
Navigates to the Web Extraction page and verifies data displays correctly.

Use when: After creating extraction data, need to verify web UI display.
Verifies: Page loads, extraction data displayed, images render.
Prerequisites: Website running, user logged in, extraction data exists.
Depends on: "Start New Web Extraction" (if no data exists)
Success indicators: Data visible, images load, state count matches.
Failure indicators: Empty list, broken images, API errors.
```

**AI Execution Flow:**

When asked to "verify extraction works end-to-end", AI will:

1. Read both workflow descriptions
2. See that Workflow 2 depends on Workflow 1
3. Run Workflow 1 first (produces extraction data)
4. Run Workflow 2 second (verifies data display)
5. Check success/failure indicators
6. Report findings or fix issues

## MCP Server Commands

AI assistants use these MCP commands to interact with the runner:

```python
# Load a workflow configuration
mcp__qontinui__load_config("/path/to/config.json")

# Get loaded configuration with all workflow descriptions
mcp__qontinui__get_loaded_config()

# Run a specific workflow by name
mcp__qontinui__run_workflow("Navigate to State Machine Builder")

# Run on a specific monitor
mcp__qontinui__run_workflow("My Workflow", monitor="left")

# List available monitors
mcp__qontinui__list_monitors()

# Check executor status
mcp__qontinui__get_executor_status()
```

## Autonomous Development Loop

For autonomous development with AI verification:

```
1. AI makes code changes
2. AI selects relevant verification workflows
3. AI runs workflows via MCP
4. AI analyzes results:
   - .dev-logs/ai-output.jsonl (automation output)
   - .automation-results/latest/ (screenshots)
   - Service logs for errors
5. If verification fails, AI fixes issues
6. Repeat until verification passes
```

## Best Practices

### Writing Effective Descriptions

**DO:**
- Start with a clear, action-oriented summary
- Be specific about prerequisites (running services, login state)
- List concrete success/failure indicators
- Use exact workflow names in "Depends on"
- Reference specific UI elements and page names

**DON'T:**
- Leave descriptions empty or vague
- Assume AI knows your application structure
- Use ambiguous terminology
- Skip the "Use when" field
- Omit failure indicators

### Workflow Organization

| Category | Purpose | Executable |
|----------|---------|------------|
| `Main` | Primary executable workflows | Yes |
| `Testing` | Test verification workflows | Yes |
| `UI Automation` | UI interaction workflows | Yes |
| `Utilities` | Helper workflows | Yes |
| `Transitions` | State machine transitions | Via state machine |

### Naming Conventions

- Use descriptive, action-oriented names
- Include the target (e.g., "Navigate to State Machine Builder")
- Keep names unique within a configuration
- Use consistent naming patterns

## Integration with CLAUDE.md

Projects using AI-driven automation should include workflow instructions in their `CLAUDE.md`:

```markdown
## Workflow Automation

This project uses qontinui-runner for automated testing.

### Available Workflows

- **Navigate to State Machine Builder**: Tests state machine UI
- **Start New Web Extraction**: Creates extraction data
- **Navigate to Web Extraction Page**: Verifies extraction display

### Running Verification

To verify a feature works, run the relevant workflow:
\`\`\`
mcp__qontinui__run_workflow("Navigate to State Machine Builder")
\`\`\`

Check results in `.dev-logs/` and `.automation-results/latest/`.
```

## Troubleshooting

### Common Issues

**AI doesn't select the right workflow:**
- Check that "Use when" clearly describes the use case
- Ensure "Verifies" lists the features being tested
- Use specific, unambiguous terminology

**Workflows run in wrong order:**
- Add explicit "Depends on" fields
- Use exact workflow names (case-sensitive)
- Check that dependencies produce required state

**AI can't verify success/failure:**
- Add specific, observable success indicators
- Include log messages or UI elements to check
- Reference specific error messages in failure indicators

### Debugging

Enable detailed logging to see AI decision-making:

```bash
# Check automation output
tail -f .dev-logs/ai-output.jsonl

# Check runner logs
tail -f .dev-logs/runner-backend.log

# Check execution screenshots
ls -la .automation-results/latest/
```

## Related Documentation

- [Workflow Builder Overview](./README.md)
- [Best Practices](./best-practices.md)
- [Testing Workflows](./testing.md)
- [Troubleshooting](./troubleshooting.md)
