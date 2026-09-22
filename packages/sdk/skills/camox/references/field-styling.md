# Inline field formatting and styling

Use this reference to customize inline text, links, and highlights on an existing `block.Field` or `item.Field`. Read [Block Definitions](block-definitions.md) only if also changing the block schema or other field rendering APIs.

## String formatting

String fields support inline formatting in both editing and published output: `**bold**`, `*italic*` (or `_italic_`), `***bold italic***`, `<s>strikethrough</s>`, `<highlight>highlight text</highlight>`, and text links like `[label](https://example.com)` or internal page links inserted by the editor. Highlight can contain other formatting, links, and line breaks. Content remains a string. The editor uses explicit `<strong>` and `<em>` tags when Markdown delimiters cannot represent a selection losslessly (for example, formatting that includes leading/trailing whitespace). These are built-in formatting tags, not arbitrary HTML.

## Rendering and appearance

Spread the field's render-prop `props` onto the element to preserve inline editing. `props.children` contains the rendered content:

```tsx
<myBlock.Field name="title">{(props) => <h1 {...props} />}</myBlock.Field>
```

Camox owns inline markup so editing and published output have the same appearance. Customize appearance with `textStyle` and `linkStyle` (these replace the old `components` prop):

```tsx
<myBlock.Field
  name="description"
  textStyle={({ bold, italic, highlight }) => {
    if (highlight) {
      return {
        style: {
          backgroundImage: "linear-gradient(to right, orange, deeppink)",
          backgroundClip: "text",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        },
      };
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

- `textStyle` receives `{ bold, italic, strikethrough, highlight }` and returns `{ className?, style? }` or `undefined`. For text runs, `highlight` is false and the other flags describe explicit content formatting, not inherited heading styles. Unmarked text keeps its parent's typography.
- `linkStyle` receives `{ target, href, external, pageId }` and returns the same appearance-only object. Links are underlined by default; override `style.textDecorationLine` to change that.
- Camox also calls `textStyle` once for each shared highlight wrapper with `{ highlight: true, bold: false, italic: false, strikethrough: false }`. That result styles the whole range; its children receive their own text-run calls. `highlight` identifies the wrapper being styled, not whether a run is inside a highlight. This keeps one continuous background when bold/italic formatting changes within the range. Highlights default to the site's `--primary` text color, falling back to `currentColor`. Return a custom `style.color` to change it, or use a clipped background with transparent text fill to render a gradient, as shown above.
- Styles apply to inline children; the outer element's `className` stays on that element and is inherited normally. Explicit formatting defaults (combined italic, strikethrough, highlight color) use inline styles; use `style` to override those defaults rather than competing utility classes.
- These props accept appearance only, never replacement elements, children, or event handlers. They also work on `item.Field` inside repeaters. The sidebar editor shows default formatting; field-specific styles apply on the page.
