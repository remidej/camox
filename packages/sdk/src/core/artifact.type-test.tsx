import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";

const block = createBlock({
  id: "artifact-type-test",
  title: "Artifacts",
  description: "",
  toReact: () => null,
  content: (field) => ({
    visual: field.artifact({ size: "fill" }),
    text: field.string({ default: "Text" }),
    items: field.repeater({
      content: (field) => ({
        scene: field.artifact({ size: "content", default: "<title>Scene</title>" }),
        text: field.string({ default: "Text" }),
      }),
      minItems: 1,
      maxItems: 5,
      toMarkdown: ({ content }) => [content.text],
      toTitle: () => "Item",
    }),
  }),
  toMarkdown: ({ content }) => [content.text],
  toTitle: () => "Artifacts",
});

createBlock({
  id: "artifact-options",
  title: "",
  description: "",
  toReact: () => null,
  content: (field) => ({
    // @ts-expect-error Artifacts must choose how their frame is sized.
    unsized: field.artifact({}),
    // @ts-expect-error Sizes are "fill" or "content".
    fixed: field.artifact({ size: "fixed" }),
  }),
  toMarkdown: () => [],
  toTitle: () => "",
});

// Collection records can't hold artifacts (ADR 0001).
createCollection({
  id: "visuals",
  title: "Visuals",
  description: "",
  content: (field) => ({
    name: field.string(),
    // @ts-expect-error The collection field builder does not offer artifacts.
    visual: field.artifact({ size: "fill" }),
  }),
  toTitle: ({ content }) => content.name,
  toDescription: () => undefined,
});

// Artifact Data names sibling content fields and settings.
createBlock({
  id: "artifact-data",
  title: "",
  description: "",
  toReact: () => null,
  content: (field) => ({
    headline: field.string({ default: "Headline" }),
    cta: field.link({ default: { text: "Go", href: "/", newTab: false } }),
    visual: field.artifact({ size: "fill", data: ["headline", "cta", "accent"] }),
    items: field.repeater({
      content: (field) => ({
        label: field.string({ default: "Label" }),
        scene: field.artifact({ size: "content", data: ["label", "highlighted"] }),
      }),
      settings: (setting) => ({ highlighted: setting.boolean({ default: false }) }),
      minItems: 1,
      maxItems: 5,
      toMarkdown: ({ content }) => [content.label],
      toTitle: () => "Item",
    }),
  }),
  settings: (setting) => ({
    accent: setting.enum({ default: "blue", options: { blue: "Blue", red: "Red" } }),
  }),
  toMarkdown: ({ content }) => [content.headline],
  toTitle: () => "",
});

createBlock({
  id: "artifact-data-typo",
  title: "",
  description: "",
  toReact: () => null,
  content: (field) => ({
    headline: field.string({ default: "Headline" }),
    // @ts-expect-error Artifact Data names only sibling fields and settings.
    visual: field.artifact({ size: "fill", data: ["headlin"] }),
  }),
  toMarkdown: ({ content }) => [content.headline],
  toTitle: () => "",
});

createBlock({
  id: "artifact-data-without-settings",
  title: "",
  description: "",
  toReact: () => null,
  content: (field) => ({
    // @ts-expect-error A block without settings shares no settings.
    visual: field.artifact({ size: "fill", data: ["accent"] }),
  }),
  toMarkdown: () => [],
  toTitle: () => "",
});

createBlock({
  id: "artifact-data-not-shared",
  title: "",
  description: "",
  toReact: () => null,
  content: (field) => ({
    other: field.artifact({ size: "fill" }),
    // @ts-expect-error Artifact sources are not Artifact Data.
    visual: field.artifact({ size: "fill", data: ["other"] }),
    items: field.repeater({
      content: (field) => ({ label: field.string({ default: "Label" }) }),
      minItems: 1,
      maxItems: 5,
      toMarkdown: ({ content }) => [content.label],
      toTitle: () => "Item",
    }),
    // @ts-expect-error Repeaters are not Artifact Data.
    list: field.artifact({ size: "fill", data: ["items"] }),
  }),
  toMarkdown: () => [],
  toTitle: () => "",
});

createBlock({
  id: "artifact-data-item-scope",
  title: "",
  description: "",
  toReact: () => null,
  content: (field) => ({
    headline: field.string({ default: "Headline" }),
    items: field.repeater({
      content: (field) => ({
        label: field.string({ default: "Label" }),
        // @ts-expect-error A repeatable item's artifact sees only the item's fields and settings.
        scene: field.artifact({ size: "content", data: ["headline"] }),
      }),
      minItems: 1,
      maxItems: 5,
      toMarkdown: ({ content }) => [content.label],
      toTitle: () => "Item",
    }),
  }),
  toMarkdown: ({ content }) => [content.headline],
  toTitle: () => "",
});

function TypeCheck() {
  const frame = (
    <block.Artifact name="visual">
      {(props) => {
        const sandbox: string = props.sandbox;
        return <iframe {...props} sandbox={sandbox} />;
      }}
    </block.Artifact>
  );
  // @ts-expect-error Artifact fields are not inline text.
  const notText = <block.Field name="visual">{(props) => <span {...props} />}</block.Field>;
  // @ts-expect-error Text fields are not artifacts.
  const notArtifact = <block.Artifact name="text">{() => null}</block.Artifact>;
  const items = (
    <block.Repeater name="items">
      {(item) => (
        <>
          <item.Artifact name="scene">{(props) => <iframe {...props} />}</item.Artifact>
          {/* @ts-expect-error Item artifact fields are not inline text. */}
          <item.Field name="scene">{(props) => <span {...props} />}</item.Field>
          {/* @ts-expect-error Item text fields are not artifacts. */}
          <item.Artifact name="text">{() => null}</item.Artifact>
        </>
      )}
    </block.Repeater>
  );
  return [frame, notText, notArtifact, items];
}

void TypeCheck;
