"use client";

import { useCallback, RefObject } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowDocumentationService } from "@/services/workflow-documentation-service";

export function useEditorActions(
  content: string,
  setContent: (content: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>
) {
  const insertAtCursor = useCallback(
    (text: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = content.substring(0, start);
      const after = content.substring(end);

      setContent(before + text + after);

      // Set cursor position after inserted text
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + text.length, start + text.length);
      }, 0);
    },
    [content, setContent, textareaRef]
  );

  const wrapSelection = useCallback(
    (prefix: string, suffix: string = prefix) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = content.substring(start, end);
      const before = content.substring(0, start);
      const after = content.substring(end);

      const newText = `${before}${prefix}${selectedText}${suffix}${after}`;
      setContent(newText);

      // Restore selection
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, end + prefix.length);
      }, 0);
    },
    [content, setContent, textareaRef]
  );

  const toolbarActions = {
    bold: () => wrapSelection("**"),
    italic: () => wrapSelection("*"),
    code: () => wrapSelection("`"),
    h1: () => insertAtCursor("# "),
    h2: () => insertAtCursor("## "),
    h3: () => insertAtCursor("### "),
    unorderedList: () => insertAtCursor("- "),
    orderedList: () => insertAtCursor("1. "),
    link: () => wrapSelection("[", "](url)"),
    image: () => insertAtCursor("![alt text](image-url)"),
    table: () =>
      insertAtCursor(
        "\n| Column 1 | Column 2 | Column 3 |\n|----------|----------|----------|\n| Cell 1   | Cell 2   | Cell 3   |\n"
      ),
    codeBlock: () => insertAtCursor("\n```\ncode here\n```\n"),
    mermaidDiagram: () =>
      insertAtCursor("\n```mermaid\ngraph TD\n    A[Start] --> B[End]\n```\n"),
  };

  const insertWorkflowElement = (workflow: Workflow) => ({
    actionsList: () => {
      const list = workflow.actions
        .map(
          (action, idx) =>
            `${idx + 1}. **${action.name || action.id}** (\`${action.type}\`)`
        )
        .join("\n");
      insertAtCursor(`\n## Actions\n\n${list}\n`);
    },
    variablesTable: () => {
      const docService = WorkflowDocumentationService.getInstance();
      const table = docService.generateVariablesTable(workflow);
      insertAtCursor(`\n${table}\n`);
    },
    flowchart: () => {
      const docService = WorkflowDocumentationService.getInstance();
      const flowchart = docService.generateFlowchart(workflow);
      insertAtCursor(`\n${flowchart}\n`);
    },
    complexityMetrics: () => {
      const docService = WorkflowDocumentationService.getInstance();
      const metrics = docService.generateDependenciesList(workflow);
      insertAtCursor(`\n${metrics}\n`);
    },
    dependencies: () => {
      const docService = WorkflowDocumentationService.getInstance();
      const deps = docService.generateDependenciesList(workflow);
      insertAtCursor(`\n${deps}\n`);
    },
  });

  return {
    insertAtCursor,
    wrapSelection,
    toolbarActions,
    insertWorkflowElement,
  };
}
