/**
 * The SVG allowlist: what an image slot's SVG may contain, checked on a real
 * XML parse, and the re-serialisation an inline SVG is rendered from.
 *
 * Plan 2026-10-13-image-generation-and-visual-judgment, Phase 14. Two kinds of
 * SVG reach this app through image slots:
 *
 * - an AGENT-AUTHORED SVG (`image-slots/<slot>.svg`, studio's `svg` route),
 *   which `<SlotImage>` renders INLINE, i.e. through the HTML parser into the
 *   page's own DOM;
 * - a PUBLISHED SVG (`public/image-slots/*.svg`, a studio trace), which the
 *   page loads through `<img>`, but which is also a same-origin document when
 *   opened directly.
 *
 * Both are checked against an ALLOWLIST, never a denylist: a denylist of
 * spellings cannot keep up with the HTML parser an inline SVG goes through.
 * The text is parsed as XML (a parse error, a DTD, a stray top-level node or
 * a second root is refused); every element must be one of the SVG-namespace
 * elements below, every attribute one of the attributes below, and every
 * attribute VALUE must match that attribute's own grammar. The element and
 * attribute lists mirror qontinui-studio's `compiler/selected.py`
 * (`DRAWING_ELEMENTS`, `DESCRIPTIVE_ELEMENTS`, `TEXT_ELEMENTS`, `ATTRIBUTES`,
 * `TEXT_ATTRIBUTES`, `COLOUR_ATTRIBUTES`, `TOKEN_COLOUR`), which validates the
 * same files on the studio side; this module is the web side's own authority.
 *
 * `<metadata>` is not skipped: it may hold exactly the IPTC marker's XMP
 * (`x:xmpmeta` > `rdf:RDF` > `rdf:Description` with `rdf:about=""` and
 * `Iptc4xmpExt:DigitalSourceType`) and nothing else.
 *
 * An inline SVG is rendered from {@link serializeSvg}'s output, rebuilt from
 * the checked tree with every name taken from the allowlist and every value
 * escaped, and its `<metadata>` replaced by the canonical marker. The
 * original text is never passed through.
 *
 * The parser is injected (`XmlParse`): the generator script hands it jsdom's
 * `DOMParser`, the tests the one their jsdom environment provides.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";
const XMLNS_NS = "http://www.w3.org/2000/xmlns/";
const X_NS = "adobe:ns:meta/";
const RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const IPTC_NS = "http://iptc.org/std/Iptc4xmpExt/2008-02-29/";
/** The IPTC digital source type of AI-generated media. */
export const DIGITAL_SOURCE_TYPE =
  "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia";

/** Parses XML text into a DOM `Document` (a `DOMParser` with
 *  `image/svg+xml`). */
export type XmlParse = (text: string) => Document;

/** Why an SVG is refused. */
export class SvgRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SvgRefused";
  }
}

/** Which SVGs a check is for. */
export interface SvgProfile {
  /** `<text>` / `<tspan>` and their attributes: a slot whose
   *  `text_in_image` is not `forbidden`. */
  allowText: boolean;
  /** `tokens`: `none`, `currentColor` or `var(--qontinui-*)` only (an
   *  authored SVG takes its colour from the page). `tokens_or_hex` also
   *  admits `#rgb` / `#rrggbb` (a published trace keeps its own colours). */
  colours: "tokens" | "tokens_or_hex";
  /** The root's `version` attribute, which a trace carries. */
  allowVersion: boolean;
}

/** The profile of an agent-authored SVG, rendered inline. */
export function authoredProfile(allowText: boolean): SvgProfile {
  return { allowText, colours: "tokens", allowVersion: false };
}

/** The profile of a published SVG, loaded through `<img>`. */
export const PUBLISHED_PROFILE: SvgProfile = {
  allowText: false,
  colours: "tokens_or_hex",
  allowVersion: true,
};

const DRAWING = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
]);
const DESCRIPTIVE = new Set(["title", "desc", "metadata"]);
const TEXT = new Set(["text", "tspan"]);

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px|%)?$/;
const NUMBERS = /^[0-9eE.,+\-\s]*$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]*$/;
const TRANSFORM =
  /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\(\s*[0-9eE.,+\-\s]*\)\s*,?)*\s*$/;
const TOKEN_COLOUR = /^var\(--qontinui-[a-z0-9-]+\)$/;
const HEX_COLOUR = /^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/;
const SHA256 = /^[0-9a-f]{64}$/;

