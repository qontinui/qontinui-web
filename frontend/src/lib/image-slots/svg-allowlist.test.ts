/**
 * The SVG allowlist refuses every class of markup that could act once an
 * authored SVG is injected through the HTML parser, or once a published SVG is
 * opened as a document. The payload classes are those an independent review
 * probed against the denylist this replaced (attribute boundaries with no
 * whitespace, content after the root, HTML elements that break out of foreign
 * content, character references and whitespace inside URL schemes, animation
 * elements retargeting an href, external fetches through url() / meta refresh
 * / embed / form, CDATA and entity tricks); each is refused here, whatever
 * else the document holds.
 */

import { describe, expect, it } from "vitest";

import {
  DIGITAL_SOURCE_TYPE,
  PUBLISHED_PROFILE,
  SVG_NS,
  SvgRefused,
  authoredProfile,
  checkSvg,
  serializeSvg,
} from "./svg-allowlist";

const parse = (text: string) =>
  new DOMParser().parseFromString(text, "image/svg+xml");

const MARKER =
  '<metadata><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
  `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}"/>` +
  "</rdf:RDF></x:xmpmeta></metadata>";
const doc = (inner: string, attrs = 'viewBox="0 0 4 3"') =>
  `<svg xmlns="${SVG_NS}" ${attrs}>${MARKER}${inner}</svg>`;

const AUTHORED = authoredProfile(false);

function refuses(text: string, profile = AUTHORED): void {
  expect(() => checkSvg(text, profile, parse)).toThrow(SvgRefused);
}

describe("the allowlist accepts", () => {
  it("drawing elements with grammatical values", () => {
    const checked = checkSvg(
      doc(
        '<title>Idle</title><g transform="translate(1, 2) scale(0.5)" opacity="0.8">' +
          '<path d="M0 0 C1 1 2 2 3 3 Z" fill="var(--qontinui-brand-primary)" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>' +
          '<circle cx="1" cy="1" r="0.5" fill="none"/><polygon points="0,0 1,1 2,0"/></g>'
      ),
      AUTHORED,
      parse
    );
    expect(checked.marked).toBe(true);
  });

  it("a studio trace under the published profile (hex fills, version, marker prefixes on the root)", () => {
    const trace =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      `<svg xmlns="${SVG_NS}" xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:x="adobe:ns:meta/" version="1.1" width="320" height="240" viewBox="0 0 320 240">\n` +
      `<metadata><x:xmpmeta><rdf:RDF><rdf:Description rdf:about="" Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}" /></rdf:RDF></x:xmpmeta></metadata>` +
      '<path d="M0 0 C105.6 0 211.2 0 320 0 Z " fill="#651535" transform="translate(0,0)" />\n</svg>\n';
    expect(checkSvg(trace, PUBLISHED_PROFILE, parse).marked).toBe(true);
    // ...but not as an authored SVG: literal colours and `version`.
    refuses(trace);
  });

  it("text, where the slot allows it", () => {
    const text = doc(
      '<text x="1" y="2" font-size="12" text-anchor="middle">Hi <tspan>there</tspan></text>'
    );
    expect(checkSvg(text, authoredProfile(true), parse).marked).toBe(true);
    refuses(text); // text_in_image: forbidden
  });
});

