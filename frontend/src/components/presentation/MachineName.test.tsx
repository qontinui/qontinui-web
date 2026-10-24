/**
 * MachineName / useMachineName / useMachineAliaser (plan
 * `2026-10-23-console-presentation-spaces` D3.3): the real name for the
 * operator, the session alias in presentation mode — the same alias on every
 * panel — and no hostname anywhere in a presentation-mode DOM.
 */

import { act, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sessionMachineAliases } from "./machineAliases";
import {
  MachineName,
  SERVER_MACHINE_ALIAS,
  UNKNOWN_MACHINE_NAME,
  useMachineAliaser,
} from "./MachineName";
import { FixedPresentationMode } from "./PresentationModeProvider";

const BUILD_HOST = {
  deviceId: "0b9d6a54-0000-4000-8000-0000000000aa",
  hostname: "build-host-1",
  displayName: "Build host",
};
const LAPTOP = { hostname: "laptop-7" };

beforeEach(() => {
  sessionMachineAliases.reset();
});

describe("MachineName", () => {
  it("renders the real name for the operator, best field first", () => {
    render(
      <FixedPresentationMode presenting={false}>
        <MachineName identity={BUILD_HOST} data-testid="a" />
        <MachineName
          identity={BUILD_HOST}
          label="Build host (rack 2)"
          data-testid="b"
        />
        <MachineName
          identity={{ deviceId: BUILD_HOST.deviceId }}
          data-testid="c"
        />
        <MachineName identity={{}} data-testid="d" />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("a")).toHaveTextContent("Build host");
    expect(screen.getByTestId("b")).toHaveTextContent("Build host (rack 2)");
    expect(screen.getByTestId("c")).toHaveTextContent(BUILD_HOST.deviceId);
    expect(screen.getByTestId("d")).toHaveTextContent(UNKNOWN_MACHINE_NAME);
    expect(screen.getByTestId("a")).toHaveAttribute(
      "data-machine-alias",
      "false"
    );
  });

  it("renders the alias in presentation mode, and no identifier anywhere", () => {
    const { container } = render(
      <FixedPresentationMode presenting>
        <MachineName identity={BUILD_HOST} data-testid="a" />
        <MachineName identity={LAPTOP} data-testid="b" />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("a")).toHaveTextContent("Machine A");
    expect(screen.getByTestId("b")).toHaveTextContent("Machine B");
    expect(screen.getByTestId("a")).toHaveAttribute(
      "data-machine-alias",
      "true"
    );
    for (const leak of [
      "build-host-1",
      "Build host",
      "laptop-7",
      BUILD_HOST.deviceId,
    ]) {
      expect(container.innerHTML).not.toContain(leak);
    }
  });

  it("keeps one alias per machine across panels that hold different identifiers", () => {
    render(
      <FixedPresentationMode presenting>
        <section>
          <MachineName identity={BUILD_HOST} data-testid="machine-list" />
        </section>
        <section>
          <MachineName
            identity={{ hostname: "BUILD-HOST-1" }}
            data-testid="ui-bridge"
          />
          <MachineName
            identity={{ deviceId: BUILD_HOST.deviceId }}
            data-testid="spawns"
          />
        </section>
      </FixedPresentationMode>
    );
    for (const id of ["machine-list", "ui-bridge", "spawns"]) {
      expect(screen.getByTestId(id)).toHaveTextContent("Machine A");
    }
  });

  it("keeps the alias across a remount — a navigation to another lens page", () => {
    const { unmount } = render(
      <FixedPresentationMode presenting>
        <MachineName identity={LAPTOP} />
        <MachineName identity={BUILD_HOST} />
      </FixedPresentationMode>
    );
    unmount();
    render(
      <FixedPresentationMode presenting>
        <MachineName identity={BUILD_HOST} data-testid="again" />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("again")).toHaveTextContent("Machine B");
  });

  it("renders a generic alias on the server, touching no session state", () => {
    const html = renderToString(
      <FixedPresentationMode presenting>
        <MachineName identity={BUILD_HOST} />
      </FixedPresentationMode>
    );
    expect(html).toContain(`>${SERVER_MACHINE_ALIAS}<`);
    expect(html).not.toContain("build-host-1");
    // Nothing was assigned: the first client sight still gets the first letter.
    render(
      <FixedPresentationMode presenting>
        <MachineName identity={LAPTOP} data-testid="first" />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("first")).toHaveTextContent("Machine A");
  });
});

describe("useMachineAliaser", () => {
  function Options({ machines }: { machines: Array<{ hostname: string }> }) {
    const nameOf = useMachineAliaser();
    return (
      <select aria-label="machine">
        {machines.map((m) => (
          <option key={m.hostname}>{nameOf(m)}</option>
        ))}
      </select>
    );
  }

  it("names many machines from one component, in either mode", () => {
    const machines = [{ hostname: "build-host-1" }, { hostname: "laptop-7" }];
    const { rerender } = render(
      <FixedPresentationMode presenting={false}>
        <Options machines={machines} />
      </FixedPresentationMode>
    );
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "build-host-1",
      "laptop-7",
    ]);
    rerender(
      <FixedPresentationMode presenting>
        <Options machines={machines} />
      </FixedPresentationMode>
    );
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Machine A",
      "Machine B",
    ]);
  });

  const MACHINES = [{ hostname: "build-host-1" }, { hostname: "laptop-7" }];
  const presentingOptions = (
    <FixedPresentationMode presenting>
      <Options machines={MACHINES} />
    </FixedPresentationMode>
  );

  it("names every machine generically on the server, assigning no letter", () => {
    const html = renderToString(presentingOptions);
    expect(
      html.match(new RegExp(`>${SERVER_MACHINE_ALIAS}<`, "g"))
    ).toHaveLength(2);
    expect(html).not.toContain("Machine A");
    expect(html).not.toContain("build-host-1");
    // The process-wide registry was untouched: the first client sight is A.
    render(
      <FixedPresentationMode presenting>
        <MachineName identity={LAPTOP} data-testid="first" />
      </FixedPresentationMode>
    );
    expect(screen.getByTestId("first")).toHaveTextContent("Machine A");
  });

  it("hydrates the server HTML without a mismatch, then aliases on the client", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(presentingOptions);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, presentingOptions);
    });

    expect(errors).not.toHaveBeenCalled();
    expect(
      [...container.querySelectorAll("option")].map((o) => o.textContent)
    ).toEqual(["Machine A", "Machine B"]);
    errors.mockRestore();
    act(() => root?.unmount());
    container.remove();
  });
});
