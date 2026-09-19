# Inline field formatting and styling

Use this reference to customize inline text, links, and gradients on an existing `block.Field` or `item.Field`. Read [Block Definitions](block-definitions.md) only if also changing the block schema or other field rendering APIs.

## String formatting

String fields support inline formatting in both editing and published output: `**bold**`, `*italic*` (or `_italic_`), `***bold italic***`, `<u>underlined</u>`, `<gradient>gradient text</gradient>`, and text links like `[label](https://example.com)` or internal page links inserted by the editor. Gradient can contain other formatting, links, and line breaks. Content remains a string. The editor uses explicit `<strong>` and `<em>` tags when Markdown delimiters cannot represent a selection losslessly (for example, formatting that includes leading/trailing whitespace). These are built-in formatting tags, not arbitrary HTML.

## Rendering and appearance

Spread the field's render-prop `props` onto the element to preserve inline editing. `props.children` contains the rendered content:

```tsx
<myBlock.Field name="title">{(props) => <h1 {...props} />}</myBlock.Field>
```

Camox owns inline markup so editing and published output have the same appearance. Customize appearance with `textStyle` and `linkStyle` (these replace the old `components` prop):

```tsx
<myBlock.Field
  name="description"
  textStyle={({ bold, italic, gradient }) => {
    if (gradient) {
      return { style: { backgroundImage: "linear-gradient(to right, orange, deeppink)" } };
    }
    return {
      className: bold ? "text-primary" : undefined,
      style: bold && italic ? { letterSpacing: "0.02em" } : undefined,
    };
  }}
  linkStyle={({ external }) => ({
    className: external ? "text-blue-600" : "text-primary font-medium",
  })}
>
  {(props) => <p {...props} />}
</myBlock.Field>
```

- `textStyle` receives `{ bold, italic, underline, gradient }` and returns `{ className?, style? }` or `undefined`. For text runs, `gradient` is false and the other flags describe explicit content formatting, not inherited heading styles. Unmarked text keeps its parent's typography.
- `linkStyle` receives `{ target, href, external, pageId }` and returns the same appearance-only object. Links are underlined by default; override `style.textDecorationLine` to change that.
- Camox also calls `textStyle` once for each shared gradient wrapper with `{ gradient: true, bold: false, italic: false, underline: false }`. That result styles the whole range; its children receive their own text-run calls. `gradient` identifies the wrapper being styled, not whether a run is inside a gradient. This keeps one continuous background when bold/italic formatting changes within the range. The default gradient uses the site's shadcn chart palette: `--chart-1` → `--chart-2`, following light/dark theme changes. Missing chart tokens fall back to `--primary` / `--muted-foreground`, then `currentColor`, never a hardcoded palette. Set `--camox-gradient-from` and `--camox-gradient-to` in app CSS for app-wide colors, or return `style.backgroundImage` when `gradient` is true.
- Styles apply to inline children; the outer element's `className` stays on that element and is inherited normally. Explicit formatting defaults (combined italic, underline, gradient clipping) use inline styles; use `style` to override those defaults rather than competing utility classes.
- These props accept appearance only, never replacement elements, children, or event handlers. They also work on `item.Field` inside repeaters. The sidebar editor shows default formatting; field-specific styles apply on the page.
