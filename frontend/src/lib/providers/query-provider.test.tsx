import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-query-devtools", () => ({
  ReactQueryDevtools: () => <div data-testid="rq-devtools" />,
}));

import { QueryProvider } from "./query-provider";

// The CI style gate sets NEXT_PUBLIC_HIDE_DEV_OVERLAYS=1 so dev-only chrome
// stays out of its captured frames (qontinui-web#1879 saw the devtools toggle
// reported as a CRITICAL layout occlusion). Without the flag, dev keeps it.
describe("QueryProvider devtools", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the devtools toggle in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_HIDE_DEV_OVERLAYS", "");
    render(<QueryProvider>app</QueryProvider>);
    expect(screen.getByTestId("rq-devtools")).toBeTruthy();
  });

  it("omits the devtools toggle when NEXT_PUBLIC_HIDE_DEV_OVERLAYS=1", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_HIDE_DEV_OVERLAYS", "1");
    render(<QueryProvider>app</QueryProvider>);
    expect(screen.queryByTestId("rq-devtools")).toBeNull();
    expect(screen.getByText("app")).toBeTruthy();
  });

  it("omits the devtools toggle outside development", () => {
    vi.stubEnv("NODE_ENV", "production");
    render(<QueryProvider>app</QueryProvider>);
    expect(screen.queryByTestId("rq-devtools")).toBeNull();
  });
});
