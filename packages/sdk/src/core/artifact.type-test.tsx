import { createBlock } from "./createBlock";
import { createCollection } from "./createCollection";

const block = createBlock({
  id: "artifact-type-test",
  title: "Artifacts",
  description: "",
  component: () => null,
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
      toMarkdown: (c) => [c.text],
    }),
  }),
  toMarkdown: (c) => [c.text],
});

createBlock({
  id: "artifact-options",
  title: "",
  description: "",
  component: () => null,
  content: (field) => ({
    // @ts-expect-error Artifacts must choose how their frame is sized.
    unsized: field.artifact({}),
    // @ts-expect-error Sizes are "fill" or "content".
    fixed: field.artifact({ size: "fixed" }),
  }),
  toMarkdown: () => [],
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
  label: "name",
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
