import {
  Type as TypeIcon,
  List as ListIcon,
  ChevronDown as ChevronDownIcon,
  ToggleLeft as ToggleLeftIcon,
  type LucideProps,
  FrameIcon,
  Link2 as Link2Icon,
  ImageIcon,
  FileIcon,
  Images as ImagesIcon,
} from "lucide-react";
import type { Id } from "camox/_generated/dataModel";
import { previewStore } from "@/features/preview/previewStore";

type FieldLabelMeta = {
  schemaTitle?: string;
  fieldName: string;
  fetchedTitle?: string | null;
};

type TreeDoubleClickParams = {
  blockId: Id<"blocks">;
  fieldName: string;
};

type SchemaFieldMeta = {
  arrayItemType?: string;
};

const fieldTypesDictionary = {
  String: {
    label: "String",
    isScalar: true,
    isContentEditable: true,
    getIcon: () => (props: LucideProps) => <TypeIcon {...props} />,
    getLabel: (value: unknown) => value as string,
    onTreeDoubleClick: ({ blockId, fieldName }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setSelectedField", blockId, fieldName, fieldType: "String" });
      previewStore.send({ type: "openBlockContentSheet", blockId });
    },
  },
  RepeatableObject: {
    label: "Repeatable object",
    isScalar: false,
    isContentEditable: false,
    getIcon: ({ arrayItemType }: SchemaFieldMeta) => {
      if (arrayItemType === "Image") return (props: LucideProps) => <ImagesIcon {...props} />;
      return (props: LucideProps) => <ListIcon {...props} />;
    },
    getLabel: (_value: unknown, { schemaTitle, fieldName }: FieldLabelMeta) =>
      schemaTitle ?? fieldName,
    onTreeDoubleClick: ({ blockId }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setFocusedBlock", blockId });
      previewStore.send({ type: "openBlockContentSheet", blockId });
    },
  },
  Enum: {
    label: "Enum",
    isScalar: true,
    isContentEditable: false,
    getIcon: () => (props: LucideProps) => <ChevronDownIcon {...props} />,
    getLabel: (value: unknown) => value as string,
    onTreeDoubleClick: ({ blockId, fieldName }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setSelectedField", blockId, fieldName, fieldType: "Enum" });
      previewStore.send({ type: "openBlockContentSheet", blockId });
    },
  },
  Boolean: {
    label: "Boolean",
    isScalar: true,
    isContentEditable: false,
    getIcon: () => (props: LucideProps) => <ToggleLeftIcon {...props} />,
    getLabel: (value: unknown) => JSON.stringify(value),
    onTreeDoubleClick: ({ blockId, fieldName }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setSelectedField", blockId, fieldName, fieldType: "Boolean" });
      previewStore.send({ type: "openBlockContentSheet", blockId });
    },
  },
  Embed: {
    label: "Embed",
    isScalar: true,
    isContentEditable: false,
    getIcon: () => (props: LucideProps) => <FrameIcon {...props} />,
    getLabel: (
      value: unknown,
      { schemaTitle, fieldName, fetchedTitle }: FieldLabelMeta,
    ) => {
      let domain: string | null = null;
      try {
        domain = new URL(value as string).hostname.replace(/^www\./, "");
      } catch {}
      return fetchedTitle ?? schemaTitle ?? domain ?? fieldName;
    },
    onTreeDoubleClick: ({ blockId, fieldName }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setSelectedField", blockId, fieldName, fieldType: "Embed" });
      previewStore.send({ type: "openBlockContentSheet", blockId });
    },
  },
  Link: {
    label: "Link",
    isScalar: false,
    isContentEditable: false,
    getIcon: () => (props: LucideProps) => <Link2Icon {...props} />,
    getLabel: (value: unknown) => (value as { text: string }).text,
    onTreeDoubleClick: ({ blockId, fieldName }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setSelectedField", blockId, fieldName, fieldType: "Link" });
      previewStore.send({ type: "openBlockContentSheet", blockId });
      previewStore.send({ type: "drillIntoLink", fieldName });
    },
  },
  Image: {
    label: "Image",
    isScalar: false,
    isContentEditable: false,
    getIcon: () => (props: LucideProps) => <ImageIcon {...props} />,
    getLabel: (value: unknown, { schemaTitle, fieldName }: FieldLabelMeta) =>
      (value as { filename?: string } | null)?.filename ??
      schemaTitle ??
      fieldName,
    onTreeDoubleClick: ({ blockId, fieldName }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setSelectedField", blockId, fieldName, fieldType: "Image" });
      previewStore.send({ type: "openBlockContentSheet", blockId });
    },
  },
  File: {
    label: "File",
    isScalar: false,
    isContentEditable: false,
    getIcon: () => (props: LucideProps) => <FileIcon {...props} />,
    getLabel: (value: unknown, { schemaTitle, fieldName }: FieldLabelMeta) =>
      (value as { filename?: string } | null)?.filename ??
      schemaTitle ??
      fieldName,
    onTreeDoubleClick: ({ blockId, fieldName }: TreeDoubleClickParams) => {
      previewStore.send({ type: "setSelectedField", blockId, fieldName, fieldType: "File" });
      previewStore.send({ type: "openBlockContentSheet", blockId });
    },
  },
} satisfies Record<
  string,
  {
    label: string;
    isScalar: boolean;
    getIcon: (meta: SchemaFieldMeta) => (props: LucideProps) => React.ReactNode;
    isContentEditable: boolean;
    getLabel: (value: unknown, meta: FieldLabelMeta) => string;
    onTreeDoubleClick: (params: TreeDoubleClickParams) => void;
  }
>;

type FieldTypesDictionary = typeof fieldTypesDictionary;
type FieldType = keyof FieldTypesDictionary;

export type { FieldType, FieldLabelMeta, SchemaFieldMeta };
export { fieldTypesDictionary };
