import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CatalogUnknownBanners } from "./CatalogUnknownBanners";

describe("CatalogUnknownBanners", () => {
  it("says the switches show an earlier read when one is still on screen", () => {
    render(
      <CatalogUnknownBanners
        sourcesUnread={[]}
        loadError="Failed to fetch"
        stale
        onRetry={vi.fn()}
      />
    );
    const banner = screen.getByTestId("agent-catalog-load-error");
    expect(banner).toHaveTextContent("show an earlier read");
    expect(banner).not.toHaveTextContent("reads Unknown");
  });

  it("says every switch reads Unknown when nothing was ever read", () => {
    render(
      <CatalogUnknownBanners
        sourcesUnread={[]}
        loadError="Failed to fetch"
        stale={false}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId("agent-catalog-load-error")).toHaveTextContent(
      "every spawn switch reads Unknown"
    );
  });
});
