import { afterEach, describe, expect, it } from "vitest";
import { attributesNaming } from "./attributesNaming";

function mount(html: string): Element {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("attributesNaming", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("finds a name in a descendant's attribute, href and data-* included", () => {
    const root = mount(
      '<section><a href="/p/acme-corp">x</a><span data-project="Acme Corp">y</span></section>'
    );
    expect(attributesNaming(root, "acme corp")).toEqual([
      'span[data-project="Acme Corp"]',
    ]);
    expect(attributesNaming(root, "acme-corp")).toEqual([
      'a[href="/p/acme-corp"]',
    ]);
  });

  it("reads the root's own attributes", () => {
    const root = mount("");
    root.setAttribute("title", "Acme Corp");
    expect(attributesNaming(root, "Acme Corp")).toEqual([
      'div[title="Acme Corp"]',
    ]);
  });

  it("matches case-insensitively and finds nothing for a blank needle", () => {
    const root = mount('<i aria-label="ACME CORP"></i>');
    expect(attributesNaming(root, "acme corp")).toHaveLength(1);
    expect(attributesNaming(root, "   ")).toEqual([]);
  });

  it("is empty when no attribute names it", () => {
    const root = mount('<b class="x" data-id="1"></b>');
    expect(attributesNaming(root, "Acme Corp")).toEqual([]);
  });
});
