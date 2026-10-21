const XHTML = "http://www.w3.org/1999/xhtml";
const URL_PATTERN = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

import { BLOCK_OVERLAP_SELECTOR } from "./canvasFrameDocument";

/** A frame drawn into an image, and the size in CSS pixels it covers. */
export type FrameCapture = { blob: Blob; width: number; height: number };

export type CaptureOptions = {
  /** The image's size, relative to the frame's size in CSS pixels. */
  scale: number;
  /**
   * How far each block overlaps the one before, in CSS pixels, if not as the frame has it now:
   * see `canvasBlockOverlap`. It depends on the zoom, so an image captured at one zoom would
   * otherwise change height as the live frame replaces it at another.
   */
  blockOverlap?: number;
};

/**
 * Draws same-origin frames into images, with the browser's own rendering: a frame's content
 * and stylesheets go into an SVG `<foreignObject>`, which the browser lays out and paints like
 * any page. Canvas frames are documents we build, so their stylesheets copy over as text, and
 * nothing is inlined element by element. An SVG drawn as an image loads nothing, so fonts and
 * images are embedded as data URLs, fetched once for every frame the capturer draws.
 */
export function createFrameCapturer() {
  const resources = new Map<string, Promise<string | null>>();
  const sheets = new Map<string, Promise<string | null>>();

  function fetchBlob(url: string) {
    // The frame already loaded these, but its responses can't be read back: fetch them again,
    // without credentials, as the browser fetches fonts and CORS images.
    return fetch(url, { mode: "cors", credentials: "omit" })
      .then((response) => (response.ok ? response.blob() : null))
      .catch(() => null);
  }

  function embed(url: string) {
    if (url.startsWith("data:")) return Promise.resolve(url);
    let embedded = resources.get(url);
    if (!embedded) {
      embedded = fetchBlob(url).then((blob) => blob && dataUrl(blob));
      resources.set(url, embedded);
    }
    return embedded;
  }

  /**
   * An image at no more than the size it's drawn at, so large photos don't make the browser
   * decode them in full to draw a small thumbnail. Resizing happens off the main thread.
   */
  function embedImage(url: string, width: number, height: number) {
    if (url.startsWith("data:") || !width || !height) return embed(url);
    const key = `${url}#${width}x${height}`;
    let embedded = resources.get(key);
    if (!embedded) {
      embedded = fetchBlob(url).then(async (blob) => {
        if (!blob) return null;
        try {
          const bitmap = await createImageBitmap(blob);
          // Cover the drawn box, keeping the image's proportions for `object-fit`.
          const factor = Math.max(width / bitmap.width, height / bitmap.height);
          if (factor >= 1) {
            bitmap.close();
            return dataUrl(blob);
          }
          const canvas = new OffscreenCanvas(
            Math.ceil(bitmap.width * factor),
            Math.ceil(bitmap.height * factor),
          );
          const context = canvas.getContext("2d");
          if (!context) return dataUrl(blob);
          context.imageSmoothingQuality = "high";
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close();
          return dataUrl(await canvas.convertToBlob({ type: "image/webp", quality: 0.9 }));
        } catch {
          // An SVG or an image the browser can't decode off the page: keep it as is.
          return dataUrl(blob);
        }
      });
      resources.set(key, embedded);
    }
    return embedded;
  }

  /** A cross-origin stylesheet's text, which its CSSOM doesn't expose. */
  function sheetText(href: string) {
    let text = sheets.get(href);
    if (!text) {
      text = fetch(href, { mode: "cors", credentials: "omit" })
        .then((response) => (response.ok ? response.text() : null))
        .catch(() => null);
      sheets.set(href, text);
    }
    return text;
  }

  async function embedUrls(css: string) {
    const urls = new Set<string>();
    for (const match of css.matchAll(URL_PATTERN)) {
      if (!match[2].startsWith("data:") && !match[2].startsWith("#")) urls.add(match[2]);
    }
    if (!urls.size) return css;
    const embedded = new Map<string, string>();
    await Promise.all(
      Array.from(urls, async (url) => {
        const data = await embed(url);
        if (data) embedded.set(url, data);
      }),
    );
    return css.replace(URL_PATTERN, (match, _quote, url: string) => {
      const data = embedded.get(url);
      return data ? `url("${data}")` : match;
    });
  }

  async function collectStyles(doc: Document) {
    const collected: CollectedStyles = { rules: [], fontFaces: [] };
    const pending: Promise<void>[] = [];
    for (const sheet of [...Array.from(doc.styleSheets), ...doc.adoptedStyleSheets]) {
      if (sheet.disabled) continue;
      const media = sheet.media.mediaText;
      const wrap = media && media !== "all" ? (css: string) => `@media ${media} {${css}}` : noWrap;
      const base = sheet.href ?? doc.baseURI;
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        if (!sheet.href) continue;
        // Keep the sheet's place in the cascade while its text loads.
        const index = collected.rules.push("") - 1;
        const href = sheet.href;
        pending.push(
          sheetText(href).then((text) => {
            if (text == null) return;
            const parsed = new (doc.defaultView ?? window).CSSStyleSheet();
            parsed.replaceSync(text.replace(/@import[^;]+;/g, ""));
            const own: CollectedStyles = { rules: [], fontFaces: [] };
            collectRules(parsed.cssRules, href, own, wrap);
            collected.rules[index] = own.rules.join("\n");
            collected.fontFaces.push(...own.fontFaces);
          }),
        );
        continue;
      }
      collectRules(rules, base, collected, wrap);
    }
    await Promise.all(pending);
    return collected;
  }

  /** The `@font-face` rules of faces the frame loaded, each with its first source embedded. */
  async function embedFonts(doc: Document, fontFaces: CollectedStyles["fontFaces"]) {
    const loaded: FontFace[] = [];
    doc.fonts.forEach((face) => {
      if (face.status === "loaded") loaded.push(face);
    });
    const css = await Promise.all(
      fontFaces.map(async ({ family, css }) => {
        const faces = loaded.filter((face) => unquote(face.family) === family);
        if (!faces.length) return "";
        // Families split into many subsets keep only the subsets the frame used.
        const range = /unicode-range:\s*([^;]+);/.exec(css)?.[1].replace(/\s/g, "").toUpperCase();
        const weight = /font-weight:\s*([^;]+);/.exec(css)?.[1].trim();
        const style = /font-style:\s*([^;]+);/.exec(css)?.[1].trim();
        const used = faces.some(
          (face) =>
            (!range || face.unicodeRange.replace(/\s/g, "").toUpperCase() === range) &&
            (!weight || face.weight === weight) &&
            (!style || face.style === style),
        );
        if (!used) return "";
        const source = /src:\s*([^;]+);/.exec(css);
        const first = source && /url\("([^"]+)"\)(\s*format\([^)]*\))?/.exec(source[1]);
        if (!source || !first) return css;
        const data = await embed(first[1]);
        if (!data) return "";
        return css.replace(source[0], `src: url("${data}")${first[2] ?? ""};`);
      }),
    );
    return css.filter(Boolean).join("\n");
  }

  /** The SVG drawing `doc`'s content at `width` by `height` CSS pixels, at `scale`. */
  async function documentSvg(
    doc: Document,
    width: number,
    height: number,
    scale: number,
    blockOverlap?: number,
  ) {
    const view = doc.defaultView;
    if (!view || !doc.body) throw new Error("The frame has no document to capture.");
    const html = doc.documentElement.cloneNode(false) as HTMLElement;
    const body = doc.body.cloneNode(true) as HTMLElement;
    html.appendChild(body);
    const originals = doc.body.querySelectorAll("*");
    const clones = body.querySelectorAll("*");
    const clonesOf = new Map<Element, Element>();
    const fixes: Promise<unknown>[] = [];
    for (let index = 0; index < originals.length; index++) {
      const original = originals[index];
      const clone = clones[index];
      clonesOf.set(original, clone);
      const tag = original.localName;
      if (tag === "img") {
        const image = original as HTMLImageElement;
        const url = image.currentSrc || image.src;
        clone.removeAttribute("srcset");
        clone.removeAttribute("sizes");
        clone.removeAttribute("loading");
        fixes.push(
          embedImage(
            url,
            Math.ceil(image.clientWidth * scale),
            Math.ceil(image.clientHeight * scale),
          ).then((data) => (data ? clone.setAttribute("src", data) : clone.removeAttribute("src"))),
        );
      } else if (tag === "source" && original.parentElement?.localName === "picture") {
        clone.remove();
      } else if (tag === "iframe") {
        const frame = original as HTMLIFrameElement;
        const replacement = replaceElement(clone, original, "img");
        replacement.removeAttribute("src");
        replacement.removeAttribute("srcdoc");
        const nested = sameOriginDocument(frame);
        // Running artifacts and other frames from elsewhere can't be read: they stay blank.
        if (nested && frame.clientWidth && frame.clientHeight) {
          fixes.push(
            documentSvg(nested, frame.clientWidth, frame.clientHeight, scale)
              .then((svg) => replacement.setAttribute("src", svgUrl(svg)))
              .catch(() => {}),
          );
        }
      } else if (tag === "canvas" || tag === "video") {
        const replacement = replaceElement(clone, original, "img");
        replacement.removeAttribute("src");
        try {
          const drawn = doc.createElement("canvas");
          const media = original as HTMLCanvasElement | HTMLVideoElement;
          drawn.width = "videoWidth" in media ? media.videoWidth : media.width;
          drawn.height = "videoHeight" in media ? media.videoHeight : media.height;
          drawn.getContext("2d")?.drawImage(media, 0, 0);
          replacement.setAttribute("src", drawn.toDataURL());
        } catch {
          const poster = (original as HTMLVideoElement).poster;
          if (poster)
            fixes.push(embed(poster).then((data) => data && replacement.setAttribute("src", data)));
        }
      } else if (tag === "object" || tag === "embed") {
        const replacement = replaceElement(clone, original, "div") as HTMLElement;
        replacement.style.setProperty("display", view.getComputedStyle(original).display);
      } else if (tag === "input") {
        const input = original as HTMLInputElement;
        if (input.type === "checkbox" || input.type === "radio") {
          if (input.checked) clone.setAttribute("checked", "");
          else clone.removeAttribute("checked");
        } else clone.setAttribute("value", input.value);
      } else if (tag === "textarea") {
        clone.textContent = (original as HTMLTextAreaElement).value;
      } else if (tag === "option") {
        if ((original as HTMLOptionElement).selected) clone.setAttribute("selected", "");
        else clone.removeAttribute("selected");
      } else if (tag === "script" || tag === "noscript") {
        clone.remove();
      }
      const inline = clone.getAttribute("style");
      if (inline?.includes("url(")) {
        fixes.push(
          embedUrls(absoluteUrls(inline, doc.baseURI)).then((css) =>
            clone.setAttribute("style", css),
          ),
        );
      }
    }
    for (const element of Array.from(body.querySelectorAll("[data-camox-studio]")))
      element.remove();
    freezeAnimations(doc, clonesOf);
    // Inside a foreignObject, the root is an ordinary box: it paints the canvas background.
    const background = [doc.documentElement, doc.body]
      .map((element) => view.getComputedStyle(element).backgroundColor)
      .find((color) => color && color !== "rgba(0, 0, 0, 0)");
    if (blockOverlap !== undefined)
      html.style.setProperty("--camox-block-overlap", `${blockOverlap}px`);
    html.style.setProperty("width", `${width}px`);
    html.style.setProperty("height", `${height}px`);
    html.style.setProperty("overflow", "hidden", "important");

    const styles = await collectStyles(doc);
    // In an SVG image, `:root` is the `<svg>`: the document's root rules belong to its `<html>`.
    const rules = styles.rules.join("\n").replace(/:root\b/g, "html");
    const [fonts, css] = await Promise.all([
      embedFonts(doc, styles.fontFaces),
      embedUrls(rules),
      Promise.all(fixes),
    ]);
    const style = doc.createElementNS(XHTML, "style");
    style.textContent = `${fonts}\n${css}`;
    const head = doc.createElementNS(XHTML, "head");
    head.appendChild(style);
    html.insertBefore(head, body);
    const markup = new XMLSerializer().serializeToString(html);
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      (background ? `<rect width="100%" height="100%" fill="${background}"/>` : "") +
      `<foreignObject x="0" y="0" width="100%" height="100%">${markup}</foreignObject></svg>`
    );
  }

  /**
   * Draws a same-origin frame, as its content is now, at `scale` times its CSS size. Its
   * animations are frozen where they are.
   */
  async function capture(
    frame: HTMLIFrameElement,
    { scale, blockOverlap }: CaptureOptions,
  ): Promise<FrameCapture> {
    const doc = sameOriginDocument(frame);
    const width = frame.offsetWidth;
    let height = frame.offsetHeight;
    if (!doc || !width || !height) throw new Error("The frame can't be captured.");
    const overlap = blockOverlapOf(doc);
    // Each overlapping block makes the page that much shorter.
    if (blockOverlap !== undefined && blockOverlap !== overlap)
      height += doc.querySelectorAll(BLOCK_OVERLAP_SELECTOR).length * (overlap - blockOverlap);
    const svg = await documentSvg(doc, width, height, scale, blockOverlap);
    // A data URL, unlike a blob URL, leaves the canvas readable once the SVG is drawn into it.
    const image = new Image();
    image.src = svgUrl(svg);
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The frame can't be drawn.");
    context.imageSmoothingQuality = "high";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.92),
    );
    if (!blob) throw new Error("The frame's capture can't be encoded.");
    return { blob, width, height };
  }

  return { capture };
}

