/**
 * Documentation Templates
 *
 * Pre-built templates for different workflow documentation categories.
 */

import type { DocumentationTemplate } from "./types";

/**
 * Get all available documentation templates
 */
export function getTemplates(): DocumentationTemplate[] {
  return [
    {
      name: "Standard Workflow",
      description: "Basic workflow documentation template",
      category: "standard",
      content: `# {workflow.name}

## Overview
{workflow.description}

## Purpose
Describe the purpose of this workflow.

## Prerequisites
- List any required setup
- Required variables
- Required states

## Steps
1. First step
2. Second step
3. Third step

## Expected Results
Describe what should happen when this workflow completes.

## Notes
Any additional notes or considerations.
`,
    },
    {
      name: "API Integration",
      description: "Template for API integration workflows",
      category: "api",
      content: `# {workflow.name} - API Integration

## API Endpoint
- **URL:**
- **Method:**
- **Authentication:**

## Request Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
|           |      |          |             |

## Response Format
\`\`\`json
{
  "example": "response"
}
\`\`\`

## Error Codes
- **200:** Success
- **400:** Bad Request
- **401:** Unauthorized
- **500:** Server Error

## Example Usage
Describe how to use this integration.
`,
    },
    {
      name: "UI Test",
      description: "Template for UI testing workflows",
      category: "ui-test",
      content: `# {workflow.name} - UI Test

## Test Objective
Describe what this test validates.

## Test Preconditions
- Browser state
- Required test data
- Initial screen/state

## Test Steps
1. [ ] Navigate to page
2. [ ] Verify element exists
3. [ ] Perform action
4. [ ] Verify result

## Expected Results
- What should be visible
- What state changes should occur
- What data should be present

## Pass/Fail Criteria
- **Pass:**
- **Fail:**

## Known Issues
List any known issues or limitations.
`,
    },
    {
      name: "Data Processing",
      description: "Template for data processing workflows",
      category: "data-processing",
      content: `# {workflow.name} - Data Processing

## Input Data
- **Format:**
- **Source:**
- **Example:**
\`\`\`json
{
  "sample": "data"
}
\`\`\`

## Processing Steps
1. **Filter:**
2. **Transform:**
3. **Aggregate:**

## Output Data
- **Format:**
- **Destination:**
- **Example:**
\`\`\`json
{
  "result": "data"
}
\`\`\`

## Data Validation
- Input validation rules
- Output validation rules

## Performance
- Expected processing time
- Data volume limits
`,
    },
    {
      name: "Error Handling",
      description: "Template for error handling workflows",
      category: "error-handling",
      content: `# {workflow.name} - Error Handling

## Error Types Handled
- **Type 1:** Description
- **Type 2:** Description
- **Type 3:** Description

## Error Detection
How errors are detected in this workflow.

## Recovery Actions
1. **For Error Type 1:**
   - Action to take
   - Fallback behavior

2. **For Error Type 2:**
   - Action to take
   - Fallback behavior

## Logging
- What is logged
- Where logs are stored
- Log format

## Notifications
- Who is notified
- When notifications are sent
- Notification format

## Retry Strategy
- Number of retries
- Retry delay
- Backoff strategy
`,
    },
  ];
}
