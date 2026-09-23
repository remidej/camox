# Icon fields — v1 product decisions

## API

Choose one icon collection per project in Vite config:

```ts
camox({
  projectSlug: "...",
  icons: "lucide",
});
```

Declare fields with a required, fully prefixed default:

```ts
icon: Type.Icon({ default: "lucide:zap" });
```

Render with `<block.Icon name="icon" className="..." />`, also supported on repeater items.

## Behavior

- Use Iconify as the underlying catalog and normalized SVG format.
- The developer chooses the collection; editors cannot mix collections.
- Generated TypeScript declarations provide autocomplete and restrict IDs to the configured collection, including the required prefix. Ensure generation works before CI type-checking.
- Store the namespaced ID as the field value. Validate IDs at runtime too.
- Fields are non-nullable with a required default. No per-field list of allowed options.
- Clicking an icon in the editor opens a searchable grid for the configured collection, highlighting the current selection.
- Render inline SVG, decorative by default. Developers control styling and accessible labels where needed.
- Resolve and deliver selected SVG data through Camox. Support server rendering, avoid shipping the whole catalog or relying on visitor requests to Iconify, and allow content changes without a site rebuild. Exact resolution/cache placement remains an implementation decision.
- Keep collection data consistent across generated types, validation, and the picker; respect collection licenses.

## Deferred

Collection changes and migrations, optional/empty icons, custom collections, semantic search, and AI suggestions are out of scope for v1.
