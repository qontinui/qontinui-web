import type { UIBridgeElement, CollectedAnalysis } from "./page-analyzer-types";

export function generateId(): string {
  return `analysis_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/** Flatten a UI Bridge element tree into a flat list */
export function flattenElements(
  elements: UIBridgeElement[],
  depth = 0
): Array<UIBridgeElement & { depth: number }> {
  const result: Array<UIBridgeElement & { depth: number }> = [];
  for (const el of elements) {
    result.push({ ...el, depth });
    if (el.children && el.children.length > 0) {
      result.push(...flattenElements(el.children, depth + 1));
    }
  }
  return result;
}

export function getTypeBadgeVariant(
  type: CollectedAnalysis["type"]
): "info" | "success" | "warning" | "secondary" {
  switch (type) {
    case "ui_bridge":
      return "info";
    case "vision":
      return "success";
    case "api_request":
      return "warning";
    case "step_output":
      return "secondary";
  }
}

export function getTypeLabel(type: CollectedAnalysis["type"]): string {
  switch (type) {
    case "ui_bridge":
      return "UI Bridge";
    case "vision":
      return "Vision";
    case "api_request":
      return "API Request";
    case "step_output":
      return "Step Output";
  }
}

export function getItemCount(analysis: CollectedAnalysis): string {
  switch (analysis.type) {
    case "ui_bridge":
      return `${analysis.data.elements.length} elements`;
    case "vision":
      return `${analysis.data.elements.length} elements`;
    case "api_request":
      return analysis.data.status_code
        ? `Status ${analysis.data.status_code}`
        : "Response data";
    case "step_output":
      return analysis.data.success ? "Success" : "Failed";
  }
}

/** Generate a prompt context from all collected analyses */
export function generatePromptContext(analyses: CollectedAnalysis[]): string {
  if (analyses.length === 0) return "";

  const sections: string[] = [
    "# Page Analysis Data",
    `Collected ${analyses.length} analysis(es) at ${new Date().toISOString()}\n`,
  ];

  for (const analysis of analyses) {
    sections.push(`## ${analysis.name} (${analysis.type})`);

    if (analysis.type === "ui_bridge") {
      const snap = analysis.data;
      sections.push(`URL: ${snap.url}`);
      sections.push(`Title: ${snap.title}`);
      sections.push(`Elements: ${snap.elements.length}`);
      const flat = flattenElements(snap.elements);
      sections.push("### Element Tree");
      for (const el of flat.slice(0, 50)) {
        const indent = "  ".repeat(el.depth);
        const text = el.text ? ` "${el.text.slice(0, 60)}"` : "";
        const role = el.role ? ` [${el.role}]` : "";
        sections.push(`${indent}- <${el.tag}> id="${el.id}"${role}${text}`);
      }
      if (flat.length > 50) {
        sections.push(`  ... and ${flat.length - 50} more elements`);
      }
    } else if (analysis.type === "vision") {
      const pa = analysis.data;
      sections.push(`Source: vision (monitor ${pa.monitor_index ?? 0})`);
      sections.push(`Elements: ${pa.elements.length}`);
      sections.push("### Detected Elements");
      for (const el of pa.elements.slice(0, 30)) {
        sections.push(
          `- ${el.label} (${el.element_type}) confidence=${el.confidence.toFixed(2)}${el.selector ? ` selector="${el.selector}"` : ""}`
        );
      }
    } else if (analysis.type === "api_request") {
      const api = analysis.data;
      sections.push(`${api.method} ${api.url}`);
      sections.push(`Status: ${api.status_code ?? "unknown"}`);
      sections.push(`Duration: ${api.duration_ms ?? 0}ms`);
      sections.push("### Response Data");
      sections.push(
        "```json\n" +
          JSON.stringify(api.response, null, 2).slice(0, 3000) +
          "\n```"
      );
    } else if (analysis.type === "step_output") {
      const so = analysis.data;
      sections.push(`Step Type: ${so.step_type}`);
      sections.push(`Success: ${so.success}`);
      if (so.stdout) {
        sections.push("### Output");
        sections.push("```\n" + so.stdout.slice(0, 3000) + "\n```");
      }
    }

    sections.push(""); // blank line between analyses
  }

  return sections.join("\n");
}
