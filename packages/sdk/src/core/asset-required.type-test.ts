import { contentFieldBuilder } from "./lib/contentType";

// A block can insist on its image or file: publishing blocks while it's empty.
void contentFieldBuilder.image({ title: "Hero", required: true });
void contentFieldBuilder.file({ accept: ["application/pdf"], required: true });

// @ts-expect-error An empty list is always valid, so lists can't be required.
void contentFieldBuilder.imageList({ required: true });
// @ts-expect-error An empty list is always valid, so lists can't be required.
void contentFieldBuilder.fileList({ accept: ["application/pdf"], required: true });
// @ts-expect-error `required` is a boolean.
void contentFieldBuilder.image({ required: "yes" });
