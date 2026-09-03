/**
 * The `session_briefing` body rules, as the operator meets them — across all
 * three write doors that reach coord's content validator.
 *
 * `sessionBriefingBody.test.ts` pins the RULES. These pin the WIRING, which is
 * the half that actually removes the bare 400: a validator nothing consults is
 * indistinguishable from no validator. Coord calls
 * `validate_body_for_kind` from `patch_one` (the editor), `post_create` (the
 * create dialog) and `restore_version` (the history dialog), so each of the
 * three is covered here, together with the negative — other kinds are not
 * content-checked and must keep saving exactly as before.
 *
 * The history case is the one worth stating plainly: that snapshot was VALID
 * when it was written, and coord re-checks it because rules tighten. So the
 * operator can be looking at a diff of a body they did not author and cannot
 * fix, and the dialog has to say why the restore is unavailable rather than
 * quietly dropping the button.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PromptDocumentEditorDialog } from "./PromptDocumentEditorDialog";
import { PromptDocumentCreateDialog } from "./PromptDocumentCreateDialog";
import { PromptDocumentHistoryDialog } from "./PromptDocumentHistoryDialog";
import { AgentWriteAccessControl } from "./AgentWriteAccessControl";
import { SESSION_BRIEFING_MAX_BYTES } from "../_lib/sessionBriefingBody";
import type {
  PromptDocument,
  PromptDocumentKind,
  PromptDocumentSummary,
  PromptDocumentVersion,
} from "../types";

/** A body coord refuses: a UUID is an identity, and briefings carry none. */
const WITH_IDENTITY = "Briefing.\nTenant 9c9c5219-afcc-42e0-9ed9-888a9d0dbbaa.";

function doc(kind: PromptDocumentKind): PromptDocument {
  return {
    id: "doc-1",
    tenant_id: "tenant-1",
    kind,
    name: kind === "session_briefing" ? "runner-session" : "session-protocol",
    description: "the briefing",
    format: "markdown",
    default_source: "prompt_doc/x/y/v1",
    current_version: 3,
    updated_by: "editor@example.com",
    updated_at: "2026-08-20T10:00:00Z",
    body: "Original body.",
    attrs: null,
  };
}

function renderEditor(kind: PromptDocumentKind) {
  const onUpdate = vi.fn().mockResolvedValue(true);
  render(
    <PromptDocumentEditorDialog
      open
      onOpenChange={vi.fn()}
      document={doc(kind)}
      loadingBody={false}
      saving={false}
      onUpdate={onUpdate}
      onRestore={vi.fn().mockResolvedValue(true)}
      onShowHistory={vi.fn()}
    />
  );
  return { onUpdate };
}

/** Replace the body textarea's contents wholesale. */
async function typeBody(user: ReturnType<typeof userEvent.setup>, text: string) {
  const field = screen.getByTestId("doc-body");
  await user.clear(field);
  await user.paste(text);
}

