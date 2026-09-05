/**
 * `/admin/coord/onboarding` reads `?connect=<org>` — the onboarding-status
 * recover card's hand-off (plan
 * `2026-09-05-tenant-onboarding-friction-and-multi-tenant-device-visibility`
 * P4) — and prefills the already-installed connect card with it. An invalid
 * value is dropped rather than rendered.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

// The three children do their own coord reads on mount; only the prop
// hand-off is under test here.
vi.mock("@/components/operations/ConnectGitHubOrg", () => ({
  ConnectGitHubOrg: () => null,
}));
vi.mock("@/components/operations/MergeOrchestrationOnboarding", () => ({
  MergeOrchestrationOnboarding: () => null,
}));
vi.mock("@/components/operations/ConnectInstalledOrg", () => ({
  ConnectInstalledOrg: ({ defaultOrg }: { defaultOrg?: string }) => (
    <div data-testid="connect-installed-org-stub">{defaultOrg ?? ""}</div>
  ),
}));

import OnboardingPage from "./page";

beforeEach(() => {
  mockSearchParams = new URLSearchParams();
});

describe("onboarding page ?connect= hand-off", () => {
  it("prefills ConnectInstalledOrg from a valid ?connect=", () => {
    mockSearchParams = new URLSearchParams({ connect: "portofino-pizzeria" });
    render(<OnboardingPage />);
    expect(screen.getByTestId("connect-installed-org-stub")).toHaveTextContent(
      "portofino-pizzeria"
    );
  });

  it("passes nothing without ?connect=", () => {
    render(<OnboardingPage />);
    expect(screen.getByTestId("connect-installed-org-stub")).toHaveTextContent("");
  });

  it("drops a ?connect= that is not a valid GitHub login", () => {
    mockSearchParams = new URLSearchParams({ connect: "<script>alert(1)</script>" });
    render(<OnboardingPage />);
    expect(screen.getByTestId("connect-installed-org-stub")).toHaveTextContent("");
  });
});
