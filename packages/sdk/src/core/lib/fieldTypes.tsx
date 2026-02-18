import {
  Type as TypeIcon,
  List as ListIcon,
  ChevronDown as ChevronDownIcon,
  ToggleLeft as ToggleLeftIcon,
  type LucideProps,
  FrameIcon,
} from "lucide-react";

const fieldTypesDictionary = {
  String: {
    label: "String",
    isScalar: true,
    isContentEditable: true,
    Icon: (props: LucideProps) => <TypeIcon {...props} />,
  },
  RepeatableObject: {
    label: "Repeatable object",
    isScalar: false,
    isContentEditable: false,
    Icon: (props: LucideProps) => <ListIcon {...props} />,
  },
  Enum: {
    label: "Enum",
    isScalar: true,
    isContentEditable: false,
    Icon: (props: LucideProps) => <ChevronDownIcon {...props} />,
  },
  Boolean: {
    label: "Boolean",
    isScalar: true,
    isContentEditable: false,
    Icon: (props: LucideProps) => <ToggleLeftIcon {...props} />,
  },
  Embed: {
    label: "Embed",
    isScalar: true,
    isContentEditable: false,
    Icon: (props: LucideProps) => <FrameIcon {...props} />,
  },
} satisfies Record<
  string,
  {
    label: string;
    isScalar: boolean;
    Icon: (props: LucideProps) => React.ReactNode;
    isContentEditable: boolean;
  }
>;

type FieldTypesDictionary = typeof fieldTypesDictionary;
type FieldType = keyof FieldTypesDictionary;

export type { FieldType };
export { fieldTypesDictionary };
