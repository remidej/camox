// The API's router and server-side types. Kept off the main entry so a site importing
// `camox` doesn't load the whole API's types (and packages it can't resolve).
export type { Router } from "../../../apps/api/src/router";
export type { PublishPreview } from "../../../apps/api/src/domains/drafts/publish";
export type { EntityKind } from "../../../apps/api/src/domains/drafts/overlay";
