/**
 * `overview-risks` on the Summary (plan
 * `2026-11-07-interactive-stakeholder-reports-in-the-project-overview` D3):
 * risks are not built yet, so the block says so in the voice of the section
 * that will hold them — never an empty list, which would read as "no risks".
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/overview/editing/api", async (original) => ({
  ...(await original<object>()),
  fetchChangeLog: vi.fn(async () => ({ entries: [], truncated: false })),
}));
vi.mock("@/components/overview/editing/permissions", () => ({
  useResourceDescriptor: () => null,
}));

import { InIntentSection, fence } from "./__fixtures__/render";

describe("overview-risks", () => {
  it("says risks aren't available yet, and what the block will show — never an empty list", async () => {
    render(<InIntentSection body={fence("overview-risks top=5")} />);
    expect(await screen.findByText("Risks aren't available yet")).toBeTruthy();
    const block = document.querySelector(
      '[data-overview-block="overview-risks"]'
    )!;
    expect(block.textContent).toMatch(
      /What could go wrong, and which decisions are still open\. When Risks & Decisions is ready, this block will show the project's top 5 risks\./
    );
    expect(block.querySelector("ul, ol, li, table")).toBeNull();
  });

  it("reads without a count too", async () => {
    render(<InIntentSection body={fence("overview-risks")} />);
    await screen.findByText("Risks aren't available yet");
    expect(
      document.querySelector('[data-overview-block="overview-risks"]')!
        .textContent
    ).toMatch(/show the project's top risks\./);
  });
});