describe("editor — the PATCH door", () => {
  it("names the offending token and disables Save", async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderEditor("session_briefing");
    await typeBody(user, WITH_IDENTITY);

    expect(screen.getByTestId("doc-body-error")).toHaveTextContent(
      "9c9c5219-afcc-42e0-9ed9-888a9d0dbbaa"
    );
    expect(screen.getByTestId("doc-save")).toBeDisabled();

    await user.click(screen.getByTestId("doc-save"));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("clears the error and re-enables Save once the body is fixed", async () => {
    const user = userEvent.setup();
    renderEditor("session_briefing");
    await typeBody(user, WITH_IDENTITY);
    expect(screen.getByTestId("doc-save")).toBeDisabled();

    await typeBody(user, "A clean briefing.");
    await user.type(screen.getByTestId("doc-change-note"), "why");

    expect(screen.queryByTestId("doc-body-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-save")).toBeEnabled();
  });

  /**
   * Mirrors coord's `patch_one`, which content-checks only
   * `if let Some(ref body) = req.body`. A stored body written before a rule
   * tightened must not have its DESCRIPTION frozen — coord would accept that
   * PATCH, so blocking it here would invent a refusal.
   */
  it("does not block a description-only edit of an already-invalid stored body", async () => {
    const user = userEvent.setup();
    const stored = doc("session_briefing");
    stored.body = WITH_IDENTITY;
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(
      <PromptDocumentEditorDialog
        open
        onOpenChange={vi.fn()}
        document={stored}
        loadingBody={false}
        saving={false}
        onUpdate={onUpdate}
        onRestore={vi.fn().mockResolvedValue(true)}
        onShowHistory={vi.fn()}
      />
    );

    await user.type(screen.getByTestId("doc-description"), " (renamed)");
    await user.type(screen.getByTestId("doc-change-note"), "retitle");

    expect(screen.queryByTestId("doc-body-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-save")).toBeEnabled();

    await user.click(screen.getByTestId("doc-save"));
    expect(onUpdate).toHaveBeenCalledWith(
      "session_briefing",
      "runner-session",
      expect.not.objectContaining({ body: expect.anything() })
    );
  });

  it("shows the byte budget for a briefing and counts UTF-8 bytes", async () => {
    const user = userEvent.setup();
    renderEditor("session_briefing");
    await typeBody(user, "———");

    // Three em-dashes are 3 UTF-16 code units and 9 UTF-8 bytes.
    expect(screen.getByTestId("doc-body-budget")).toHaveTextContent(
      `${(9).toLocaleString()} / ${SESSION_BRIEFING_MAX_BYTES.toLocaleString()} bytes`
    );
  });

  it("shows no budget and applies no content rule to another kind", async () => {
    const user = userEvent.setup();
    renderEditor("policy");
    await typeBody(user, WITH_IDENTITY);

    expect(screen.queryByTestId("doc-body-budget")).not.toBeInTheDocument();
    expect(screen.queryByTestId("doc-body-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-save")).toBeEnabled();
  });
});

describe("create dialog — the create door", () => {
  function renderCreate() {
    const onCreate = vi.fn().mockResolvedValue(null);
    render(
      <PromptDocumentCreateDialog
        open
        onOpenChange={vi.fn()}
        saving={false}
        onCreate={onCreate}
        onCreated={vi.fn()}
      />
    );
    return { onCreate };
  }

  async function pickBriefing(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByTestId("create-kind"));
    await user.click(screen.getByRole("option", { name: "Session Briefing" }));
  }

  it("blocks Create on a briefing body coord would refuse", async () => {
    const user = userEvent.setup();
    const { onCreate } = renderCreate();
    await pickBriefing(user);
    await user.type(screen.getByTestId("create-name"), "runner-session");
    await user.click(screen.getByTestId("create-body"));
    await user.paste(WITH_IDENTITY);

    expect(screen.getByTestId("create-body-error")).toBeInTheDocument();
    expect(screen.getByTestId("create-submit")).toBeDisabled();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("applies no content rule to the default kind", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByTestId("create-name"), "a-policy");
    await user.click(screen.getByTestId("create-body"));
    await user.paste(WITH_IDENTITY);

    expect(screen.queryByTestId("create-body-error")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-submit")).toBeEnabled();
  });

  /**
   * The size ceiling is the one rule a well-meaning operator breaches by
   * accident, and the create dialog is where a briefing's FIRST body is
   * written — so the budget belongs at this door too, not only at the editor
   * the operator reaches afterwards. Bytes, not characters, for the reason
   * `sessionBriefingByteLength` exists.
   */
  it("shows the byte budget for a briefing and counts UTF-8 bytes", async () => {
    const user = userEvent.setup();
    renderCreate();
    await pickBriefing(user);
    await user.click(screen.getByTestId("create-body"));
    await user.paste("—"); // one character, three UTF-8 bytes

    expect(screen.getByTestId("create-body-budget")).toHaveTextContent(
      `${(3).toLocaleString()} / ${SESSION_BRIEFING_MAX_BYTES.toLocaleString()} bytes`
    );
  });

  it("shows no budget for a kind that has no ceiling", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByTestId("create-body"));
    await user.paste("Some prose.");

    expect(screen.queryByTestId("create-body-budget")).not.toBeInTheDocument();
  });

  /**
   * The inert-name warning WARNS and does not block: coord accepts the row, so
   * refusing it here would be the form inventing a rule. What the operator must
   * not do is create it believing it will be read — or believing it inherits
   * the write protection the three canonical names have.
   */
  it("warns that a non-canonical briefing name is inert and agent-writable", async () => {
    const user = userEvent.setup();
    renderCreate();
    await pickBriefing(user);
    await user.type(screen.getByTestId("create-name"), "my-own-briefing");
    await user.click(screen.getByTestId("create-body"));
    await user.paste("A clean briefing.");

    const warning = screen.getByTestId("create-inert-briefing");
    expect(warning).toHaveTextContent("runner-session");
    expect(warning).toHaveTextContent("agent-writable by default");
    expect(screen.getByTestId("create-submit")).toBeEnabled();
  });

  it("does not warn on one of the three canonical names", async () => {
    const user = userEvent.setup();
    renderCreate();
    await pickBriefing(user);
    await user.type(screen.getByTestId("create-name"), "plan-capture-clause");

    expect(
      screen.queryByTestId("create-inert-briefing")
    ).not.toBeInTheDocument();
  });

  it("does not warn for another kind", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByTestId("create-name"), "anything-at-all");

    expect(
      screen.queryByTestId("create-inert-briefing")
    ).not.toBeInTheDocument();
  });
});