const oneOf =
  (...values: string[]) =>
  (v: string) =>
    values.includes(v);
const matches = (re: RegExp) => (v: string) => re.test(v);
const isNumber = matches(NUMBER);

/** The attribute grammars, by name (studio's `ATTRIBUTES`). */
const ATTRIBUTES: Readonly<Record<string, (v: string) => boolean>> = {
  viewBox: (v) => {
    const parts = v.trim().split(/[\s,]+/);
    return parts.length === 4 && parts.every((p) => NUMBER.test(p));
  },
  width: isNumber,
  height: isNumber,
  "fill-opacity": isNumber,
  "fill-rule": oneOf("nonzero", "evenodd"),
  "clip-rule": oneOf("nonzero", "evenodd"),
  "stroke-opacity": isNumber,
  "stroke-width": isNumber,
  "stroke-linecap": oneOf("butt", "round", "square"),
  "stroke-linejoin": oneOf("miter", "round", "bevel", "miter-clip", "arcs"),
  "stroke-miterlimit": isNumber,
  "stroke-dasharray": (v) => v === "none" || NUMBERS.test(v),
  opacity: isNumber,
  transform: matches(TRANSFORM),
  d: matches(PATH_DATA),
  cx: isNumber,
  cy: isNumber,
  r: isNumber,
  rx: isNumber,
  ry: isNumber,
  x: isNumber,
  y: isNumber,
  x1: isNumber,
  y1: isNumber,
  x2: isNumber,
  y2: isNumber,
  points: matches(NUMBERS),
  role: oneOf("img", "presentation", "none"),
  "aria-hidden": oneOf("true", "false"),
  // Free text, escaped on output; control characters are refused below.
  "aria-label": () => true,
  focusable: oneOf("true", "false"),
  "data-slot-spec-sha256": matches(SHA256),
};

/** Studio's `TEXT_ATTRIBUTES`, admitted only with `allowText`. */
const TEXT_ATTRIBUTES: Readonly<Record<string, (v: string) => boolean>> = {
  "font-size": isNumber,
  "font-weight": matches(/^(?:normal|bold|[1-9]00)$/),
  "text-anchor": oneOf("start", "middle", "end"),
  "dominant-baseline": oneOf(
    "auto",
    "middle",
    "central",
    "hanging",
    "alphabetic",
    "ideographic",
    "mathematical",
    "text-before-edge",
    "text-after-edge"
  ),
};

/** Studio's `COLOUR_ATTRIBUTES` that are also in its `ATTRIBUTES`. */
const COLOUR_ATTRIBUTES = new Set(["fill", "stroke"]);

/** The namespace declarations a document may carry: SVG as the default, and
 *  the three prefixes the IPTC marker's XMP uses. */
