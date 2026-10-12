/** Theme tokens: CSS custom property names and their values, such as `--background`. */
export type ArtifactThemeTokens = Record<string, string>;

type RuleContainer = { cssRules: CSSRuleList };
type StyledRule = CSSRule & { style?: CSSStyleDeclaration; cssRules?: CSSRuleList };

function addCustomProperties(style: CSSStyleDeclaration | undefined, names: Set<string>) {
  if (!style) return;
  for (let index = 0; index < style.length; index++) {
    const name = style.item(index);
    if (name.startsWith("--")) names.add(name);
  }
}

function addRuleCustomProperties(container: RuleContainer, names: Set<string>) {
  for (const rule of Array.from(container.cssRules) as StyledRule[]) {
    addCustomProperties(rule.style, names);
    // Media, supports, layer and nested style rules hold more rules.
    if (rule.cssRules) addRuleCustomProperties(rule as RuleContainer, names);
  }
}

/** The custom properties declared in the page's stylesheets and on the frame or its ancestors. */
function declaredCustomProperties(frame: HTMLIFrameElement) {
  const names = new Set<string>();
  for (const sheet of Array.from(frame.ownerDocument.styleSheets)) {
    try {
      addRuleCustomProperties(sheet, names);
    } catch {
      // Cross-origin stylesheets can't be read; their tokens stay unknown.
    }
  }
  for (let element: HTMLElement | null = frame; element; element = element.parentElement) {
    addCustomProperties(element.style, names);
  }
  return names;
}

/**
 * The theme tokens as resolved at the frame's position, so a `.dark` section, a `data-theme`
 * attribute or a media query on the page all apply.
 */
export function readArtifactTheme(frame: HTMLIFrameElement): ArtifactThemeTokens {
  const page = frame.ownerDocument.defaultView;
  if (!page) return {};
  const style = page.getComputedStyle(frame);
  const tokens: ArtifactThemeTokens = {};
  for (const name of [...declaredCustomProperties(frame)].sort()) {
    const value = style.getPropertyValue(name).trim();
    if (value) tokens[name] = value;
  }
  return tokens;
}

function isThemeAttribute(name: string | null) {
  return name === "class" || name === "style" || !!name?.startsWith("data-");
}

/**
 * Calls `onChange` when the `class`, `style` or `data-*` attributes of the frame or one of its
 * ancestors change, as these may change the tokens at its position. Returns a disconnect.
 */
export function observeArtifactTheme(frame: HTMLIFrameElement, onChange: () => void) {
  const page = frame.ownerDocument.defaultView;
  if (!page) return () => {};
  // The page's own realm: the block's code may run in another one (see `artifactHost.ts`).
  const observer = new page.MutationObserver((records) => {
    if (records.some((record) => isThemeAttribute(record.attributeName))) onChange();
  });
  for (let element: Element | null = frame; element; element = element.parentElement) {
    observer.observe(element, { attributes: true });
  }
  return () => observer.disconnect();
}