describe("history dialog — the restore-version door", () => {
  const meta = {
    id: "v1",
    version_number: 1,
    description: "first",
    edited_by: "someone@example.com",
    created_at: "2026-08-01T10:00:00Z",
  };

  function renderHistory(
    snapshotBody: string,
    kind: PromptDocumentKind,
    {
      readOnly = false,
      hasDefault = true,
    }: { readOnly?: boolean; hasDefault?: boolean } = {}
  ) {
    const onRestoreVersion = vi.fn().mockResolvedValue(true);
    const version: PromptDocumentVersion = {
      ...meta,
      document_id: "doc-1",
      body: snapshotBody,
    };
    render(
      <PromptDocumentHistoryDialog
        open
        onOpenChange={vi.fn()}
        target={{
          kind,
          name: "runner-session",
          label: "the briefing",
          hasDefault,
        }}
        currentBody="Current body."
        currentVersion={2}
        fetchVersions={vi.fn().mockResolvedValue({
          document_id: "doc-1",
          kind,
          name: "runner-session",
          current_version: 2,
          versions: [meta],
          total: 1,
        })}
        fetchVersion={vi.fn().mockResolvedValue(version)}
        saving={false}
        onRestoreVersion={readOnly ? undefined : onRestoreVersion}
      />
    );
    return { onRestoreVersion };
  }

  it("offers the restore when the snapshot still passes today's rules", async () => {
    renderHistory("A clean briefing.", "session_briefing");
    expect(await screen.findByTestId("restore-version")).toBeInTheDocument();
    expect(
      screen.queryByTestId("restore-blocked-reason")
    ).not.toBeInTheDocument();
  });

  it("explains, rather than silently hiding the control, when it no longer does", async () => {
    renderHistory(WITH_IDENTITY, "session_briefing");
    const reason = await screen.findByTestId("restore-blocked-reason");
    expect(reason).toHaveTextContent("9c9c5219-afcc-42e0-9ed9-888a9d0dbbaa");
    expect(screen.queryByTestId("restore-version")).not.toBeInTheDocument();
  });

  /**
   * A refusal that names no remaining door is a dead end, and coord leaves one
   * open on purpose: `post_restore_default` is the single write path it does
   * NOT content-check, because the body it re-seeds is coord's own.
   */
  it("names restore-to-default as the way out when the document has one", async () => {
    renderHistory(WITH_IDENTITY, "session_briefing");
    const reason = await screen.findByTestId("restore-blocked-reason");
    expect(reason).toHaveTextContent("Restore to default");
  });

  it("does not name it for a document with no built-in default", async () => {
    renderHistory(WITH_IDENTITY, "session_briefing", { hasDefault: false });
    const reason = await screen.findByTestId("restore-blocked-reason");
    expect(reason).toHaveTextContent("no longer passes");
    expect(reason).not.toHaveTextContent("Restore to default");
  });

  it("applies no content rule to another kind's snapshot", async () => {
    renderHistory(WITH_IDENTITY, "policy");
    expect(await screen.findByTestId("restore-version")).toBeInTheDocument();
    expect(
      screen.queryByTestId("restore-blocked-reason")
    ).not.toBeInTheDocument();
  });

  /**
   * The explanation stands in for a control that would otherwise be there. In
   * a read-only history there is no such control, so explaining its absence
   * would be answering a question nobody asked.
   */
  it("stays silent in a read-only history, where no restore was offered", async () => {
    renderHistory(WITH_IDENTITY, "session_briefing", { readOnly: true });
    expect(await screen.findByTestId("version-list")).toBeInTheDocument();
    expect(
      screen.queryByTestId("restore-blocked-reason")
    ).not.toBeInTheDocument();
  });
});