const DECLARATIONS: Readonly<Record<string, string>> = {
  xmlns: SVG_NS,
  "xmlns:x": X_NS,
  "xmlns:rdf": RDF_NS,
  "xmlns:Iptc4xmpExt": IPTC_NS,
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** What a checked SVG says about itself. */
export interface CheckedSvg {
  /** The document's root, every node of it checked. */
  root: Element;
  /** True when its `<metadata>` holds the IPTC AI-generated marker. */
  marked: boolean;
  /** The root's `data-slot-spec-sha256`, or `null`. */
  specSha256: string | null;
}

const ELEMENT = 1;
const TEXT_NODE = 3;
const CDATA = 4;
const PI = 7;
const COMMENT = 8;

function isDeclaration(attr: Attr): boolean {
  return attr.namespaceURI === XMLNS_NS;
}

function checkDeclaration(attr: Attr): void {
  if (DECLARATIONS[attr.name] !== attr.value) {
    throw new SvgRefused(
      `namespace declaration ${attr.name}="${attr.value}" is not allowed`
    );
  }
}

function checkColour(value: string, profile: SvgProfile): boolean {
  return (
    value === "none" ||
    value === "currentColor" ||
    TOKEN_COLOUR.test(value) ||
    (profile.colours === "tokens_or_hex" && HEX_COLOUR.test(value))
  );
}

function checkAttributes(
  el: Element,
  profile: SvgProfile,
  isRoot: boolean
): void {
  for (const attr of Array.from(el.attributes)) {
    if (isDeclaration(attr)) {
      checkDeclaration(attr);
      continue;
    }
    if (attr.namespaceURI !== null) {
      throw new SvgRefused(
        `<${el.localName}> attribute ${attr.name} is not allowed`
      );
    }
    const { name, value } = attr;
    if (CONTROL.test(value) || /url\s*\(/i.test(value)) {
      throw new SvgRefused(
        `<${el.localName} ${name}> carries a value that is not allowed`
      );
    }
    let ok: boolean;
    if (COLOUR_ATTRIBUTES.has(name)) {
      ok = checkColour(value, profile);
    } else if (name === "version") {
      ok =
        isRoot && profile.allowVersion && (value === "1.1" || value === "1.0");
    } else if (Object.hasOwn(ATTRIBUTES, name)) {
      ok = (ATTRIBUTES[name] as (v: string) => boolean)(value);
    } else if (profile.allowText && Object.hasOwn(TEXT_ATTRIBUTES, name)) {
      ok = (TEXT_ATTRIBUTES[name] as (v: string) => boolean)(value);
    } else {
      throw new SvgRefused(
        `<${el.localName}> attribute ${name} is not allowed`
      );
    }
    if (!ok) {
      throw new SvgRefused(
        `<${el.localName} ${name}> has a value its grammar does not admit`
      );
    }
  }
}

/** True for the IPTC marker's XMP, exactly; refuses anything else inside
 *  `<metadata>`. */
function checkMetadata(metadata: Element): boolean {
  if (metadata.attributes.length > 0) {
    throw new SvgRefused("<metadata> carries attributes");
  }
  const only = (parent: Element, ns: string, localName: string): Element[] => {
    const out: Element[] = [];
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === TEXT_NODE && (node.nodeValue ?? "").trim() === "") {
        continue;
      }
      const child = node as Element;
      if (
        node.nodeType !== ELEMENT ||
        child.namespaceURI !== ns ||
        child.localName !== localName
      ) {
        throw new SvgRefused(
          `<${parent.localName}> may hold only the IPTC marker's XMP`
        );
      }
      out.push(child);
    }
    return out;
  };
  const declarationsOnly = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      if (!isDeclaration(attr)) {
        throw new SvgRefused(
          `<${el.localName}> attribute ${attr.name} is not allowed`
        );
      }
      checkDeclaration(attr);
    }
  };
  const packets = only(metadata, X_NS, "xmpmeta");
  if (packets.length !== 1) {
    throw new SvgRefused("<metadata> holds exactly one x:xmpmeta");
  }
  const xmpmeta = packets[0] as Element;
  declarationsOnly(xmpmeta);
  const rdfs = only(xmpmeta, RDF_NS, "RDF");
  if (rdfs.length !== 1) {
    throw new SvgRefused("x:xmpmeta holds exactly one rdf:RDF");
  }
  const rdf = rdfs[0] as Element;
  declarationsOnly(rdf);
  let marked = false;
  for (const description of only(rdf, RDF_NS, "Description")) {
    for (const node of Array.from(description.childNodes)) {
      if (node.nodeType !== TEXT_NODE || (node.nodeValue ?? "").trim() !== "") {
        throw new SvgRefused("rdf:Description holds nothing");
      }
    }
    for (const attr of Array.from(description.attributes)) {
      if (isDeclaration(attr)) {
        checkDeclaration(attr);
      } else if (attr.namespaceURI === RDF_NS && attr.localName === "about") {
        if (attr.value !== "") {
          throw new SvgRefused('rdf:about is ""');
        }
      } else if (
        attr.namespaceURI === IPTC_NS &&
        attr.localName === "DigitalSourceType"
      ) {
        if (attr.value !== DIGITAL_SOURCE_TYPE) {
          throw new SvgRefused(
            "the DigitalSourceType is not trainedAlgorithmicMedia"
          );
        }
        marked = true;
      } else {
        throw new SvgRefused(
          `rdf:Description attribute ${attr.name} is not allowed`
        );
      }
    }
  }
  return marked;
}

