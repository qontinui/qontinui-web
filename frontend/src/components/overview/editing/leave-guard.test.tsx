import { cleanup, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLeaveGuard } from "./leave-guard";

function Guarded({
  active,
  message = "Leave?",
}: {
  active: boolean;
  message?: string;
}) {
  useLeaveGuard(active, message);
  return null;
}

const MARK = "__overviewLeaveGuard";

/** Back from the guard entry: the browser has already moved to the page's
 *  own entry (same URL, the router's state) when `popstate` fires. */
function pressBack(state: unknown = { router: true }) {
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

let push: ReturnType<typeof vi.spyOn>;
let back: ReturnType<typeof vi.spyOn>;
let confirm: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  window.history.replaceState({ router: true }, "", "/overview/team/edit");
  push = vi.spyOn(window.history, "pushState");
  back = vi.spyOn(window.history, "back").mockImplementation(() => {});
  confirm = vi.spyOn(window, "confirm");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the leave guard on the browser's Back", () => {
  it("pushes no history entry while nothing is unsaved", () => {
    render(<Guarded active={false} />);
    expect(push).not.toHaveBeenCalled();
  });

  it("parks one guard entry, a copy of the router's, when armed", () => {
    const { rerender } = render(<Guarded active={false} />);
    rerender(<Guarded active />);
    rerender(<Guarded active message="Other words" />);
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.history.state).toEqual({ router: true, [MARK]: true });
    expect(window.location.pathname).toBe("/overview/team/edit");
  });

  it("asks on Back, and staying puts the guard entry back", () => {
    render(<Guarded active message="You have unsaved changes." />);
    confirm.mockReturnValue(false);
    pressBack();
    expect(confirm).toHaveBeenCalledWith("You have unsaved changes.");
    expect(back).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledTimes(2);
    expect(window.history.state).toMatchObject({ [MARK]: true });
  });

  it("asks on Back, and leaving finishes the trip", () => {
    render(<Guarded active />);
    confirm.mockReturnValue(true);
    pressBack();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("skips a spent guard entry without asking once the work is saved", () => {
    const { rerender } = render(<Guarded active />);
    rerender(<Guarded active={false} />);
    pressBack();
    expect(confirm).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("does not try to stop a jump of several entries", () => {
    render(<Guarded active />);
    window.history.replaceState({ router: true }, "", "/overview");
    pressBack();
    expect(confirm).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });

  it("guards again after Forward onto its entry", () => {
    render(<Guarded active />);
    confirm.mockReturnValue(true);
    pressBack();
    pressBack({ router: true, [MARK]: true }); // Forward
    pressBack();
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("asks once for two armed editors on one page", () => {
    render(
      <>
        <Guarded active message="First" />
        <Guarded active message="Second" />
      </>
    );
    expect(push).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(false);
    pressBack();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith("First");
  });

  it("knows a guard entry it arrives on, and does not push another", () => {
    window.history.replaceState(
      { router: true, [MARK]: true },
      "",
      "/overview/team/edit"
    );
    render(<Guarded active />);
    expect(push).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    pressBack();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it("parks one entry under StrictMode's double mount", () => {
    render(
      <StrictMode>
        <Guarded active />
      </StrictMode>
    );
    expect(push).toHaveBeenCalledTimes(1);
    confirm.mockReturnValue(false);
    pressBack();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("puts its mark back when the router rewrites the entry", () => {
    const { rerender } = render(<Guarded active />);
    window.history.replaceState({ router: true }, "", "/overview/team/edit");
    rerender(<Guarded active message="Changed" />);
    expect(window.history.state).toEqual({ router: true, [MARK]: true });
  });

  it("does not ask again on unload once Back was confirmed", () => {
    render(<Guarded active />);
    confirm.mockReturnValue(true);
    pressBack();
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<Guarded active />);
    unmount();
    pressBack();
    expect(confirm).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
  });
});

describe("the leave guard on links and unload", () => {
  it("asks before an in-app link and cancels it on stay", () => {
    render(<Guarded active message="Sure?" />);
    const link = document.createElement("a");
    link.href = "/overview";
    document.body.appendChild(link);
    confirm.mockReturnValue(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(confirm).toHaveBeenCalledWith("Sure?");
    expect(click.defaultPrevented).toBe(true);
    link.remove();
  });

  it("lets a link to a place on the same page through", () => {
    render(<Guarded active />);
    const link = document.createElement("a");
    link.href = "#costs";
    document.body.appendChild(link);
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );
    expect(confirm).not.toHaveBeenCalled();
    link.remove();
  });

  it("holds an unload only while armed", () => {
    const { rerender } = render(<Guarded active />);
    const armedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(armedUnload);
    expect(armedUnload.defaultPrevented).toBe(true);
    rerender(<Guarded active={false} />);
    const idleUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(idleUnload);
    expect(idleUnload.defaultPrevented).toBe(false);
  });
});
