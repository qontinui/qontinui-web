import {
  MousePointerClick,
  Link2,
  Type,
  Image as ImageIcon,
  SquareCheck,
  TreePine,
} from "lucide-react";
import { AccessibilityNode, RUNNER_API_BASE } from "./_types";

export function getRoleIcon(role: string) {
  switch (role.toLowerCase()) {
    case "button":
      return <MousePointerClick className="w-3.5 h-3.5 text-purple-400" />;
    case "link":
      return <Link2 className="w-3.5 h-3.5 text-blue-400" />;
    case "textbox":
    case "input":
    case "searchbox":
    case "combobox":
      return <Type className="w-3.5 h-3.5 text-green-400" />;
    case "img":
    case "image":
      return <ImageIcon className="w-3.5 h-3.5 text-amber-400" />;
    case "checkbox":
    case "radio":
      return <SquareCheck className="w-3.5 h-3.5 text-cyan-400" />;
    default:
      return <TreePine className="w-3.5 h-3.5 text-text-muted" />;
  }
}

export function getRoleBadgeVariant(role: string) {
  switch (role.toLowerCase()) {
    case "button":
      return "default" as const;
    case "link":
      return "info" as const;
    case "textbox":
    case "input":
    case "searchbox":
    case "combobox":
      return "success" as const;
    case "heading":
      return "warning" as const;
    case "img":
    case "image":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function hasMatchingDescendant(
  node: AccessibilityNode,
  query: string
): boolean {
  if (!node.children) return false;
  const lower = query.toLowerCase();
  return node.children.some(
    (child) =>
      child.role?.toLowerCase().includes(lower) ||
      child.name?.toLowerCase().includes(lower) ||
      hasMatchingDescendant(child, query)
  );
}

export function collectInteractiveNodes(
  node: AccessibilityNode
): Array<{ ref: string; role: string; name?: string }> {
  const result: Array<{ ref: string; role: string; name?: string }> = [];
  if (node.is_interactive && node.ref) {
    result.push({ ref: node.ref, role: node.role, name: node.name });
  }
  if (node.children) {
    for (const child of node.children) {
      result.push(...collectInteractiveNodes(child));
    }
  }
  return result;
}

export function countNodes(node: AccessibilityNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child);
    }
  }
  return count;
}

export async function executeAccessibilityCommand(
  cmdType: string,
  params: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${RUNNER_API_BASE}/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd_type: cmdType, params }),
    });
    if (!res.ok) {
      return { success: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    return { success: data.success ?? true, error: data.error };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Command failed",
    };
  }
}