function checkElement(
  el: Element,
  profile: SvgProfile,
  isRoot: boolean,
  state: { metadata: number; marked: boolean }
): void {
  const name = el.localName;
  const allowed =
    el.namespaceURI === SVG_NS &&
    (DRAWING.has(name) ||
      DESCRIPTIVE.has(name) ||
      (profile.allowText && TEXT.has(name)));
  if (!allowed) {
    throw new SvgRefused(`element <${el.nodeName}> is not allowed`);
  }
  if (name === "svg" && !isRoot) {
    throw new SvgRefused("a nested <svg> is not allowed");
  }
  if (name === "metadata") {
    if (state.metadata > 0) {
      throw new SvgRefused("one <metadata> at most");
    }
    state.metadata += 1;
    state.marked = checkMetadata(el);
    return;
  }
  checkAttributes(el, profile, isRoot);
  const textHolder = name === "title" || name === "desc" || TEXT.has(name);
  for (const node of Array.from(el.childNodes)) {
    switch (node.nodeType) {
      case ELEMENT:
        if (name === "title" || name === "desc") {
          throw new SvgRefused(`<${name}> holds text only`);
        }
        if (TEXT.has(name) && (node as Element).localName !== "tspan") {
          throw new SvgRefused(`<${name}> holds text and <tspan> only`);
        }
        checkElement(node as Element, profile, false, state);
        break;
      case TEXT_NODE: {
        const text = node.nodeValue ?? "";
        if (CONTROL.test(text)) {
          throw new SvgRefused(`<${name}> text carries a control character`);
        }
        if (!textHolder && text.trim() !== "") {
          throw new SvgRefused(`<${name}> holds no text`);
        }
        break;
      }
      case COMMENT:
        break; // dropped on serialisation
      case CDATA:
        throw new SvgRefused("a CDATA section is not allowed");
      case PI:
        throw new SvgRefused("a processing instruction is not allowed");
      default:
        throw new SvgRefused(`a node of type ${node.nodeType} is not allowed`);
    }
  }
}

/** Parse and check one SVG document against `profile`. */
export function checkSvg(
  text: string,
  profile: SvgProfile,
  parse: XmlParse
): CheckedSvg {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) {
    throw new SvgRefused("a DTD or entity declaration is not allowed");
  }
  const doc = parse(text);
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new SvgRefused("not a well-formed XML document");
  }
  const top = Array.from(doc.childNodes);
  const root = doc.documentElement;
  if (top.length !== 1 || root === null || top[0] !== root) {
    throw new SvgRefused(
      "the document is one <svg> root with nothing before or after it"
    );
  }
  if (root.namespaceURI !== SVG_NS || root.localName !== "svg") {
    throw new SvgRefused("the root element is <svg> in the SVG namespace");
  }
  const state = { metadata: 0, marked: false };
  checkElement(root, profile, true, state);
  return {
    root,
    marked: state.marked,
    specSha256: root.getAttribute("data-slot-spec-sha256"),
  };
}

const CANONICAL_MARKER =
  `<metadata><x:xmpmeta xmlns:x="${X_NS}"><rdf:RDF xmlns:rdf="${RDF_NS}">` +
  `<rdf:Description rdf:about="" xmlns:Iptc4xmpExt="${IPTC_NS}" ` +
  `Iptc4xmpExt:DigitalSourceType="${DIGITAL_SOURCE_TYPE}"></rdf:Description>` +
  `</rdf:RDF></x:xmpmeta></metadata>`;

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}

function serializeElement(el: Element, marker: string): string {
  const name = el.localName;
  if (name === "metadata") {
    return ""; // replaced by the canonical marker on the root
  }
  const attrs = Array.from(el.attributes)
    .filter((a) => !isDeclaration(a))
    .map((a) => ` ${a.localName}="${escapeAttribute(a.value)}"`)
    .join("");
  const ns = name === "svg" ? ` xmlns="${SVG_NS}"` : "";
  const body = Array.from(el.childNodes)
    .map((node) =>
      node.nodeType === ELEMENT
        ? serializeElement(node as Element, "")
        : node.nodeType === TEXT_NODE
          ? escapeText(node.nodeValue ?? "")
          : ""
    )
    .join("");
  return `<${name}${ns}${attrs}>${marker}${body}</${name}>`;
}

/** The markup an inline SVG is rendered from, rebuilt from a CHECKED tree:
 *  allowlisted names, escaped values, comments dropped, and `<metadata>`
 *  replaced by the canonical IPTC marker when (and only when) the document
 *  was marked. */
export function serializeSvg(checked: CheckedSvg): string {
  return serializeElement(checked.root, checked.marked ? CANONICAL_MARKER : "");
}
