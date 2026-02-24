import {
  Type as TypeIcon,
  List as ListIcon,
  ChevronDown as ChevronDownIcon,
  ToggleLeft as ToggleLeftIcon,
  type LucideProps,
  FrameIcon,
  Link2 as Link2Icon,
  ImageIcon,
} from "lucide-react";

type FieldLabelMeta = {
  schemaTitle?: string;
  fieldName: string;
  fetchedTitle?: string | null;
};

const fieldTypesDictionary = {
  String: {
    label: "String",
    isScalar: true,
    isContentEditable: true,
    Icon: (props: LucideProps) => <TypeIcon {...props} />,
    getLabel: (value: unknown) => value as string,
  },
  RepeatableObject: {
    label: "Repeatable object",
    isScalar: false,
    isContentEditable: false,
    Icon: (props: LucideProps) => <ListIcon {...props} />,
    getLabel: (_value: unknown, { schemaTitle, fieldName }: FieldLabelMeta) =>
      schemaTitle ?? fieldName,
  },
  Enum: {
    label: "Enum",
    isScalar: true,
    isContentEditable: false,
    Icon: (props: LucideProps) => <ChevronDownIcon {...props} />,
    getLabel: (value: unknown) => value as string,
  },
  Boolean: {
    label: "Boolean",
    isScalar: true,
    isContentEditable: false,
    Icon: (props: LucideProps) => <ToggleLeftIcon {...props} />,
    getLabel: (value: unknown) => JSON.stringify(value),
  },
  Embed: {
    label: "Embed",
    isScalar: true,
    isContentEditable: false,
    Icon: (props: LucideProps) => <FrameIcon {...props} />,
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
  },
  Link: {
    label: "Link",
    isScalar: false,
    isContentEditable: false,
    Icon: (props: LucideProps) => <Link2Icon {...props} />,
    getLabel: (value: unknown) => (value as { text: string }).text,
  },
  Media: {
    label: "Media",
    isScalar: false,
    isContentEditable: false,
    Icon: (props: LucideProps) => <ImageIcon {...props} />,
    getLabel: (value: unknown, { schemaTitle, fieldName }: FieldLabelMeta) =>
      (value as { filename?: string } | null)?.filename ??
      schemaTitle ??
      fieldName,
  },
} satisfies Record<
  string,
  {
    label: string;
    isScalar: boolean;
    Icon: (props: LucideProps) => React.ReactNode;
    isContentEditable: boolean;
    getLabel: (value: unknown, meta: FieldLabelMeta) => string;
  }
>;

type FieldTypesDictionary = typeof fieldTypesDictionary;
type FieldType = keyof FieldTypesDictionary;

export type { FieldType, FieldLabelMeta };
export { fieldTypesDictionary };