export type FrameCapturer = ReturnType<typeof createFrameCapturer>;

type CollectedStyles = {
  /** Every rule but font faces, with absolute URLs, in cascade order. */
  rules: string[];
  fontFaces: { family: string; css: string }[];
};

const noWrap = (css: string) => css;

function collectRules(
  rules: CSSRuleList,
  base: string,
  collected: CollectedStyles,
  wrap: (css: string) => string,
) {
  for (const rule of Array.from(rules)) {
    // Rules come from the frame's window, whose classes `instanceof` can't match here.
    if ("styleSheet" in rule) {
      const imported = rule as CSSImportRule;
      if (!imported.styleSheet) continue;
      let inner = wrap;
      const media = imported.media.mediaText;
      if (media) inner = wrapIn(inner, `@media ${media}`);
      if (imported.layerName != null) inner = wrapIn(inner, `@layer ${imported.layerName}`);
      try {
        collectRules(
          imported.styleSheet.cssRules,
          imported.styleSheet.href ?? base,
          collected,
          inner,
        );
      } catch {
        // An unreadable import renders without its rules.
      }
      continue;
    }
    if (rule.cssText.trimStart().startsWith("@font-face")) {
      const family = unquote((rule as CSSFontFaceRule).style.getPropertyValue("font-family"));
      collected.fontFaces.push({ family, css: wrap(absoluteUrls(rule.cssText, base)) });
      continue;
    }
    collected.rules.push(wrap(absoluteUrls(rule.cssText, base)));
  }
}

