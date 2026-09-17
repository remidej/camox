const fieldTypesDictionary = {
  String: { hasOwnView: true },
  Repeater: { hasOwnView: true },
  Enum: { hasOwnView: true },
  Boolean: { hasOwnView: true },
  Embed: { hasOwnView: true },
  Link: { hasOwnView: true },
  Image: { hasOwnView: true },
  File: { hasOwnView: true },
  ImageList: { hasOwnView: true },
  FileList: { hasOwnView: true },
} satisfies Record<string, { hasOwnView: boolean }>;

type FieldTypesDictionary = typeof fieldTypesDictionary;
type FieldType = keyof FieldTypesDictionary;

export type { FieldType };
export { fieldTypesDictionary };
