import { createApp } from "./createApp";
import { createCollection, Type, type Collection } from "./createCollection";

const content = {
  title: Type.String({ default: "" }),
  subtitle: Type.String({ default: "" }),
  image: Type.Image(),
  enabled: Type.Boolean({ default: false }),
  category: Type.Enum({ options: { one: "One" }, default: "one" }),
  embed: Type.Embed({ pattern: ".*", default: "" }),
};
const options = { id: "articles", title: "Articles", description: "", content };
const collection = createCollection({ ...options, label: "title" });
createApp({ blocks: [], collections: [collection] });
createCollection({ ...options, label: "subtitle" });

// Both inferred definitions and explicit annotations preserve the compatible key union.
const inferredLabel: "title" | "subtitle" = collection._internal.label;
const typedCollection: Collection<typeof content> = collection;
const annotatedLabel: "title" | "subtitle" = typedCollection._internal.label;
const titleSchema: typeof content.title = typedCollection._internal.contentSchema.properties.title;
void [inferredLabel, annotatedLabel, titleSchema];

function checkLabelAssignments(value: Collection<typeof content>) {
  value._internal.label = "title";
  value._internal.label = "subtitle";
  // @ts-expect-error A known collection's label cannot name an asset.
  value._internal.label = "image";
  // @ts-expect-error A known collection's label cannot name an unknown field.
  value._internal.label = "missing";
  // @ts-expect-error String-valued enums are not compatible text fields.
  value._internal.label = "category";
  // @ts-expect-error String-valued embeds are not compatible text fields.
  value._internal.label = "embed";
}
void checkLabelAssignments;

const arbitraryLabel: string = "title";
// @ts-expect-error A broad string is not a compatible content-field key.
createCollection({ ...options, label: arbitraryLabel });
// @ts-expect-error Labels are required.
createCollection(options);
// @ts-expect-error Unknown key.
createCollection({ ...options, label: "missing" });
// @ts-expect-error Assets are not labels.
createCollection({ ...options, label: "image" });
// @ts-expect-error Booleans are not labels.
createCollection({ ...options, label: "enabled" });
// @ts-expect-error Enum is not a text field.
createCollection({ ...options, label: "category" });
// @ts-expect-error Embed is not a text field.
createCollection({ ...options, label: "embed" });
// @ts-expect-error No incomplete loader helpers are exposed.
collection.pages();
