/**
 * BackendErrorMessage (plan
 * `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`,
 * Phase D3): a refusal envelope renders `Refusal::render()`'s sentence, its
 * action affordance and its glossary terms; every other body renders exactly
 * its pre-contract sentence, labelled `data-refusal="unstructured"`.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { GLOSSARY } from "@qontinui/shared-types/glossary";

import {
  BackendError,
  readErrorBody,
} from "@/lib/errors/backend-error-message";

import { BackendErrorMessage, linkableTarget } from "./BackendErrorMessage";

const AT = "2026-09-29T00:00:00Z";

function errorFor(body: unknown, status = 409): BackendError {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new BackendError(readErrorBody(text, status), status);
}

function envelope(next_action: Record<string, unknown>, extra = {}) {
  return {
    error: "legacy_code",
    refusal: {
      code: "endpoint_unresolved",
      next_action,
      glossary_terms: ["gate", "tenant"],
      observed_at: AT,
      source: "coord",
      ...extra,
    },
  };
}

describe("BackendErrorMessage — structured", () => {
  it("renders the sentence, the terms, and the detail beside it", () => {
    const { container } = render(
      <BackendErrorMessage
        error={errorFor(
          envelope(
            { kind: "set_setting", target: "backend_url" },
            { detail: "no value in settings" }
          )
        )}
      />
    );
    const root = container.querySelector("[data-refusal]")!;
    expect(root.getAttribute("data-refusal")).toBe("structured");
    expect(root.getAttribute("data-refusal-code")).toBe("endpoint_unresolved");
    expect(root.getAttribute("data-refusal-next-action")).toBe("set_setting");
    expect(
      container.querySelector("[data-refusal-sentence]")!.textContent
    ).toBe(
      'The address of a service this operation needs is not configured. Set the "backend_url" setting, then try again.'
    );
    expect(container.querySelector("[data-refusal-detail]")!.textContent).toBe(
      "no value in settings"
    );
    const terms = [...container.querySelectorAll("[data-glossary-term]")].map(
      (e) => [e.getAttribute("data-glossary-term"), e.textContent]
    );
    expect(terms).toEqual([
      ["gate", GLOSSARY.gate.term],
      ["tenant", GLOSSARY.tenant.term],
    ]);
    // No affordance for a kind that has none.
    expect(container.querySelector("[data-refusal-action]")).toBeNull();
  });

  it("links an open_page app path", () => {
    render(
      <BackendErrorMessage
        error={errorFor(
          envelope({ kind: "open_page", target: "/admin/coord/gates" })
        )}
      />
    );
    const link = screen.getByRole("link", { name: "Open page" });
    expect(link.getAttribute("href")).toBe("/admin/coord/gates");
    expect(link.getAttribute("target")).toBeNull();
  });

  it("links an external open_page in a new tab, without an opener", () => {
    render(
      <BackendErrorMessage
        error={errorFor(
          envelope({ kind: "open_page", target: "https://example.com/x" })
        )}
      />
    );
    const link = screen.getByRole("link", { name: "Open page" });
    expect(link.getAttribute("href")).toBe("https://example.com/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("never links a javascript: target", () => {
    const { container } = render(
      <BackendErrorMessage
        error={errorFor(
          envelope({ kind: "open_page", target: "javascript:alert(1)" })
        )}
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    // The sentence still names it.
    expect(
      container.querySelector("[data-refusal-sentence]")!.textContent
    ).toContain('Open "javascript:alert(1)"');
  });

  it("offers a run_command as a copyable command, exactly as sent", () => {
    const { container } = render(
      <BackendErrorMessage
        error={errorFor(
          envelope({ kind: "run_command", target: 'echo "$HOME"\n x' })
        )}
      />
    );
    // The copied command is the producer's, not the sentence's cleaned
    // prose: `"` -> `'` would stop the shell expanding `$HOME`.
    expect(container.querySelector("[data-refusal-command]")!.textContent).toBe(
      'echo "$HOME"\n x'
    );
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(
      container.querySelector("[data-refusal-sentence]")!.textContent
    ).toContain(`Run the command "echo '$HOME' x"`);
  });

  it("says so when the clipboard is unavailable, rather than doing nothing", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    try {
      render(
        <BackendErrorMessage
          error={errorFor(envelope({ kind: "run_command", target: "ls" }))}
        />
      );
      const button = screen.getByRole("button", { name: "Copy command" });
      fireEvent.click(button);
      expect(button.getAttribute("data-copy-state")).toBe("failed");
      expect(screen.getByRole("status").textContent).toMatch(/copy failed/i);
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it("offers no command for a blank run_command target", () => {
    const { container } = render(
      <BackendErrorMessage
        error={errorFor(envelope({ kind: "run_command", target: "  " }))}
      />
    );
    expect(container.querySelector("[data-refusal-action]")).toBeNull();
  });

  it("names glossary ids this build does not define instead of dropping them", () => {
    const { container } = render(
      <BackendErrorMessage
        error={errorFor(
          envelope(
            { kind: "none_terminal" },
            { glossary_terms: ["a_newer_term"] }
          )
        )}
      />
    );
    expect(
      container
        .querySelector("[data-glossary-unrecognised]")!
        .getAttribute("data-glossary-unrecognised")
    ).toBe("a_newer_term");
  });
});

describe("BackendErrorMessage — unstructured", () => {
  it("renders a pre-contract body exactly as the reader did before", () => {
    for (const [body, sentence] of [
      [{ error: "not_admin_in_target_tenant" }, "not_admin_in_target_tenant"],
      [{ detail: "nope" }, "nope"],
      ["{}", "HTTP 409"],
      // A string `next_action` is the pre-contract shape, not the envelope.
      [{ code: "endpoint_unresolved", error: "e", next_action: "Set X." }, "e"],
    ] as const) {
      const { container, unmount } = render(
        <BackendErrorMessage error={errorFor(body)} />
      );
      const root = container.firstElementChild!;
      expect(root.getAttribute("data-refusal")).toBe("unstructured");
      expect(root.textContent).toBe(sentence);
      unmount();
    }
  });

  it("accepts a reading kept in state, not only a thrown error", () => {
    const reading = readErrorBody(
      JSON.stringify(envelope({ kind: "sign_in" })),
      401
    );
    const { container } = render(<BackendErrorMessage error={reading} />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-refusal")).toBe("structured");
    expect(
      container.querySelector("[data-refusal-sentence]")!.textContent
    ).toBe(
      "The address of a service this operation needs is not configured. Sign in, then try again."
    );
  });

  it("labels any other caught error unstructured, with its message", () => {
    const { container } = render(
      <BackendErrorMessage error={new Error("network down")} />
    );
    const root = container.firstElementChild!;
    expect(root.getAttribute("data-refusal")).toBe("unstructured");
    expect(root.textContent).toBe("network down");
  });
});

describe("linkableTarget", () => {
  it("allows app paths and http(s) URLs only", () => {
    expect(linkableTarget("/a/b")).toEqual({ href: "/a/b", external: false });
    expect(linkableTarget("https://x.test/p")?.external).toBe(true);
    expect(linkableTarget("http://x.test/")?.external).toBe(true);
    for (const t of [
      null,
      "",
      "  ",
      "//evil.test/x",
      "/\\evil.test",
      // The browser's URL parser drops tabs and newlines: these are `//evil`.
      "/\t/evil.test",
      "/\n/evil.test",
      "javascript:alert(1)",
      "data:text/html,x",
      "settings",
    ]) {
      expect(linkableTarget(t), String(t)).toBeNull();
    }
  });
});
