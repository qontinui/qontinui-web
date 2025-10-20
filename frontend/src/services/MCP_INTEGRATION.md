# MCP AI Integration - Complete Guide

**Version:** 1.0.0
**Last Updated:** January 2025
**Status:** Production Ready

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Getting Started](#getting-started)
4. [AI Workflow Generation](#ai-workflow-generation)
5. [Action Search](#action-search)
6. [Workflow Suggestions](#workflow-suggestions)
7. [Workflow Explanation](#workflow-explanation)
8. [Prompt Engineering](#prompt-engineering)
9. [Context Options](#context-options)
10. [Refinement Flow](#refinement-flow)
11. [Keyboard Shortcuts](#keyboard-shortcuts)
12. [Best Practices](#best-practices)
13. [Troubleshooting](#troubleshooting)
14. [API Reference](#api-reference)

---

## Overview

The MCP (Model Context Protocol) AI Integration enables natural language workflow creation in qontinui. Users can describe workflows in plain English and have them automatically generated, validated, and optimized by AI.

### Key Features

- **Natural Language Generation**: Describe workflows in plain English
- **Semantic Action Search**: Find actions using natural language
- **Context-Aware Suggestions**: AI analyzes workflows and suggests improvements
- **Iterative Refinement**: Refine workflows with feedback
- **Workflow Explanation**: Get natural language explanations of workflows
- **Template Library**: Pre-built templates for common patterns
- **Confidence Scores**: AI indicates confidence level for each generation
- **Alternative Suggestions**: Multiple workflow options to choose from

### Benefits

- **Faster Workflow Creation**: 10x faster than manual creation
- **Lower Learning Curve**: No need to learn complex UI or action types
- **Better Workflows**: AI suggests optimizations and error handling
- **Increased Productivity**: Focus on what you want, not how to build it
- **Reduced Errors**: AI validates workflows before execution

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  React Frontend                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ AI Dialog    │  │ Suggestions  │  │ Search    │ │
│  │ (Generate)   │  │ Panel        │  │ Dialog    │ │
│  └──────────────┘  └──────────────┘  └───────────┘ │
│  ┌──────────────────────────────────────────────┐  │
│  │           MCP Store (Zustand)                 │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │           MCP Client Service                  │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
                       │ HTTP/JSON
┌─────────────────────────────────────────────────────┐
│              MCP Server (Node.js)                   │
│  ┌──────────────────────────────────────────────┐  │
│  │   SQLite + FTS5 (Action Database)            │  │
│  └──────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────┐  │
│  │   AI Workflow Generator                       │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### Components

1. **MCP Client** (`mcp-client.ts`): HTTP client for MCP server
2. **MCP Store** (`mcp-store.ts`): State management
3. **AI Generation Dialog** (`AIGenerationDialog.tsx`): Main UI for generation
4. **AI Suggestions Panel** (`AISuggestions.tsx`): Context-aware suggestions
5. **AI Action Search** (`AIActionSearch.tsx`): Semantic action search
6. **Workflow Explanation** (`WorkflowExplanation.tsx`): Natural language explanation
7. **Prompt Templates** (`prompt-templates.ts`): Pre-built templates

---

## Getting Started

### Prerequisites

1. **MCP Server Running**: Ensure the qontinui MCP server is running
   ```bash
   cd qontinui-mcp
   npm start
   ```

2. **Environment Variables**: Set MCP server URL (optional)
   ```env
   VITE_MCP_URL=http://localhost:3000/mcp
   ```

### Quick Start

1. **Open AI Dialog**: Press `Ctrl+Shift+G` or click AI toolbar button
2. **Describe Workflow**: Type what you want in plain English
3. **Generate**: Click "Generate Workflow"
4. **Review**: Check the generated workflow and explanation
5. **Accept**: Click "Accept Workflow" to add to canvas

### Example

```
User: "Create a workflow that logs into Gmail by clicking login and typing credentials"

AI generates:
1. FIND action - Find login button by text
2. CLICK action - Click the login button
3. FIND action - Find email input field
4. TYPE action - Type email address
5. FIND action - Find password input field
6. TYPE action - Type password
7. FIND action - Find submit button
8. CLICK action - Click submit

Confidence: 94%
```

---

## AI Workflow Generation

### Basic Generation

The AI Generation Dialog is the primary interface for creating workflows from natural language.

**Opening the Dialog:**
- Keyboard: `Ctrl+Shift+G`
- Toolbar: Click "AI" button → "Generate Workflow"
- Canvas: Double-click empty space (if configured)

**Input Format:**

```
[Action] [Target] [Details]

Examples:
- "Click the submit button"
- "Find the login form and enter credentials"
- "Loop through all products and collect prices"
- "Take screenshot when error message appears"
```

### Prompt Structure

**Best Prompts Include:**

1. **Action Verb**: What to do (click, find, type, wait)
2. **Target**: What to interact with (button, field, image)
3. **Context**: Additional details (where, when, why)

**Good Examples:**

```
✅ "Click the blue submit button on the login form"
✅ "Wait for the loading spinner to disappear before proceeding"
✅ "Find all product prices on the page and save them to variables"
✅ "Type 'john@example.com' into the email field using CSS selector"
```

**Bad Examples:**

```
❌ "Do login stuff" (too vague)
❌ "Make it work" (no clear action)
❌ "Button click" (missing context)
```

### Confidence Scores

The AI provides a confidence score (0-100%) indicating how well it understood your request:

- **90-100%**: Very confident - Workflow is likely correct
- **70-90%**: Confident - May need minor tweaking
- **50-70%**: Uncertain - Review carefully
- **<50%**: Low confidence - Consider rephrasing prompt

### Alternative Workflows

The AI may provide alternative approaches:

```
Main Workflow (92% confidence):
- Use FIND by text to locate button

Alternative 1 (85% confidence):
- Use FIND by CSS selector for more precision

Alternative 2 (78% confidence):
- Use FIND by image matching for visual identification
```

Click on an alternative to preview it.

---

## Action Search

### Using AI Action Search

AI-powered semantic search finds actions based on meaning, not just keywords.

**Opening Search:**
- Keyboard: `Ctrl+Shift+F`
- Toolbar: Click "AI" → "AI Search"

**Search Examples:**

```
Traditional Search:      AI Search:
"CLICK"           →     "press button"
"TYPE"            →     "enter text"
"FIND"            →     "locate element"
"WAIT"            →     "pause until"
```

### Search Results

Results include:
- **Confidence Bar**: Visual indicator (green = high, yellow = medium, red = low)
- **Match Percentage**: How well the action matches your query
- **Category**: Action category (Mouse, Keyboard, Vision, etc.)
- **Description**: What the action does

### Quick Add

- **Arrow Keys**: Navigate results
- **Enter**: Add selected action to canvas
- **Mouse**: Click result to add
- **Escape**: Close search

---

## Workflow Suggestions

### Getting Suggestions

The AI analyzes your workflow and suggests improvements automatically.

**Suggestion Types:**

1. **Optimization** ⚡
   - Parallel execution opportunities
   - Performance improvements
   - Redundant action removal

2. **Error Handling** 🛡️
   - Missing try-catch blocks
   - Timeout configurations
   - Retry logic

3. **Missing Actions** ⚠️
   - Required intermediate steps
   - Validation checks
   - Cleanup actions

4. **Improvements** 📈
   - Better action choices
   - More reliable selectors
   - Enhanced logging

5. **Alternatives** 💡
   - Different approaches
   - Simpler workflows
   - More maintainable patterns

### Applying Suggestions

1. **Review**: Click suggestion to expand details
2. **Preview**: See what changes will be made
3. **Apply**: Click "Apply" to implement
4. **Dismiss**: Click "X" to ignore

### Suggestion Impact

- **High Impact** 🔴: Significant improvement, recommended
- **Medium Impact** 🟡: Moderate improvement, optional
- **Low Impact** 🟢: Minor improvement, nice-to-have

---

## Workflow Explanation

Get natural language explanations of workflows for documentation and understanding.

**Opening Explanation:**
- Keyboard: `Ctrl+Shift+E`
- Toolbar: Click "AI" → "Explain Workflow"

**Explanation Includes:**

1. **Summary**: High-level workflow description
2. **Flow Description**: How actions connect and execute
3. **Step-by-Step**: Detailed explanation of each action
4. **Potential Issues**: Warnings about possible problems
5. **Recommendations**: Suggestions for improvement

**Example:**

```
Summary:
This workflow automates login to Gmail by locating UI elements
and simulating user interactions.

Flow:
The workflow executes linearly, starting with finding the login
button, clicking it, entering credentials, and submitting the form.

Steps:
1. Find Login Button - Locates the button using text matching
   Purpose: To initiate the login process

2. Click Login Button - Simulates mouse click
   Purpose: To open the login form

...

Potential Issues:
- No error handling if button is not found
- No validation that login succeeded

Recommendations:
- Add EXISTS check before clicking
- Add screenshot capture on errors
- Implement retry logic for network issues
```

---

## Prompt Engineering

### Writing Effective Prompts

**Structure:**

```
[Create/Build/Make] a workflow that [ACTION] [TARGET] [DETAILS]

Examples:
"Create a workflow that clicks the submit button and waits for confirmation"
"Build a bot that scrapes product prices from Amazon every hour"
"Make a workflow that monitors Gmail for new emails and saves attachments"
```

### Advanced Prompts

**Conditional Logic:**

```
"If the login button exists, click it, otherwise wait 5 seconds and try again"
"Check if price is below $100, if yes buy it, if no monitor for changes"
```

**Loops:**

```
"Loop through all product cards and extract title, price, and image URL"
"For each row in the table, click edit and update the status field"
```

**Error Handling:**

```
"Try to click the button, and if it fails take a screenshot and retry 3 times"
"Download the file and handle network errors gracefully"
```

### Using Templates

Pre-built templates for common patterns:

```javascript
import { PROMPT_TEMPLATES, fillTemplate } from './prompt-templates';

// Use a template
const template = PROMPT_TEMPLATES.web_scraping;
const filled = fillTemplate(template, {
  target: 'Amazon product pages',
  data_points: 'price, rating, reviews'
});

// Result:
"Create a workflow that scrapes Amazon product pages and
extracts price, rating, reviews"
```

### Context Options

**Existing Workflow:**

```
✓ Extend existing workflow (12 actions)

AI will add to the current workflow instead of creating new
```

**Templates:**

```
☐ web_scraping
☐ automation
☑ error_handling
☐ testing

AI will use selected templates as reference
```

**Constraints:**

```javascript
{
  preferredActions: ['CLICK', 'TYPE', 'WAIT'],
  avoidActions: ['SCREENSHOT'],
  constraints: ['No parallel execution', 'Simple error handling']
}
```

---

## Refinement Flow

### Iterative Refinement

Refine generated workflows with natural language feedback.

**Process:**

1. Generate initial workflow
2. Review result
3. Provide feedback
4. AI refines workflow
5. Repeat until satisfied

**Refinement Examples:**

```
Initial: "Create a login workflow"

Refinement 1: "Add error handling"
→ AI adds try-catch blocks

Refinement 2: "Make it faster"
→ AI reduces wait times, adds parallel execution

Refinement 3: "Add logging"
→ AI adds screenshot and variable logging
```

### Feedback Types

**Add Features:**
```
"Add error handling"
"Add retry logic"
"Add screenshots on failure"
"Add validation checks"
```

**Remove/Simplify:**
```
"Remove unnecessary waits"
"Simplify the workflow"
"Remove parallel execution"
"Make it more linear"
```

**Modify:**
```
"Make it faster"
"Make it more reliable"
"Use CSS selectors instead of text"
"Add more detailed logging"
```

**Fix:**
```
"Fix the connection between actions 3 and 4"
"Fix the timeout on action 2"
"Fix the error handling"
```

---

## Keyboard Shortcuts

### Global Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+G` | Open Generate Workflow Dialog |
| `Ctrl+Shift+S` | Show Suggestions Panel |
| `Ctrl+Shift+E` | Show Explanation Panel |
| `Ctrl+Shift+F` | Open AI Action Search |
| `Ctrl+Shift+O` | Optimize Workflow |

### Dialog Shortcuts

**Generation Dialog:**
- `Enter`: Generate workflow (when text area focused and not empty)
- `Escape`: Close dialog
- `Ctrl+Enter`: Accept workflow

**Action Search:**
- `↑/↓`: Navigate results
- `Enter`: Add selected action
- `Escape`: Close search

---

## Best Practices

### Prompt Writing

1. **Be Specific**: Include details about what, where, when
2. **Use Action Verbs**: Click, find, type, wait, etc.
3. **Provide Context**: Explain the goal or purpose
4. **Start Simple**: Begin with basic workflow, then refine
5. **Use Templates**: Leverage pre-built templates for common patterns

### Workflow Review

1. **Check Confidence**: Review workflows with <80% confidence carefully
2. **Validate Connections**: Ensure actions are properly connected
3. **Test Thoroughly**: Always test generated workflows
4. **Review Error Handling**: Add error handling if not present
5. **Consider Alternatives**: Evaluate alternative workflows

### Refinement

1. **Iterate Gradually**: Make one change at a time
2. **Be Specific**: Clear feedback gets better results
3. **Save Versions**: Keep track of working versions
4. **Test After Each Refinement**: Verify changes work

### Performance

1. **Use Cache**: Let MCP client cache results
2. **Batch Requests**: Generate multiple workflows together
3. **Optimize Prompts**: Shorter, clearer prompts = faster generation
4. **Monitor Server**: Ensure MCP server is responsive

---

## Troubleshooting

### Common Issues

#### 1. MCP Server Not Connected

**Symptoms:**
- "MCP server not connected" message
- AI button is disabled
- No generation possible

**Solutions:**
```bash
# Check if server is running
curl http://localhost:3000/mcp/health

# Start server
cd qontinui-mcp
npm start

# Check logs
tail -f logs/mcp.log
```

#### 2. Low Confidence Scores

**Symptoms:**
- Generated workflows have <70% confidence
- Results don't match expectations
- AI suggests many alternatives

**Solutions:**
- Rephrase prompt with more detail
- Use templates as starting point
- Provide examples in prompt
- Add context options

#### 3. Generation Timeout

**Symptoms:**
- "Request timeout" error
- Generation takes >30 seconds
- No response from server

**Solutions:**
```javascript
// Increase timeout
const client = new MCPClient('http://localhost:3000/mcp', {
  timeout: 60000 // 60 seconds
});
```

#### 4. Invalid Workflows Generated

**Symptoms:**
- Validation errors
- Missing connections
- Orphaned actions

**Solutions:**
- Use workflow validation before accepting
- Review and manually fix issues
- Provide more specific prompt
- Use refinement to fix

#### 5. Search Returns No Results

**Symptoms:**
- No actions found
- Empty search results

**Solutions:**
- Try different search terms
- Use simpler queries
- Check MCP server has action data
- Clear cache and retry

### Debug Mode

Enable debug logging:

```javascript
// In mcp-client.ts
const DEBUG = true;

if (DEBUG) {
  console.log('MCP Request:', endpoint, data);
  console.log('MCP Response:', result);
}
```

### Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 408 | Timeout | Increase timeout or simplify request |
| 429 | Rate Limit | Wait and retry |
| 500 | Server Error | Check server logs |
| 503 | Service Unavailable | Server is down, restart it |

---

## API Reference

### MCPClient

```typescript
class MCPClient {
  constructor(baseUrl: string, options?: {
    timeout?: number;
    cacheTimeout?: number;
  });

  // Action search
  searchActions(query: string, filters?: SearchFilters): Promise<ActionResult[]>;
  getActionDetails(actionType: ActionType): Promise<ActionDetails>;
  searchByCategory(category: string): Promise<ActionResult[]>;
  getCategories(): Promise<Category[]>;

  // Workflow operations
  validateWorkflow(workflow: Workflow): Promise<ValidationResult>;
  analyzeWorkflow(workflow: Workflow): Promise<AnalysisResult>;
  generateWorkflow(description: string, context?: GenerationContext): Promise<GeneratedWorkflow>;
  refineWorkflow(workflow: Workflow, feedback: string | RefinementFeedback): Promise<GeneratedWorkflow>;
  optimizeWorkflow(workflow: Workflow, goals?: OptimizationGoal[]): Promise<GeneratedWorkflow>;

  // Suggestions
  getSuggestions(workflow: Workflow): Promise<WorkflowSuggestion[]>;
  getNextActionSuggestions(workflow: Workflow, afterActionId?: string): Promise<ActionSuggestion[]>;
  applySuggestion(workflow: Workflow, suggestion: WorkflowSuggestion): Promise<Workflow>;

  // Templates
  getTemplates(category?: string): Promise<Template[]>;
  generateFromTemplate(templateId: string, parameters?: Record<string, any>): Promise<GeneratedWorkflow>;

  // Explanation
  explainWorkflow(workflow: Workflow): Promise<ExplanationData>;
  explainAction(action: Action): Promise<ActionExplanation>;

  // Utility
  healthCheck(): Promise<HealthStatus>;
  clearCache(): void;
}
```

### MCPStore

```typescript
interface MCPStore {
  // State
  isConnected: boolean;
  isGenerating: boolean;
  generatedWorkflow: GeneratedWorkflow | null;
  suggestions: WorkflowSuggestion[];

  // Actions
  checkConnection(): Promise<void>;
  generateWorkflow(description: string, context?: GenerationContext): Promise<void>;
  refineWorkflow(workflow: Workflow, feedback: string): Promise<void>;
  getSuggestions(workflow: Workflow): Promise<void>;
  applySuggestion(workflow: Workflow, suggestion: WorkflowSuggestion): Promise<Workflow>;
  searchActions(query: string): Promise<void>;

  // UI
  openGenerationDialog(): void;
  closeGenerationDialog(): void;
  toggleSuggestionsPanel(): void;
  toggleExplanationPanel(): void;
}
```

### Types

```typescript
interface GeneratedWorkflow {
  workflow: Workflow;
  confidence: number;
  explanation: string;
  reasoning?: string[];
  alternatives?: AlternativeWorkflow[];
  suggestions?: string[];
}

interface WorkflowSuggestion {
  id: string;
  type: 'optimization' | 'error_handling' | 'missing_action' | 'improvement' | 'alternative';
  title: string;
  description: string;
  confidence: number;
  impact: 'high' | 'medium' | 'low';
  actions?: SuggestionAction[];
  preview?: Workflow;
}

interface ActionResult {
  id: string;
  type: ActionType;
  name: string;
  description: string;
  category: string;
  confidence?: number;
  parameters?: Record<string, any>;
}
```

---

## Examples

### Example 1: Simple Login Workflow

```javascript
// User prompt
const prompt = "Create a workflow that logs into Gmail";

// Generated workflow
{
  name: "Gmail Login",
  actions: [
    { type: "FIND", config: { findBy: "text", searchText: "Sign in" } },
    { type: "CLICK", config: { findBy: "text", searchText: "Sign in" } },
    { type: "WAIT", config: { duration: 2000 } },
    { type: "FIND", config: { findBy: "id", searchText: "email" } },
    { type: "TYPE", config: { text: "${email}", findBy: "id", searchText: "email" } },
    { type: "FIND", config: { findBy: "text", searchText: "Next" } },
    { type: "CLICK", config: { findBy: "text", searchText: "Next" } },
    // ... more actions
  ],
  connections: { /* ... */ }
}
```

### Example 2: Web Scraping with Loop

```javascript
// User prompt
const prompt = "Loop through all product cards and extract prices";

// Generated workflow
{
  name: "Product Price Scraper",
  actions: [
    { type: "FIND", config: { findBy: "css", searchText: ".product-card" } },
    { type: "LOOP", config: { items: "${foundElements}" } },
    { type: "FIND", config: { findBy: "css", searchText: ".price", within: "${currentItem}" } },
    { type: "SET_VARIABLE", config: { name: "prices", value: "${foundText}", append: true } },
    // ... more actions
  ]
}
```

### Example 3: Error Handling

```javascript
// User prompt
const prompt = "Click button and retry 3 times if it fails";

// Generated workflow
{
  name: "Reliable Button Click",
  actions: [
    { type: "TRY_CATCH", config: { maxRetries: 3 } },
    { type: "FIND", config: { findBy: "text", searchText: "Submit" } },
    { type: "CLICK", config: { /* ... */ } },
    { type: "SCREENSHOT", config: { onError: true } },
    // ... error handling
  ]
}
```

---

## Conclusion

The MCP AI Integration transforms workflow creation from a manual, time-consuming process into a natural, conversational experience. By leveraging AI, users can:

- Create workflows 10x faster
- Build better, more reliable workflows
- Learn qontinui faster
- Focus on goals, not implementation details

For more information:
- [MCP Server Documentation](../../../qontinui-mcp/README.md)
- [Workflow Schema](../lib/action-schema/README.md)
- [n8n Analysis](../../../docs/N8N_MCP_INTEGRATION_GUIDE.md)

---

**Last Updated:** January 2025
**Version:** 1.0.0
**Maintainer:** qontinui team
