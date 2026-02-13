/**
 * Documentation Formatter
 *
 * Handles TOC generation, markdown-to-HTML conversion,
 * and search functionality across documentation.
 */

import type { WorkflowDocumentation, DocumentationVersion } from "./types";

/**
 * Generate table of contents from markdown content
 */
export function generateTOC(content: string): string {
  const lines = content.split("\n");
  const headers: Array<{ level: number; text: string; anchor: string }> = [];

  lines.forEach((line) => {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1]!.length;
      const text = match[2]!.trim();
      const anchor = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-");

      headers.push({ level, text, anchor });
    }
  });

  if (headers.length === 0) {
    return "";
  }

  const toc: string[] = ["## Table of Contents\n"];

  headers.forEach((header) => {
    const indent = "  ".repeat(header.level - 1);
    toc.push(`${indent}- [${header.text}](#${header.anchor})`);
  });

  return toc.join("\n");
}

/**
 * Convert markdown to HTML (basic)
 */
export function markdownToHTML(markdown: string): string {
  let html = markdown;

  // Headers
  html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Code
  html = html.replace(/`(.*?)`/g, "<code>$1</code>");

  // Lists
  html = html.replace(/^\- (.*$)/gim, "<li>$1</li>");

  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = "<p>" + html + "</p>";

  return html;
}

/**
 * Search across all documentation
 */
export function searchDocumentation(
  documentations: Map<string, WorkflowDocumentation>,
  query: string
): Array<{
  workflowId: string;
  doc: WorkflowDocumentation;
  matches: number;
  excerpt: string;
}> {
  const results: Array<{
    workflowId: string;
    doc: WorkflowDocumentation;
    matches: number;
    excerpt: string;
  }> = [];

  const lowerQuery = query.toLowerCase();

  documentations.forEach((doc, workflowId) => {
    const content = doc.content.toLowerCase();
    const matches = (content.match(new RegExp(lowerQuery, "g")) || []).length;

    if (matches > 0) {
      // Find first occurrence for excerpt
      const index = content.indexOf(lowerQuery);
      const start = Math.max(0, index - 50);
      const end = Math.min(content.length, index + query.length + 50);
      const excerpt = "..." + doc.content.substring(start, end) + "...";

      results.push({
        workflowId,
        doc,
        matches,
        excerpt,
      });
    }
  });

  // Sort by number of matches
  return results.sort((a, b) => b.matches - a.matches);
}

/**
 * Compare two documentation versions
 */
export function compareDocVersions(
  version1: DocumentationVersion,
  version2: DocumentationVersion
): {
  added: string[];
  removed: string[];
  modified: string[];
} {
  const lines1 = version1.content.split("\n");
  const lines2 = version2.content.split("\n");

  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];

  const set1 = new Set(lines1);
  const set2 = new Set(lines2);

  lines2.forEach((line) => {
    if (!set1.has(line)) {
      added.push(line);
    }
  });

  lines1.forEach((line) => {
    if (!set2.has(line)) {
      removed.push(line);
    }
  });

  return { added, removed, modified };
}
