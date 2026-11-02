# Workflow Documentation System

This guide covers generating, storing and exporting workflow documentation with `workflowDocumentation`.

## Table of Contents

- [Overview](#overview)
- [Generating Documentation](#generating-documentation)
- [Stored Documentation](#stored-documentation)
- [Documentation Templates](#documentation-templates)
- [Action Comments](#action-comments)
- [Export Formats](#export-formats)
- [Best Practices](#best-practices)

## Overview

`workflowDocumentation` (`@/services/workflow-documentation`) is the singleton instance of `WorkflowDocumentationService`. It generates markdown from a workflow's structure, keeps per-workflow documentation (with version history) and per-action comments in browser storage, and exports them.

## Generating Documentation

### Auto-Generate Documentation

```typescript
import { workflowDocumentation } from '@/services/workflow-documentation';

// Full markdown document for a workflow
const docs = workflowDocumentation.generateDocumentation(workflow);
```

### Individual Sections

Each section of the generated document is also available on its own, as markdown:

```typescript
const variables = workflowDocumentation.generateVariablesTable(workflow);
const dependencies = workflowDocumentation.generateDependenciesList(workflow);
const flowchart = workflowDocumentation.generateFlowchart(workflow); // Mermaid
```

## Stored Documentation

```typescript
// Create once, then update; every update is kept as a version
workflowDocumentation.createDocumentation(workflow.id, docs, { author: 'jane' });
workflowDocumentation.updateDocumentation(workflow.id, newDocs, 'Describe retry step');

const current = workflowDocumentation.getDocumentation(workflow.id);
const history = workflowDocumentation.getDocumentationHistory(workflow.id);

// Search across all stored documentation
const workflowIds = workflowDocumentation.findWorkflowsByDocContent('login');
```

## Documentation Templates

```typescript
// Built-in templates: name, description, category, content
const templates = workflowDocumentation.getTemplates();

// Creates the workflow's documentation from a template, by template name
const applied = workflowDocumentation.applyTemplate(workflow.id, 'Standard Workflow', workflow);
```

## Action Comments

```typescript
const comment = workflowDocumentation.addActionComment(
  workflow.id,
  actionId,
  'Waits for the login form to settle before typing',
);

const comments = workflowDocumentation.getAllActionComments(workflow.id);
```

## Export Formats

```typescript
// One workflow; returns null when it has no stored documentation
const markdown = workflowDocumentation.exportDocumentation(workflow.id, {
  format: 'markdown',
  includeTOC: true,
  includeComments: true,
});

const html = workflowDocumentation.exportDocumentation(workflow.id, { format: 'html' });

// Every stored document, or a project README covering a set of workflows
const all = workflowDocumentation.exportAllDocumentation({ format: 'markdown' });
const readme = workflowDocumentation.exportProjectReadme(workflows);
```

## Best Practices

### Keep Documentation Updated

```typescript
function refreshDocumentation(workflow: Workflow): void {
  const docs = workflowDocumentation.generateDocumentation(workflow);

  if (workflowDocumentation.hasDocumentation(workflow.id)) {
    workflowDocumentation.updateDocumentation(workflow.id, docs, 'Regenerated');
  } else {
    workflowDocumentation.createDocumentation(workflow.id, docs);
  }
}
```

## See Also

- [Organization Guide](./organization.md) - Organize workflows
- [Best Practices](./best-practices.md) - Documentation best practices