describe("the allowlist refuses", () => {
  it.each([
    // attribute boundaries that need no whitespace
    [
      "an attribute glued to the previous value",
      doc('<rect x="1"onclick="alert(1)"/>'),
    ],
    ["an attribute after a slash", doc('<rect/onclick="alert(1)"/>')],
    ["an event handler in another case", doc('<rect ONCLICK = "x()"/>')],
    [
      "an event handler on an allowed element",
      doc('<path d="M0 0" onload="x()"/>'),
    ],
    // content outside the one root
    ["content after </svg>", `${doc("")}<iframe srcdoc="x"></iframe>`],
    ["a comment after </svg>", `${doc("")}<!-- x -->`],
    ["a second root", `${doc("")}${doc("")}`],
    [
      "a processing instruction",
      doc('<?xml-stylesheet href="https://evil.example/x.css"?>'),
    ],
    // HTML elements that break out of foreign content
    ["an <img> breakout", doc('<img/src="x"/onerror="alert(1)">')],
    [
      "a <p> breakout holding an iframe",
      doc(
        '<p><iframe srcdoc="&lt;img src=x onerror=parent.alert(1)&gt;"></iframe></p>'
      ),
    ],
    [
      "an XHTML <img> tracker",
      doc(
        '<img xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/pixel"/>'
      ),
    ],
    [
      "an XHTML meta refresh",
      doc(
        '<meta xmlns="http://www.w3.org/1999/xhtml" http-equiv="refresh" content="0;url=https://evil.example"/>'
      ),
    ],
    [
      "an XHTML <embed>",
      doc(
        '<embed xmlns="http://www.w3.org/1999/xhtml" src="data:image/svg+xml;base64,PHN2Zz4="/>'
      ),
    ],
    [
      "an XHTML <form>",
      doc(
        '<form xmlns="http://www.w3.org/1999/xhtml" action="https://evil.example"><button>x</button></form>'
      ),
    ],
    ["a <foreignObject>", doc("<foreignObject><div>x</div></foreignObject>")],
    // scripts, styles, links
    ["a <script> in CDATA", doc("<script><![CDATA[alert(1)]]></script>")],
    ["a <style>", doc("<style>rect{fill:url(https://evil.example/x)}</style>")],
    ["an <a href>", doc('<a href="https://evil.example"><rect/></a>')],
    [
      "a <use xlink:href>",
      doc(
        '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://evil.example/x.svg#a"/>'
      ),
    ],
    ["an <image>", doc('<image href="https://evil.example/x.png"/>')],
    // character references and whitespace inside URL schemes, via animation
    [
      "<animate> retargeting href with a character reference",
      doc('<animate attributeName="href" values="&#106;avascript:alert(1)"/>'),
    ],
    [
      "<set> retargeting href with a newline",
      doc('<set attributeName="href" to="java&#10;script:alert(1)"/>'),
    ],
    // external fetches
    [
      "url() in a style attribute",
      doc('<rect style="fill:url(https://evil.example/x)"/>'),
    ],
    ["url() in a fill", doc('<rect fill="url(https://evil.example/x#p)"/>')],
    [
      "url() in a stroke, spaced",
      doc('<rect stroke="url (https://evil.example/x)"/>'),
    ],
    [
      "url() smuggled into a transform",
      doc('<g transform="url(https://evil.example/x)"/>'),
    ],
    ["a filter reference", doc('<rect filter="url(#f)"/>')],
    // DTD and entities
    [
      "an entity expanding to a script",
      `<!DOCTYPE svg [<!ENTITY s "<script>alert(1)</script>">]>${doc("&s;")}`,
    ],
    ["a bare DOCTYPE", `<!DOCTYPE svg>${doc("")}`],
    // malformed, or not SVG
    [
      "a document that is not well-formed",
      `<svg xmlns="${SVG_NS}"><rect></svg>`,
    ],
    [
      "a root outside the SVG namespace",
      '<svg viewBox="0 0 4 3"><rect/></svg>',
    ],
    ["a nested <svg>", doc(`<svg><rect/></svg>`)],
    ["an unknown attribute", doc('<rect data-x="1"/>')],
    ["a literal colour (authored)", doc('<rect fill="#ff0000"/>')],
    ["a named colour", doc('<rect fill="red"/>')],
    ["path data that is not path data", doc('<path d="M0 0 url(x)"/>')],
    ["text where the slot forbids it", doc("<text>hi</text>")],
    ["stray text in a drawing element", doc("<g>hi</g>")],
    ["markup inside <title>", doc("<title><rect/></title>")],
    [
      "a foreign namespace declaration",
      doc("", `viewBox="0 0 4 3" xmlns:evil="https://evil.example/ns"`),
    ],
  ])("%s", (_, text) => {
    refuses(text);
  });

  describe("inside <metadata>", () => {
    const meta = (inner: string) =>
      `<svg xmlns="${SVG_NS}" viewBox="0 0 4 3"><metadata>${inner}</metadata></svg>`;
    it.each([
      ["a script", "<script>alert(1)</script>"],
      [
        "an XHTML element",
        '<img xmlns="http://www.w3.org/1999/xhtml" src="https://evil.example/p"/>',
      ],
      [
        "two packets",
        MARKER.replace("<metadata>", "").replace("</metadata>", "").repeat(2),
      ],
      [
        "an extra element in the packet",
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><foo/></x:xmpmeta>',
      ],
      [
        "an extra Description attribute",
        MARKER.replace("<metadata>", "")
          .replace("</metadata>", "")
          .replace(
            'rdf:about=""',
            'rdf:about="" rdf:resource="https://evil.example"'
          ),
      ],
      [
        "a non-empty rdf:about",
        MARKER.replace("<metadata>", "")
          .replace("</metadata>", "")
          .replace('rdf:about=""', 'rdf:about="https://evil.example"'),
      ],
      [
        "another source type",
        MARKER.replace("<metadata>", "")
          .replace("</metadata>", "")
          .replace(
            DIGITAL_SOURCE_TYPE,
            "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"
          ),
      ],
      [
        "a child of the Description",
        MARKER.replace("<metadata>", "")
          .replace("</metadata>", "")
          .replace("/>", "><rdf:li>x</rdf:li></rdf:Description>"),
      ],
      ["text", "hello"],
    ])("%s", (_, inner) => {
      refuses(meta(inner));
    });

    it("refuses a second <metadata>", () => {
      refuses(doc(MARKER));
    });
  });
});

