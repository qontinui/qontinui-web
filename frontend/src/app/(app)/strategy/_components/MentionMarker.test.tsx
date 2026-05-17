import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MentionMarker } from "./MentionMarker";
import { USER_CACHE_KEY } from "./use-user-cache";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const UID = "11111111-2222-3333-4444-555555555555";

function renderWithClient(ui: React.ReactNode, seed: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(USER_CACHE_KEY, seed);
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("<MentionMarker>", () => {
  it("renders @display when cache hit", () => {
    renderWithClient(<MentionMarker userId={UID} />, {
      [UID]: { id: UID, display: "alice", email: "alice@x" },
    });
    expect(screen.getByText("@alice")).toBeInTheDocument();
    const link = screen.getByTestId("mention-marker");
    expect(link.getAttribute("href")).toBe(`/users/${UID}`);
  });

  it("renders @? on cache miss", () => {
    renderWithClient(<MentionMarker userId={UID} />, {});
    expect(screen.getByText("@?")).toBeInTheDocument();
  });

  it("case-insensitive cache lookup", () => {
    renderWithClient(<MentionMarker userId={UID.toUpperCase()} />, {
      [UID.toLowerCase()]: { id: UID, display: "bob", email: "b@x" },
    });
    expect(screen.getByText("@bob")).toBeInTheDocument();
  });
});
