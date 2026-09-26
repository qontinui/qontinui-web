import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageRecord } from "../_lib/pages";

const api = vi.hoisted(() => ({
  readOverview: vi.fn(),
  postWithVersion: vi.fn(),
}));
vi.mock("@/components/overview/editing/api", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

import { VersionConflictError } from "@/components/overview/editing/api";
import { PageHistory } from "./PageHistory";

const page: PageRecord = {
  id: "p1",
  kind: "wiki",
  slug: "budget",
  title: "Budget",
  body_md: "now",
  excerpt: "now",
  doc_number: null,
  doc_status: null,
  owner: null,
  related: [],
  version: 2,
  created_at: "2026-09-26T00:00:00Z",
  updated_at: "2026-09-26T00:00:00Z",
  created_by: null,
  updated_by: null,
};

async function openVersionOne(canEdit: boolean, onRestored = vi.fn()) {
  api.readOverview.mockImplementation(async (path: string) =>
    path.endsWith("/versions")
      ? {
          current_version: 2,
          versions: [
            {
              version: 2,
              title: "Budget",
              created_at: page.updated_at,
              created_by: null,
            },
            {
              version: 1,
              title: "Budget",
              created_at: page.created_at,
              created_by: null,
            },
          ],
        }
      : {
          version: 1,
          title: "Budget",
          body_md: "before",
          created_at: page.created_at,
          created_by: null,
          doc_number: null,
          doc_status: null,
          owner: null,
        }
  );
  render(
    <PageHistory
      page={page}
      canEdit={canEdit}
      onRestored={onRestored}
      uiBridgeId="t.h"
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Version history (2)" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Read version 1" })
  );
  await screen.findByText("before");
  return onRestored;
}

describe("PageHistory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets a reader read an old version but not restore it", async () => {
    await openVersionOne(false);
    expect(
      screen.queryByRole("button", { name: "Restore this version" })
    ).toBeNull();
  });

  it("restores by writing a new version on the one on screen", async () => {
    api.postWithVersion.mockResolvedValue({
      ...page,
      version: 3,
      body_md: "before",
    });
    const onRestored = await openVersionOne(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" })
    );
    expect(
      await screen.findByText("Version 1 is restored, as version 3.")
    ).toBeTruthy();
    expect(api.postWithVersion).toHaveBeenCalledWith(
      "pages/p1/versions/1/revert",
      2
    );
    expect(onRestored).toHaveBeenCalledWith(
      expect.objectContaining({ version: 3 })
    );
  });

  it("says so when the version restored already matches the page", async () => {
    api.postWithVersion.mockResolvedValue({ ...page, version: 2 });
    await openVersionOne(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" })
    );
    expect(
      await screen.findByText(
        "Version 1 already matches the page, so nothing changed."
      )
    ).toBeTruthy();
  });

  it("shows the version asked for last, not the one whose reply came last", async () => {
    const versionRecord = (version: number, body_md: string) => ({
      version,
      title: "Budget",
      body_md,
      created_at: page.created_at,
      created_by: null,
      doc_number: null,
      doc_status: null,
      owner: null,
    });
    let answerOne: (v: unknown) => void = () => {};
    api.readOverview.mockImplementation(async (path: string) => {
      if (path.endsWith("/versions")) {
        return {
          current_version: 3,
          versions: [3, 2, 1].map((v) => ({
            version: v,
            title: "Budget",
            created_at: page.created_at,
            created_by: null,
          })),
        };
      }
      if (path.endsWith("/versions/1")) {
        return new Promise((resolve) => (answerOne = resolve));
      }
      return versionRecord(2, "second");
    });
    render(
      <PageHistory
        page={{ ...page, version: 3 }}
        canEdit={false}
        onRestored={vi.fn()}
        uiBridgeId="t.h"
      />
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Version history (3)" })
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Read version 1" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Read version 2" }));
    await screen.findByText("second");
    answerOne(versionRecord(1, "first, but late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("first, but late")).toBeNull();
    expect(screen.getByText("second")).toBeTruthy();
  });

  it("restores nothing over a newer save, and shows theirs", async () => {
    const theirs = { ...page, version: 3, body_md: "theirs" };
    api.postWithVersion.mockRejectedValue(new VersionConflictError(theirs));
    const onRestored = await openVersionOne(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Restore this version" })
    );
    expect(await screen.findByText(/so nothing was restored/)).toBeTruthy();
    expect(onRestored).toHaveBeenCalledWith(theirs);
  });
});
