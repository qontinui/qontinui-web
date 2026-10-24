import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentProvenanceLine, MirrorsRepoChip } from "./DocumentProvenance";

const sha = "0123456789abcdef0123456789abcdef01234567";
const session = "1d390724-33f3-42f8-98d4-a17ff7621116";
const device = "7c2e9a10-0000-4000-8000-000000000001";
const written = {
  source_repo: null,
  source_path: null,
  source_sha: null,
  via_device: null,
  via_session: null,
};
const mirrored = {
  source_repo: "qontinui/qontinui-dev-notes",
  source_path: "runbooks/ci.md",
  source_sha: sha,
  via_device: device,
  via_session: session,
};

describe("MirrorsRepoChip", () => {
  it("marks a document that mirrors a repository file", () => {
    render(<MirrorsRepoChip page={mirrored} uiBridgeId="t.chip" />);
    const chip = screen.getByText("Mirrors repo");
    expect(chip.className).toContain("badge-info");
    expect(chip.getAttribute("title")).toBe(
      "Mirrors qontinui/qontinui-dev-notes/runbooks/ci.md"
    );
    expect(chip.getAttribute("data-ui-bridge-id")).toBe("t.chip");
  });

  it("renders nothing for a document written here", () => {
    const { container } = render(
      <MirrorsRepoChip page={written} uiBridgeId="t.chip" />
    );
    expect(container.textContent).toBe("");
  });
});

describe("DocumentProvenanceLine", () => {
  it("names the mirrored file and sha, linked to the file at that sha", () => {
    render(<DocumentProvenanceLine page={mirrored} uiBridgeId="t.prov" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe(
      `https://github.com/qontinui/qontinui-dev-notes/blob/${sha}/runbooks/ci.md`
    );
    expect(link.textContent).toBe(
      "qontinui/qontinui-dev-notes/runbooks/ci.md @ 0123456"
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("names the reported session and the device that published it", () => {
    render(<DocumentProvenanceLine page={mirrored} uiBridgeId="t.prov" />);
    const line = document.querySelector(
      '[data-ui-bridge-id="t.prov.publisher"]'
    );
    expect(line?.textContent).toBe(
      "Published by reported session 1d390724 on device 7c2e9a10"
    );
  });

  it("names the device alone when no session was reported", () => {
    render(
      <DocumentProvenanceLine
        page={{ ...written, via_device: device }}
        uiBridgeId="t.prov"
      />
    );
    expect(screen.queryByText(/Mirrors/)).toBeNull();
    expect(
      document.querySelector('[data-ui-bridge-id="t.prov.publisher"]')
        ?.textContent
    ).toBe("Published on device 7c2e9a10");
  });

  it("shows the source unlinked when there is no sha to link to", () => {
    render(
      <DocumentProvenanceLine
        page={{
          ...mirrored,
          source_sha: null,
          via_device: null,
          via_session: null,
        }}
        uiBridgeId="t.prov"
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      document.querySelector('[data-ui-bridge-id="t.prov.source"]')?.textContent
    ).toBe("Mirrors qontinui/qontinui-dev-notes/runbooks/ci.md");
    expect(
      document.querySelector('[data-ui-bridge-id="t.prov.publisher"]')
    ).toBeNull();
  });

  it("shows a bare repo name with no owner unlinked", () => {
    render(
      <DocumentProvenanceLine
        page={{ ...mirrored, source_repo: "qontinui-dev-notes" }}
        uiBridgeId="t.prov"
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      document.querySelector('[data-ui-bridge-id="t.prov.source"]')?.textContent
    ).toBe("Mirrors qontinui-dev-notes/runbooks/ci.md @ 0123456");
  });

  it("renders nothing for a document written here", () => {
    const { container } = render(
      <DocumentProvenanceLine page={written} uiBridgeId="t.prov" />
    );
    expect(container.textContent).toBe("");
  });

  it("treats via fields a list read left out as absent", () => {
    const { container } = render(
      <DocumentProvenanceLine
        page={{ source_repo: null, source_path: null, source_sha: null }}
        uiBridgeId="t.prov"
      />
    );
    expect(container.textContent).toBe("");
  });
});
