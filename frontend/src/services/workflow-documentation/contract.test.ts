/**
 * Characterization (contract) test for the workflow-documentation service.
 *
 * Written against the former single-file monolith first (commit dad4e634b)
 * and then re-pointed, unchanged, at the split `@/services/workflow-documentation`
 * barrel: the committed snapshots are the behaviour-preservation proof that
 * the split carries the same return values, exports and stored bytes (plan
 * 2026-10-04-web-frontend-half-finished-refactors-shadow-their-live-modules,
 * Phase 4). Do not update these snapshots to make a refactor pass — a diff
 * here is a behaviour change.
 *
 * Known, deliberate difference the snapshots do not cover: storage failures
 * are logged through the structured logger, so the console line gains a
 * "[WorkflowDocumentation]" prefix. The failure test below asserts the
 * message substance and the error object, not the exact line.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@/lib/action-schema/action-types";
import {
  WorkflowDocumentationService,
  workflowDocumentation,
  type ExportOptions,
} from "@/services/workflow-documentation";

const FIXED_NOW = new Date("2026-01-02T03:04:05.000Z");
const STORAGE_KEYS = [
  "workflow-documentation",
  "workflow-action-comments",
  "workflow-documentation-versions",
] as const;

/**
 * A workflow with a branch (IF + TRY_CATCH), a loop (LOOP plus a back edge),
 * variables at all three scopes, SET/GET_VARIABLE actions, a sub-workflow
 * call, image targets, a screenshot and a data-processing action.
 */
function fixtureWorkflow(): Workflow {
  const action = (
    id: string,
    type: string,
    name: string | undefined,
    config: Record<string, unknown>,
    x: number
  ) => ({ id, type, name, config, position: [x, 0] as [number, number] });
  const to = (target: string) => [{ action: target, type: "main", index: 0 }];

  return {
    id: "wf-login",
    name: "Login \"Flow\"",
    version: "1.2.0",
    format: "graph",
    category: "Authentication",
    description: "Logs a user in, retrying until the dashboard appears.",
    initialStateIds: ["state-login-page", "state-browser-open"],
    initialScreenshotId: "shot-initial",
    tags: ["auth", "smoke"],
    metadata: {
      created: "2025-12-01T10:00:00.000Z",
      updated: "2025-12-15T11:30:00.000Z",
      author: "qa-team",
    },
    variables: {
      local: { username: "alice", retries: 3 },
      process: { sessionId: null },
      global: { debug: true },
    },
    actions: [
      action("find", "FIND", "Find login button", { target: { image: "login-button.png" } }, 0),
      action("set", "SET_VARIABLE", "Init attempts", { variable: "attempts", scope: "process" }, 1),
      action("loop", "LOOP", "Retry loop", { maxIterations: 3 }, 2),
      action("if", "IF", "Is logged in?", { condition: "loggedIn" }, 3),
      action("click", "CLICK", "Click login", { target: { image: "login.png" } }, 4),
      action("type", "TYPE", undefined, { text: "alice" }, 5),
      action("try", "TRY_CATCH", "Guard submit", {}, 6),
      action("get", "GET_VARIABLE", "Read attempts", { variable: "attempts" }, 7),
      action("sub", "RUN_WORKFLOW", "Logout fallback", { workflowId: "wf-logout" }, 8),
      action("shot", "SCREENSHOT", "Capture dashboard", { filename: "done.png" }, 9),
      action("filter", "FILTER", "Filter rows", {}, 10),
      action("brk", "BREAK", "Stop", {}, 11),
    ],
    connections: {
      find: { main: [to("set")] },
      set: { main: [to("loop")] },
      loop: { main: [to("if"), to("brk")] },
      if: { main: [to("click"), to("type")] },
      click: { main: [to("try")] },
      type: { main: [to("loop")] },
      try: { main: [to("get")], error: [to("sub")] },
      get: { success: [to("shot")] },
      shot: { main: [to("filter")] },
    },
  } as unknown as Workflow;
}

/** Drop the singleton so the next getInstance() constructs (and loads) anew. */
function resetSingleton(): void {
  (WorkflowDocumentationService as unknown as { instance?: unknown }).instance =
    undefined;
}

function freshService(): WorkflowDocumentationService {
  resetSingleton();
  return WorkflowDocumentationService.getInstance();
}