describe("each layer refuses for its own reason", () => {
  // One payload per layer, each with the reason that layer gives, so a layer
  // removed is a red test even where another layer would also have refused.
  it.each<[string, string, RegExp]>([
    [
      "the element allowlist",
      doc('<animate attributeName="href" values="x"/>'),
      /element <animate> is not allowed/,
    ],
    [
      "the SVG namespace, for an allowed local name",
      doc('<rect xmlns="http://www.w3.org/1999/xhtml"/>'),
      /element <rect> is not allowed/,
    ],
    [
      "the attribute allowlist",
      doc('<path d="M0 0" onload="x()"/>'),
      /<path> attribute onload is not allowed/,
    ],
    [
      "a namespaced attribute",
      doc('<rect xmlns:xlink="http://www.w3.org/1999/xlink" xlink:title="x"/>'),
      /namespace declaration xmlns:xlink/,
    ],
    [
      "the attribute grammar",
      doc('<g transform="rotate(45) evil"/>'),
      /<g transform> has a value its grammar does not admit/,
    ],
    [
      "the colour rule",
      doc('<rect fill="red"/>'),
      /<rect fill> has a value its grammar does not admit/,
    ],
    [
      "the url() guard, on free text",
      doc('<path d="M0 0" aria-label="url(https://evil.example)"/>'),
      /<path aria-label> carries a value that is not allowed/,
    ],
    [
      "the DTD guard",
      `<!DOCTYPE svg>${doc("")}`,
      /a DTD or entity declaration is not allowed/,
    ],
    [
      "the one-root rule",
      `${doc("")}<!-- x -->`,
      /one <svg> root with nothing before or after it/,
    ],
    [
      "the well-formedness check",
      `<svg xmlns="${SVG_NS}"><rect></svg>`,
      /not a well-formed XML document/,
    ],
    [
      "the CDATA rule",
      doc("<title><![CDATA[x]]></title>"),
      /a CDATA section is not allowed/,
    ],
    [
      "the metadata allowlist",
      `<svg xmlns="${SVG_NS}" viewBox="0 0 4 3"><metadata><script/></metadata></svg>`,
      /may hold only the IPTC marker's XMP/,
    ],
  ])("%s", (_, text, reason) => {
    expect(() => checkSvg(text, AUTHORED, parse)).toThrow(reason);
  });
});

describe("serializeSvg", () => {
  it("escapes text, so markup inside <title> stays text through the HTML parser", () => {
    const checked = checkSvg(
      doc("<title>&lt;img src=x onerror=alert(1)&gt; &amp; more</title>"),
      AUTHORED,
      parse
    );
    const host = document.createElement("div");
    host.innerHTML = serializeSvg(checked);
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("title")?.textContent).toBe(
      "<img src=x onerror=alert(1)> & more"
    );
  });

  it("produces only allowlisted SVG elements and attributes once parsed as HTML", () => {
    const checked = checkSvg(
      doc(
        '<!-- dropped --><g opacity="0.5"><path d="M0 0" aria-label="a &quot;quoted&quot; label" fill="none"/></g>'
      ),
      AUTHORED,
      parse
    );
    const host = document.createElement("div");
    host.innerHTML = serializeSvg(checked);
    for (const el of Array.from(host.querySelectorAll("*"))) {
      expect(el.namespaceURI).toBe(SVG_NS);
      for (const attr of Array.from(el.attributes)) {
        expect(attr.name.startsWith("on")).toBe(false);
      }
    }
    expect(host.innerHTML).not.toContain("dropped");
    expect(host.querySelector("path")?.getAttribute("aria-label")).toBe(
      'a "quoted" label'
    );
  });
});