/**
 * The override confirmation is the strongest write-protection decision an
 * operator makes on this page, and until now it gave one reason for two
 * families. Coord's `AGENT_UNWRITABLE_DOCUMENTS` protects the meta-policies
 * because they redefine what a rule MEANS, and the session briefings because
 * they are pushed into every session's system prompt — different facts, and
 * telling a briefing's reader the meta-policy one is simply false.
 *
 * The mechanics stay kind-generic (the control keys on the `agent_write_*`
 * fields coord derives, never on the kind); only the copy branches. These pin
 * that split so a later "simplification" back to one paragraph fails loudly.
 */
describe("AgentWriteAccessControl — the two protected families", () => {
  function protectedDoc(kind: PromptDocumentKind): PromptDocumentSummary {
    return {
      id: "doc-1",
      kind,
      name: kind === "session_briefing" ? "runner-session" : "session-protocol",
      description: "protected",
      format: "markdown",
      default_source: "prompt_doc/x/y/v1",
      current_version: 1,
      updated_by: null,
      updated_at: "2026-08-20T10:00:00Z",
      attrs: null,
      agent_writable: null,
      agent_write_effective: false,
      agent_write_source: "default",
      agent_write_builtin_default: false,
    };
  }

  /**
   * Open the tier menu and pick `allow` — the choice that overrides coord's
   * compile-time protection and so raises the confirmation.
   *
   * `pointerEventsCheck: 0` because Radix opens the menu on a pointer sequence
   * jsdom does not fully model; the gates console's dropdown tests do the same.
   */
  async function openConfirm(kind: PromptDocumentKind) {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSet = vi.fn().mockResolvedValue(true);
    const doc = protectedDoc(kind);
    render(<AgentWriteAccessControl doc={doc} saving={false} onSet={onSet} />);
    await user.click(
      screen.getByTestId(`doc-access-toggle-${doc.kind}-${doc.name}`)
    );
    await user.click(
      await screen.findByTestId(`doc-access-tier-${doc.kind}-${doc.name}-allow`)
    );
    return { onSet };
  }

  it("gives a briefing the push-into-every-prompt reason, not the meta-policy one", async () => {
    await openConfirm("session_briefing");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("session briefing");
    expect(dialog).toHaveTextContent(
      /instructions the next session runs under/i
    );
    expect(dialog).not.toHaveTextContent("meta-policy");
  });

  it("still gives a policy the meta-policy reason", async () => {
    await openConfirm("policy");
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("meta-policy");
    expect(dialog).not.toHaveTextContent("session briefing");
  });

  it("keys the badge's reason on the kind too", () => {
    const doc = protectedDoc("session_briefing");
    render(<AgentWriteAccessControl doc={doc} saving={false} onSet={vi.fn()} />);
    expect(
      screen.getByTestId(`doc-access-${doc.kind}-${doc.name}`)
    ).toHaveAttribute(
      "title",
      expect.stringContaining("system prompt of every session")
    );
  });

  /**
   * The confirmation must remain keyed on the derived field, not on the kind:
   * a fourth, non-canonical briefing row is NOT on coord's list, so opening it
   * is an ordinary click and must not be dressed up as overriding a built-in
   * protection.
   */
  it("does not confirm for a briefing coord does not protect", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onSet = vi.fn().mockResolvedValue(true);
    const doc = protectedDoc("session_briefing");
    doc.name = "my-own-briefing";
    doc.agent_write_builtin_default = true;
    render(<AgentWriteAccessControl doc={doc} saving={false} onSet={onSet} />);

    await user.click(
      screen.getByTestId(`doc-access-toggle-${doc.kind}-${doc.name}`)
    );
    await user.click(
      await screen.findByTestId(`doc-access-tier-${doc.kind}-${doc.name}-allow`)
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // The tier, not the boolean: the write that reaches coord is
    // `agent_write_tier`, so a boolean here would be the old defect.
    expect(onSet).toHaveBeenCalledWith("allow");
  });
});
