/**
 * GithubHostPanel — github.com default, a configured host, UNKNOWN, and a
 * refused write must each read differently.
 *
 * The hook is mocked; the refusal parsing is covered in
 * `../_lib/githubHostRefusal.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const useHostMock = vi.fn();
vi.mock("../_hooks/useTenantGithubHost", () => ({
  useTenantGithubHost: () => useHostMock(),
}));

import { GithubHostPanel } from "./GithubHostPanel";

function hookState(
  host: Record<string, unknown> | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    host,
    loading: false,
    saving: false,
    error: null,
    writeError: null,
    reload: vi.fn(),
    save: vi.fn().mockResolvedValue(true),
    reset: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

const GITHUB_COM = {
  api_base: "https://api.github.com",
  web_base: "https://github.com",
  graphql_url: "https://api.github.com/graphql",
  configured: false,
  can_edit: true,
};

const GHES = {
  api_base: "https://ghe.example.com/api/v3",
  web_base: "https://ghe.example.com",
  graphql_url: "https://ghe.example.com/api/graphql",
  configured: true,
  can_edit: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GithubHostPanel", () => {
  it("reads the github.com default as unset, with an empty form and no reset", () => {
    useHostMock.mockReturnValue(hookState(GITHUB_COM));
    render(<GithubHostPanel />);

    expect(screen.getByTestId("github-host-effective")).toHaveTextContent(
      "https://github.com"
    );
    expect(screen.getByTestId("github-host-source")).toHaveTextContent(
      /the default; no host is set/
    );
    expect(screen.getByTestId("github-host-web-base")).toHaveValue("");
    expect(screen.queryByTestId("github-host-reset")).toBeNull();
    expect(screen.getByTestId("github-host-save")).toBeDisabled();
  });

  it("shows a configured host, seeds the form from it and offers a reset", () => {
    const state = hookState(GHES);
    useHostMock.mockReturnValue(state);
    render(<GithubHostPanel />);

    expect(screen.getByTestId("github-host-source")).toHaveTextContent(
      /set for this tenant/
    );
    expect(screen.getByTestId("github-host-api")).toHaveTextContent(
      "https://ghe.example.com/api/graphql"
    );
    expect(screen.getByTestId("github-host-api-base")).toHaveValue(
      "https://ghe.example.com/api/v3"
    );
    // Unchanged from what coord stores: nothing to save.
    expect(screen.getByTestId("github-host-save")).toBeDisabled();

    fireEvent.click(screen.getByTestId("github-host-reset"));
    expect(state.reset).toHaveBeenCalledTimes(1);
  });

  it("saves the trimmed bases the operator typed", () => {
    const state = hookState(GITHUB_COM);
    useHostMock.mockReturnValue(state);
    render(<GithubHostPanel />);

    fireEvent.change(screen.getByTestId("github-host-web-base"), {
      target: { value: " https://ghe.example.com " },
    });
    fireEvent.change(screen.getByTestId("github-host-api-base"), {
      target: { value: "https://ghe.example.com/api/v3" },
    });
    fireEvent.click(screen.getByTestId("github-host-save"));

    expect(state.save).toHaveBeenCalledWith({
      api_base: "https://ghe.example.com/api/v3",
      web_base: "https://ghe.example.com",
    });
  });

  it("never renders an UNKNOWN read as github.com", () => {
    useHostMock.mockReturnValue(
      hookState(null, { error: "coord is not reachable" })
    );
    render(<GithubHostPanel />);

    expect(screen.getByTestId("github-host-effective")).toHaveTextContent(
      "unknown"
    );
    expect(screen.getByTestId("github-host-source")).toHaveTextContent(
      /is unknown/
    );
    expect(screen.getByTestId("github-host-error")).toHaveTextContent(
      /The current host is unknown/
    );
    expect(screen.getByTestId("github-host-readonly")).toHaveTextContent(
      /role could not be read/
    );
  });

  it("is read-only for a non-admin", () => {
    useHostMock.mockReturnValue(hookState({ ...GHES, can_edit: false }));
    render(<GithubHostPanel />);

    expect(screen.getByTestId("github-host-web-base")).toBeDisabled();
    expect(screen.getByTestId("github-host-reset")).toBeDisabled();
    expect(screen.getByTestId("github-host-readonly")).toHaveTextContent(
      /admin_required/
    );
  });

  it("lists the repos that block a host change", () => {
    useHostMock.mockReturnValue(
      hookState(GITHUB_COM, {
        writeError: {
          code: "repos_registered_on_another_host",
          message: "Repos enrolled in this tenant are registered elsewhere",
          repos: [
            {
              repo: "acme/app",
              github_remote: "https://github.com/acme/app.git",
            },
          ],
        },
      })
    );
    render(<GithubHostPanel />);

    expect(screen.getByTestId("github-host-write-error")).toHaveAttribute(
      "data-refusal",
      "repos_registered_on_another_host"
    );
    expect(screen.getByTestId("github-host-blocking-repos")).toHaveTextContent(
      "acme/app"
    );
  });
  it("keeps the configured host in the form when a reset is refused", async () => {
    const state = hookState(GHES, { reset: vi.fn().mockResolvedValue(false) });
    useHostMock.mockReturnValue(state);
    render(<GithubHostPanel />);

    fireEvent.click(screen.getByTestId("github-host-reset"));
    await Promise.resolve();
    await Promise.resolve();
    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("github-host-web-base")).toHaveValue(
      "https://ghe.example.com"
    );
  });
});
