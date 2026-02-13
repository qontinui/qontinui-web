/**
 * Documentation Exporter
 *
 * Handles exporting documentation in various formats (markdown, HTML, PDF)
 * and generating project-level README documentation.
 */

import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  WorkflowDocumentation,
  ActionComment,
  ExportOptions,
} from "./types";
import { generateTOC, markdownToHTML } from "./formatter";

/**
 * Export documentation in various formats
 */
export function exportDocumentation(
  workflowId: string,
  doc: WorkflowDocumentation | null,
  getAllActionComments: (workflowId: string) => ActionComment[],
  options: ExportOptions = { format: "markdown" }
): string | null {
  if (!doc) {
    return null;
  }

  let content = doc.content;

  // Add TOC if requested
  if (options.includeTOC) {
    const toc = generateTOC(content);
    content = toc + "\n\n" + content;
  }

  // Add metadata if requested
  if (options.includeMetadata) {
    const metadata = `---
Workflow ID: ${workflowId}
Version: ${doc.version}
Created: ${doc.created}
Updated: ${doc.updated}
${doc.author ? `Author: ${doc.author}` : ""}
${doc.tags && doc.tags.length > 0 ? `Tags: ${doc.tags.join(", ")}` : ""}
---

`;
    content = metadata + content;
  }

  // Add comments if requested
  if (options.includeComments) {
    const comments = getAllActionComments(workflowId);
    if (comments.length > 0) {
      content += "\n\n## Action Comments\n\n";
      comments.forEach((comment) => {
        content += `- **${comment.actionId}**: ${comment.comment}\n`;
      });
    }
  }

  // Convert format if needed
  if (options.format === "html") {
    return markdownToHTML(content);
  } else if (options.format === "pdf") {
    // PDF would require a library like jsPDF
    return `[PDF Export] ${content}`;
  }

  return content;
}

/**
 * Export all documentation
 */
export function exportAllDocumentation(
  documentations: Map<string, WorkflowDocumentation>,
  getAllActionComments: (workflowId: string) => ActionComment[],
  options: ExportOptions = { format: "markdown" }
): string {
  const parts: string[] = [];

  parts.push("# Workflow Documentation\n");
  parts.push(`Generated: ${new Date().toISOString()}\n`);
  parts.push(`Total Workflows: ${documentations.size}\n`);

  documentations.forEach((_doc, workflowId) => {
    parts.push("\n---\n");
    const doc = documentations.get(workflowId)!;
    const exported = exportDocumentation(
      workflowId,
      doc,
      getAllActionComments,
      {
        ...options,
        includeMetadata: true,
      }
    );
    if (exported) {
      parts.push(exported);
    }
  });

  return parts.join("\n");
}

/**
 * Generate project README with all workflows
 */
export function exportProjectReadme(
  workflows: Workflow[],
  getDocumentation: (workflowId: string) => WorkflowDocumentation | null
): string {
  const parts: string[] = [];

  parts.push("# Workflow Project Documentation\n");
  parts.push(`Generated: ${new Date().toISOString()}\n`);

  // Group by category
  const byCategory = new Map<string, Workflow[]>();
  workflows.forEach((wf) => {
    const category = wf.category || "Uncategorized";
    const list = byCategory.get(category) || [];
    list.push(wf);
    byCategory.set(category, list);
  });

  // Table of contents
  parts.push("## Table of Contents\n");
  byCategory.forEach((_wfs, category) => {
    parts.push(
      `- [${category}](#${category.toLowerCase().replace(/\s+/g, "-")})`
    );
  });

  // Workflows by category
  byCategory.forEach((wfs, category) => {
    parts.push(`\n## ${category}\n`);

    wfs.forEach((wf) => {
      parts.push(`### ${wf.name}`);
      if (wf.description) {
        parts.push(wf.description);
      }
      parts.push(`- **Version:** ${wf.version}`);
      parts.push(`- **Actions:** ${wf.actions.length}`);
      if (wf.tags && wf.tags.length > 0) {
        parts.push(`- **Tags:** ${wf.tags.join(", ")}`);
      }

      const doc = getDocumentation(wf.id);
      if (doc) {
        parts.push("\n[View Full Documentation →]");
      }

      parts.push("");
    });
  });

  return parts.join("\n");
}