function wrapIn(wrap: (css: string) => string, at: string) {
  return (css: string) => wrap(`${at} {${css}}`);
}

function absoluteUrls(css: string, base: string) {
  return css.replace(URL_PATTERN, (match, _quote, url: string) => {
    if (url.startsWith("data:") || url.startsWith("#")) return match;
    try {
      return `url("${new URL(url, base).href}")`;
    } catch {
      return match;
    }
  });
}

function unquote(value: string) {
  return value.replace(/["']/g, "").trim();
}

function sameOriginDocument(frame: HTMLIFrameElement) {
  try {
    return frame.contentDocument?.body ? frame.contentDocument : null;
  } catch {
    return null;
  }
}

function replaceElement(clone: Element, original: Element, tag: string) {
  const replacement = clone.ownerDocument.createElementNS(XHTML, tag);
  for (const attribute of Array.from(original.attributes))
    replacement.setAttribute(attribute.name, attribute.value);
  clone.replaceWith(replacement);
  return replacement;
}

/** CSS animations stop at their current time; scripted ones keep their current look. */
function freezeAnimations(doc: Document, clonesOf: Map<Element, Element>) {
  const view = doc.defaultView;
  if (!view) return;
  const byElement = new Map<Element, Animation[]>();
  for (const animation of doc.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    if (!effect?.target || effect.pseudoElement) continue;
    byElement.set(effect.target, [...(byElement.get(effect.target) ?? []), animation]);
  }
  for (const [element, animations] of byElement) {
    const clone = clonesOf.get(element) as HTMLElement | undefined;
    if (!clone) continue;
    const computed = view.getComputedStyle(element);
    if (animations.some((animation) => "animationName" in animation)) {
      const delays = computed.animationName.split(",").map((name) => {
        const animation = animations.find(
          (candidate) => (candidate as CSSAnimation).animationName === name.trim(),
        );
        return `${-(Number(animation?.currentTime) || 0)}ms`;
      });
      clone.style.setProperty("animation-delay", delays.join(", "), "important");
      clone.style.setProperty("animation-play-state", "paused", "important");
    }
    if (
      animations.some(
        (animation) => !("animationName" in animation) && !("transitionProperty" in animation),
      )
    ) {
      clone.style.setProperty("transform", computed.transform, "important");
      clone.style.setProperty("opacity", computed.opacity, "important");
    }
  }
}

function blockOverlapOf(doc: Document) {
  return parseFloat(doc.documentElement.style.getPropertyValue("--camox-block-overlap")) || 0;
}

function svgUrl(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function dataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
