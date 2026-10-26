/**
 * RedactedText / useRedactor (plan `2026-10-23-console-presentation-spaces`
 * D3.3, "no foreign identity"): verbatim for the operator; in presentation
 * mode only what the scope proves first-party — and a withheld rendering
 * carries NOTHING of the original, in text or in any attribute.
 */

import type { ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PresentationScopeProvider,
  type PresentationScopeState,
} from "./presentationScope";
import { FixedPresentationMode } from "./PresentationModeProvider";
import { RedactedText, useRedactor, type RedactorItem } from "./RedactedText";

const FOREIGN_TITLE = "Acme Corp onboarding pilot";
const DESCRIPTOR = {
  kind: "Plan",
  area: "onboarding",
  status: "draft",
} as const;

const READY: PresentationScopeState = {
  status: "ready",
  scope: { firstPartyOwners: ["qontinui"], confidentialTerms: ["Acme Corp"] },
};

function inLens(
  presenting: boolean,
  scope: PresentationScopeState | null,
  ui: ReactNode
) {
  const body =
    scope === null ? (
      ui
    ) : (
      <PresentationScopeProvider state={scope}>{ui}</PresentationScopeProvider>
    );
  return (
    <FixedPresentationMode presenting={presenting}>
      {body}
    </FixedPresentationMode>
  );
}

describe("RedactedText", () => {
  it("renders the text verbatim for the operator", () => {
    render(
      inLens(
        false,
        null,
        <RedactedText
          text={FOREIGN_TITLE}
          repo="client-org/portal"
          descriptor={DESCRIPTOR}
        />
      )
    );
    expect(screen.getByText(FOREIGN_TITLE)).toBeInTheDocument();
  });

  it("withholds everything in presentation mode while no scope is known", () => {
    const { container } = render(
      inLens(
        true,
        null,
        <RedactedText
          text="Ship the presentation lens"
          repo="qontinui/qontinui-web"
          descriptor={DESCRIPTOR}
          data-testid="title"
        />
      )
    );
    expect(screen.getByTestId("title")).toHaveAttribute(
      "data-redacted",
      "true"
    );
    expect(container.innerHTML).not.toContain("Ship the presentation lens");
    // The area could name a client, and an unknown scope cannot check it.
    expect(screen.getByTestId("title")).toHaveTextContent(
      "Plan · area withheld · draft · age unknown"
    );
  });

  it("shows first-party text the scope clears", () => {
    render(
      inLens(
        true,
        READY,
        <RedactedText
          text="Ship the presentation lens"
          repo="qontinui/qontinui-web"
          descriptor={DESCRIPTOR}
          data-testid="title"
        />
      )
    );
    expect(screen.getByTestId("title")).toHaveTextContent(
      "Ship the presentation lens"
    );
    expect(screen.getByTestId("title")).toHaveAttribute(
      "data-redacted",
      "false"
    );
  });

  it("withholds a foreign repository's text, leaving no trace of it anywhere in the DOM", () => {
    const { container } = render(
      inLens(
        true,
        READY,
        <RedactedText
          text="Portal login redesign"
          repo="client-org/portal"
          descriptor={DESCRIPTOR}
          data-testid="title"
        />
      )
    );
    expect(screen.getByTestId("title")).toHaveTextContent(
      "Plan · onboarding · draft"
    );
    expect(container.innerHTML).not.toContain("Portal login redesign");
    expect(container.innerHTML).not.toContain("client-org");
    // Withheld, but never WHY — that would itself describe a relationship.
    expect(screen.getByTestId("title").getAttributeNames()).not.toContain(
      "data-redaction-reason"
    );
  });

  it("withholds first-party text that names a confidential term", () => {
    const { container } = render(
      inLens(
        true,
        READY,
        <RedactedText
          text={FOREIGN_TITLE}
          repo="qontinui/qontinui-web"
          descriptor={DESCRIPTOR}
        />
      )
    );
    expect(container.innerHTML).not.toContain("Acme");
  });
});

describe("useRedactor", () => {
  function Labels({ items }: { items: RedactorItem[] }) {
    const redact = useRedactor();
    return (
      <ul>
        {items.map((item, i) => (
          <li key={i} title={redact(item)}>
            {redact(item)}
          </li>
        ))}
      </ul>
    );
  }

  const items: RedactorItem[] = [
    {
      text: "Ship the lens",
      repo: "qontinui/qontinui-web",
      descriptor: DESCRIPTOR,
    },
    {
      text: "Portal login redesign",
      repo: "client-org/portal",
      descriptor: DESCRIPTOR,
    },
  ];

  it("returns the text for the operator", () => {
    render(inLens(false, READY, <Labels items={items} />));
    expect(screen.getByText("Portal login redesign")).toBeInTheDocument();
  });

  it("returns the descriptor for what the scope does not clear, in text and attributes alike", () => {
    const { container } = render(inLens(true, READY, <Labels items={items} />));
    expect(screen.getByText("Ship the lens")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("Portal login redesign");
  });
});

describe("RedactedText — server and hydration renders", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date("2026-10-23T12:00:00Z");
  const ui = inLens(
    true,
    READY,
    <RedactedText
      text={FOREIGN_TITLE}
      repo="client-co/storefront"
      descriptor={{
        ...DESCRIPTOR,
        at: new Date(NOW.getTime() - 3 * 60_000).toISOString(),
      }}
      data-testid="title"
    />
  );

  it("states the descriptor's instant on the server, and hydrates without a mismatch", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const html = renderToString(ui).replace(/<!-- -->/g, "");
    expect(html).toContain("Plan · onboarding · draft · 2026-10-23 11:57 UTC");
    expect(html).not.toContain(FOREIGN_TITLE);

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = html;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, ui);
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="title"]')).toHaveTextContent(
      "Plan · onboarding · draft · 3m ago"
    );
    errors.mockRestore();
    act(() => root?.unmount());
    container.remove();
  });
});
