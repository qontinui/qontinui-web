# Workflow Documentation System

This guide covers auto-generating and maintaining workflow documentation with markdown support.

## Table of Contents

- [Overview](#overview)
- [Generating Documentation](#generating-documentation)
- [Documentation Templates](#documentation-templates)
- [Custom Documentation](#custom-documentation)
- [Export Formats](#export-formats)
- [Best Practices](#best-practices)

## Overview

The Workflow Documentation Service automatically generates comprehensive documentation from workflow structure, supports markdown formatting, and allows custom documentation sections.

### Key Features

- Auto-generate documentation from workflow
- Markdown-based documentation
- Customizable templates
- Multiple export formats (Markdown, HTML, PDF)
- Version documentation with workflow
- Include diagrams and screenshots

## Generating Documentation

### Auto-Generate Documentation

```typescript
import { workflowDocumentationService } from '@/services/workflow-documentation-service';

// Generate documentation for a workflow
const docs = workflowDocumentationService.generateDocumentation(workflow);

console.log(docs);
```

### Generated Documentation Structure

```markdown
# Workflow Name

**Description:** Workflow description here

## Overview

- **Created:** 2024-01-15
- **Last Updated:** 2024-01-16
- **Actions:** 15
- **Complexity:** Medium

## Actions

### 1. Find Login Button
**Type:** FIND
**Description:** Locate the login button on the page

**Configuration:**
- Target: Login button
- Timeout: 5000ms

### 2. Click Login
**Type:** CLICK
**Description:** Click the login button

...

## Dependencies

This workflow depends on:
- User Authentication Workflow
- Session Management Workflow

## Variables

### Input Variables
- `username` (string): User login name
- `password` (string): User password

### Output Variables
- `sessionToken` (string): Authentication token
- `userId` (string): User identifier
```

### Include Custom Sections

```typescript
// Generate with custom sections
const docs = workflowDocumentationService.generateDocumentation(workflow, {
  includeSections: [
    'overview',
    'actions',
    'dependencies',
    'variables',
    'custom'
  ],
  customSections: [
    {
      title: 'Prerequisites',
      content: 'User must be registered before running this workflow.'
    },
    {
      title: 'Expected Results',
      content: 'User should be logged in with valid session token.'
    }
  ]
});
```

## Documentation Templates

### Create Template

```typescript
// Create a documentation template
const template = workflowDocumentationService.createTemplate({
  name: 'Standard Workflow Template',
  sections: [
    {
      id: 'overview',
      title: 'Overview',
      include: true,
      template: `
## Overview

**Workflow Name:** {{workflow.name}}
**Description:** {{workflow.description}}
**Author:** {{workflow.metadata.author}}
**Created:** {{workflow.createdAt}}
      `.trim()
    },
    {
      id: 'purpose',
      title: 'Purpose',
      include: true,
      template: `
## Purpose

{{customContent.purpose}}
      `.trim()
    },
    {
      id: 'actions',
      title: 'Actions',
      include: true,
      template: `
## Actions

{{#each workflow.actions}}
### {{@index}}. {{this.name}}
**Type:** {{this.type}}
{{#if this.description}}
**Description:** {{this.description}}
{{/if}}

{{/each}}
      `.trim()
    }
  ]
});
```

### Use Template

```typescript
// Generate documentation using template
const docs = workflowDocumentationService.generateFromTemplate(
  workflow,
  template,
  {
    purpose: 'This workflow automates the login process for testing.'
  }
);
```

## Custom Documentation

### Add Custom Documentation

```typescript
// Add custom documentation to workflow
workflowDocumentationService.addCustomDocumentation(workflow.id, {
  title: 'Setup Instructions',
  content: `
## Setup

Before running this workflow:

1. Ensure user account exists
2. Verify test environment is running
3. Check network connectivity
  `.trim(),
  position: 'before-actions'
});

// Add multiple sections
workflowDocumentationService.addCustomDocumentation(workflow.id, {
  title: 'Troubleshooting',
  content: `
## Common Issues

### Login Fails
- Check credentials are correct
- Verify account is not locked

### Timeout Errors
- Increase timeout values
- Check network speed
  `.trim(),
  position: 'end'
});
```

### Markdown Support

```typescript
// Use full markdown features
const docs = `
# Workflow Documentation

## Overview

This workflow handles **user authentication** with the following features:

- Username/password login
- Session management
- Error handling

## Code Example

\`\`\`javascript
const result = await loginWorkflow.execute({
  username: 'user@example.com',
  password: 'secure123'
});
\`\`\`

## Diagram

![Login Flow](./diagrams/login-flow.png)

## Notes

> **Warning:** This workflow requires valid credentials.

## Checklist

- [ ] User registered
- [ ] Environment configured
- [ ] Network accessible
`;

workflowDocumentationService.setCustomDocumentation(workflow.id, docs);
```

## Export Formats

### Export as Markdown

```typescript
// Export documentation as markdown
const markdown = workflowDocumentationService.exportDocumentation(
  workflow.id,
  'markdown'
);

// Save to file
const blob = new Blob([markdown], { type: 'text/markdown' });
downloadFile(blob, `${workflow.name}.md`);
```

### Export as HTML

```typescript
// Export as HTML
const html = workflowDocumentationService.exportDocumentation(
  workflow.id,
  'html'
);

// HTML includes styling and formatting
const htmlWithStyles = `
<!DOCTYPE html>
<html>
<head>
  <title>${workflow.name} - Documentation</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1 { color: #333; }
    h2 { color: #666; border-bottom: 1px solid #ddd; }
    code { background: #f5f5f5; padding: 2px 6px; }
  </style>
</head>
<body>
  ${html}
</body>
</html>
`;
```

### Export as JSON

```typescript
// Export structured documentation as JSON
const json = workflowDocumentationService.exportDocumentationJSON(workflow.id);

const data = JSON.parse(json);
console.log(data.title);
console.log(data.sections);
```

## Best Practices

### Keep Documentation Updated

```typescript
// Update documentation when workflow changes
function updateWorkflow(workflow: Workflow): void {
  // Make changes
  saveWorkflow(workflow);

  // Regenerate documentation
  const docs = workflowDocumentationService.generateDocumentation(workflow);

  // Update custom sections if needed
  workflowDocumentationService.updateDocumentation(workflow.id, docs);
}
```

### Include Examples

```typescript
// Add usage examples
const exampleSection = `
## Usage Examples

### Basic Usage

\`\`\`typescript
const result = await workflow.execute({
  username: 'test@example.com',
  password: 'Test123!'
});

if (result.success) {
  console.log('Login successful:', result.sessionToken);
}
\`\`\`

### With Error Handling

\`\`\`typescript
try {
  const result = await workflow.execute(credentials);
  handleSuccess(result);
} catch (error) {
  handleError(error);
}
\`\`\`
`;

workflowDocumentationService.addCustomDocumentation(workflow.id, {
  title: 'Usage Examples',
  content: exampleSection
});
```

### Document Dependencies

```typescript
// Auto-document dependencies
const dependencies = workflowDependencyAnalyzer.getDependencies(workflow.id);

const dependencyDocs = `
## Dependencies

This workflow depends on the following workflows:

${dependencies.map(dep => `- ${dep.targetWorkflowName || dep.targetWorkflowId}`).join('\n')}

## Used By

This workflow is used by:

${dependents.map(dep => `- ${dep.sourceWorkflowName || dep.sourceWorkflowId}`).join('\n')}
`;
```

### Include Visual Diagrams

```typescript
// Add diagram references
const visualDocs = `
## Workflow Diagram

![Workflow Flow](./diagrams/${workflow.id}-flow.png)

## State Diagram

![State Transitions](./diagrams/${workflow.id}-states.png)
`;
```

### Version Documentation

```typescript
// Document each version
workflowVersionControl.saveVersion(
  workflow.id,
  branchId,
  workflow,
  'Updated login flow',
  author
);

// Generate documentation for this version
const versionDocs = workflowDocumentationService.generateDocumentation(workflow);

// Store with version
workflowVersionControl.attachDocumentation(versionId, versionDocs);
```

## Advanced Features

### Multi-Language Support

```typescript
// Generate documentation in multiple languages
const docs_en = workflowDocumentationService.generateDocumentation(workflow, {
  language: 'en',
  translations: translations_en
});

const docs_es = workflowDocumentationService.generateDocumentation(workflow, {
  language: 'es',
  translations: translations_es
});
```

### Interactive Documentation

```typescript
// Generate interactive documentation with code samples
const interactiveDocs = workflowDocumentationService.generateInteractive(workflow, {
  includeTryIt: true,
  includeCodeSamples: true,
  includeVideoWalkthrough: true
});
```

## See Also

- [Organization Guide](./organization.md) - Organize documentation
- [Version Control](./version-control.md) - Version documentation
- [Best Practices](./best-practices.md) - Documentation best practices