/** Pull one `## Heading` section out of a generated document. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`## ${heading}\n`);
  expect(start, `section "${heading}" present`).toBeGreaterThanOrEqual(0);
  const next = doc.indexOf("\n\n## ", start + 1);
  return next === -1 ? doc.slice(start) : doc.slice(start, next);
}

describe("workflow-documentation service contract", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    vi.spyOn(Math, "random").mockReturnValue(0.123456789);
    // toLocaleString depends on the host locale and time zone; pin it.
    vi.spyOn(Date.prototype, "toLocaleString").mockImplementation(function (
      this: Date
    ) {
      return `LOCALE(${this.toISOString()})`;
    });
    localStorage.clear();
    resetSingleton();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
    resetSingleton();
  });

  it("exports a singleton that is a WorkflowDocumentationService", () => {
    expect(workflowDocumentation).toBeInstanceOf(WorkflowDocumentationService);
  });

  it("generateDocumentation renders every section for a branching, looping workflow", () => {
    const svc = freshService();
    const wf = fixtureWorkflow();
    // A comment shows up in the action flow; two doc versions populate Recent Changes.
    svc.addActionComment(wf.id, "if", "Checks for the dashboard header", "bob");
    svc.createDocumentation(wf.id, "# v1", { author: "bob" });
    svc.updateDocumentation(wf.id, "# v2", "Second pass");

    const doc = svc.generateDocumentation(wf);
    expect(doc).toMatchSnapshot("full document");
    expect(section(doc, "Complexity Metrics")).toMatchSnapshot("complexity metrics");
    expect(section(doc, "Action Flow")).toMatchSnapshot("action flow");
  });

  it("generateDocumentation handles a workflow with no variables, outputs or handlers", () => {
    const svc = freshService();
    const wf = {
      id: "wf-bare",
      name: "Bare",
      version: "0.1.0",
      format: "graph",
      actions: [
        { id: "a", type: "CLICK", config: {}, position: [0, 0] },
        { id: "b", type: "TYPE", config: {}, position: [1, 0] },
      ],
      connections: { a: { main: [[{ action: "b", type: "main", index: 0 }]] } },
    } as unknown as Workflow;
    expect(svc.generateDocumentation(wf)).toMatchSnapshot();
  });

  it("flowchart, variables table and dependencies list text", () => {
    const svc = freshService();
    const wf = fixtureWorkflow();
    expect(svc.generateFlowchart(wf)).toMatchSnapshot("flowchart");
    expect(svc.generateVariablesTable(wf)).toMatchSnapshot("variables table");
    expect(svc.generateDependenciesList(wf)).toMatchSnapshot("dependencies list");
  });

  it("exports every ExportOptions format with every option combination", () => {
    const svc = freshService();
    const wf = fixtureWorkflow();
    svc.createDocumentation(wf.id, svc.generateDocumentation(wf), {
      author: "bob",
      tags: ["auth", "generated"],
    });
    svc.addActionComment(wf.id, "click", "Primary submit button");
    // Comment ids derive from Date.now() and Math.random(), both pinned: move
    // the clock so the second comment gets its own id instead of overwriting
    // the first, or the snapshot only ever sees one comment.
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    svc.addActionComment(wf.id, "try", "Falls back to logout");

    const formats: ExportOptions["format"][] = ["markdown", "html", "pdf"];
    const out: Record<string, string | null> = {};
    for (const format of formats) {
      out[`${format}:plain`] = svc.exportDocumentation(wf.id, { format });
      out[`${format}:all`] = svc.exportDocumentation(wf.id, {
        format,
        includeTOC: true,
        includeMetadata: true,
        includeDiagrams: true,
        includeComments: true,
      });
    }
    out["default"] = svc.exportDocumentation(wf.id);
    out["missing"] = svc.exportDocumentation("no-such-workflow");
    expect(out).toMatchSnapshot();

    expect(svc.exportAllDocumentation({ format: "html" })).toMatchSnapshot(
      "export all html"
    );
    expect(svc.exportAllDocumentation()).toMatchSnapshot("export all markdown");
    expect(
      svc.exportProjectReadme([
        wf,
        { ...fixtureWorkflow(), id: "wf-other", name: "Other", category: undefined, tags: [] },
      ])
    ).toMatchSnapshot("project readme");
  });

  it("templates, TOC, search and version comparison", () => {
    const svc = freshService();
    const wf = fixtureWorkflow();
    expect(svc.getTemplates()).toMatchSnapshot("templates");
    expect(svc.applyTemplate(wf.id, "UI Test", wf)).toBe(true);
    expect(svc.applyTemplate(wf.id, "No Such Template", wf)).toBe(false);
    expect(svc.getDocumentation(wf.id)).toMatchSnapshot("applied template doc");

    expect(svc.updateTOC(wf.id)).toBe(true);
    expect(svc.updateTOC("missing")).toBe(false);
    expect(svc.getDocumentation(wf.id)?.content).toMatchSnapshot("after updateTOC");
    expect(svc.generateTOC("no headings here")).toBe("");

    svc.createDocumentation("wf-2", "test test test login", {});
    expect(svc.searchDocumentation("test")).toMatchSnapshot("search");
    expect(svc.findWorkflowsByDocContent("login")).toMatchSnapshot("find by content");

    const history = svc.getDocumentationHistory(wf.id);
    expect(history).toMatchSnapshot("history");
    expect(svc.compareDocVersions(history[0]!, history[1]!)).toMatchSnapshot(
      "compare versions"
    );
  });

  it("CRUD and comments behave as recorded", () => {
    const svc = freshService();
    expect(svc.updateDocumentation("nope", "x")).toBeNull();
    expect(svc.hasDocumentation("wf")).toBe(false);
    svc.createDocumentation("wf", "body", { format: "plain", author: "a", tags: ["t"] });
    expect(svc.hasDocumentation("wf")).toBe(true);

    const c1 = svc.addActionComment("wf", "a1", "first", "ann");
    vi.setSystemTime(new Date(FIXED_NOW.getTime() + 1000));
    const c2 = svc.addActionComment("wf", "a2", "second");
    expect([c1, c2]).toMatchSnapshot("comments");
    expect(svc.updateActionComment(c1.id, "first, edited")).toMatchSnapshot(
      "updated comment"
    );
    expect(svc.updateActionComment("missing", "x")).toBeNull();
    expect(svc.getActionComment("a2")).toEqual(c2);
    expect(svc.getActionComment("none")).toBeNull();
    expect(svc.deleteActionComment(c2.id)).toBe(true);
    expect(svc.deleteActionComment(c2.id)).toBe(false);
    expect(svc.getAllActionComments("wf")).toMatchSnapshot("remaining comments");

    for (let i = 0; i < 25; i++) svc.updateDocumentation("wf", `body ${i}`);
    const history = svc.getDocumentationHistory("wf");
    expect(history).toHaveLength(20);
    expect(history.map((v) => v.version)).toMatchSnapshot("version cap");
    expect(svc.getDocumentation("wf")?.version).toBe(26);

    expect(svc.deleteDocumentation("wf")).toBe(true);
    expect(svc.deleteDocumentation("wf")).toBe(false);
    expect(svc.getAllActionComments("wf")).toEqual([]);
    expect(svc.getDocumentationHistory("wf")).toEqual([]);
  });

  it("swallows storage failures, keeps in-memory state, and logs the error", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Save path: setItem throws (quota exceeded, Safari private mode).
    const quota = new Error("QuotaExceededError");
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw quota;
      });
    const svc = freshService();
    const doc = svc.createDocumentation("wf", "body");
    expect(doc.content).toBe("body");
    expect(svc.getDocumentation("wf")?.content).toBe("body");
    const saveCall = errorSpy.mock.calls.find((c) =>
      String(c[0]).includes("Failed to save documentation to storage")
    );
    expect(saveCall, "save failure is logged").toBeDefined();
    expect(saveCall!.at(-1)).toBe(quota);
    setItem.mockRestore();

    // Load path: a corrupt stored value leaves the service empty, not broken.
    localStorage.setItem("workflow-documentation", "{not json");
    errorSpy.mockClear();
    const reloaded = freshService();
    expect(reloaded.getDocumentation("wf")).toBeNull();
    expect(
      errorSpy.mock.calls.some((c) =>
        String(c[0]).includes("Failed to load documentation from storage")
      ),
      "load failure is logged"
    ).toBe(true);
  });

  it("round-trips through localStorage under the same three keys", () => {
    const first = freshService();
    const wf = fixtureWorkflow();
    first.createDocumentation(wf.id, "# Persisted", { author: "bob", tags: ["x"] });
    first.updateDocumentation(wf.id, "# Persisted v2", "edit");
    first.addActionComment(wf.id, "if", "persisted comment", "bob");

    const raw = Object.fromEntries(
      STORAGE_KEYS.map((k) => [k, localStorage.getItem(k)])
    );
    expect(raw).toMatchSnapshot("raw localStorage");

    // A brand-new instance must load exactly what the first one saved.
    const second = freshService();
    expect(second).not.toBe(first);
    expect(second.getDocumentation(wf.id)).toEqual(first.getDocumentation(wf.id));
    expect(second.getAllActionComments(wf.id)).toEqual(
      first.getAllActionComments(wf.id)
    );
    expect(second.getDocumentationHistory(wf.id)).toEqual(
      first.getDocumentationHistory(wf.id)
    );
    expect({
      doc: second.getDocumentation(wf.id),
      comments: second.getAllActionComments(wf.id),
      history: second.getDocumentationHistory(wf.id),
    }).toMatchSnapshot("reloaded state");

    second.clearAll();
    expect(STORAGE_KEYS.map((k) => localStorage.getItem(k))).toEqual([
      null,
      null,
      null,
    ]);
    expect(freshService().getDocumentation(wf.id)).toBeNull();
  });
});
