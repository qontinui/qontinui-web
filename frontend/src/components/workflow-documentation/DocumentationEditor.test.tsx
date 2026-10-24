/**
 * The Documentation editor's "Insert → Complexity Metrics" menu item.
 *
 * Contract under test: clicking the item inserts the generator's own
 * `## Complexity Metrics` section — the same text the generated document
 * carries — and not the dependencies list it used to insert by mistake.
 * The test enters where a user does: it renders the editor and clicks the
 * menu item.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import type { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowDocumentationService } from "@/services/workflow-documentation";
import { DocumentationEditor } from "./DocumentationEditor";

function fixtureWorkflow(): Workflow {
  const action = (
    id: string,
    type: string,
    config: Record<string, unknown>
  ) => ({
    id,
    type,
    name: id,
    config,
    position: [0, 0] as [number, number],
  });
  const to = (target: string) => [{ action: target, type: "main", index: 0 }];

  return {
    id: "wf-complexity",
    name: "Complexity fixture",
    version: "1.0.0",
    format: "graph",
    variables: { local: {}, process: {}, global: {} },
    actions: [
      action("find", "FIND", { target: { image: "button.png" } }),
      action("if", "IF", { condition: "found" }),
      action("click", "CLICK", { target: { image: "button.png" } }),
      action("sub", "RUN_WORKFLOW", { workflowId: "wf-other" }),
    ],
    connections: {
      find: { main: [to("if")] },
      if: { main: [to("click"), to("sub")] },
    },
  } as unknown as Workflow;
}

describe("DocumentationEditor Insert menu", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("Complexity Metrics inserts the ## Complexity Metrics section, not the dependencies list", async () => {
    const user = userEvent.setup();
    const workflow = fixtureWorkflow();
    const docService = WorkflowDocumentationService.getInstance();

    // Rendered through a function component that calls DocumentationEditor
    // directly, so the entry point is an explicit call site in this test.
    function Editor() {
      return DocumentationEditor({
        workflow,
        onSave: () => {},
        onCancel: () => {},
        onGenerateAuto: () => {},
      });
    }
    render(<Editor />);

    await user.click(screen.getByRole("button", { name: /^insert$/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /complexity metrics/i })
    );

    const inserted = (document.querySelector("textarea") as HTMLTextAreaElement)
      .value;

    expect(inserted).toContain("## Complexity Metrics");
    expect(inserted.trim()).not.toBe(
      docService.generateDependenciesList(workflow).trim()
    );
    // Same text the generated document carries for this section.
    expect(docService.generateDocumentation(workflow)).toContain(
      inserted.trim()
    );
  });
});
