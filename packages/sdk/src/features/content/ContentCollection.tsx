import { Button, buttonVariants } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { PanelContent, PanelHeader, PanelTitle } from "@camox/ui/panel";
import { Switch } from "@camox/ui/switch";
import { Textarea } from "@camox/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ListIcon, PlusIcon } from "lucide-react";

import { Link } from "@/features/navigation/navigation";
import { collectionContentPath, newCollectionItemPath } from "@/features/studio/routes";
import { collectionQueries, type CollectionDefinition } from "@/lib/queries";

export const ContentCollection = ({
  projectSlug,
  collection,
}: {
  projectSlug: string;
  collection: CollectionDefinition;
}) => {
  const {
    data: records,
    isPending,
    isError,
    refetch,
  } = useQuery(collectionQueries.records(projectSlug, collection.collectionId));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PanelHeader className="flex items-center justify-between gap-4">
        <div>
          <PanelTitle>{collection.title}</PanelTitle>
          {collection.description && (
            <p className="text-muted-foreground mt-2 text-sm">{collection.description}</p>
          )}
        </div>
        <Link
          className={buttonVariants({ variant: "outline" })}
          to={newCollectionItemPath(collection.collectionId)}
        >
          <PlusIcon aria-hidden className="size-4" />
          Create item
        </Link>
      </PanelHeader>
      <PanelContent className="flex flex-col p-4">
        {isPending && (
          <p role="status" className="text-muted-foreground m-auto text-sm">
            Loading items…
          </p>
        )}
        {isError && (
          <div role="alert" className="m-auto flex flex-col items-center gap-3">
            <p className="text-muted-foreground text-sm">Could not load items.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}
        {!isPending && !isError && records?.length === 0 && (
          <div className="m-auto flex max-w-sm flex-col items-center gap-2 text-center">
            <ListIcon aria-hidden className="text-muted-foreground mb-2 h-8 w-8" />
            <h2 className="font-medium">No items yet</h2>
            <p className="text-muted-foreground text-sm">
              Items in {collection.title} will appear here.
            </p>
            <Link
              className={buttonVariants({ className: "mt-2" })}
              to={newCollectionItemPath(collection.collectionId)}
            >
              <PlusIcon aria-hidden className="size-4" />
              Create item
            </Link>
          </div>
        )}
        {!isError && records && records.length > 0 && (
          <ul aria-label={`${collection.title} items`} className="divide-y rounded-md border">
            {records.map((record) => (
              <li key={record.id} className="px-4 py-3 text-sm">
                {record.label || "Untitled item"}
              </li>
            ))}
          </ul>
        )}
      </PanelContent>
    </div>
  );
};

type FieldSchema = {
  fieldType: "String" | "Embed" | "Enum" | "Boolean" | "Image" | "File" | "ImageList" | "FileList";
  title?: string;
  default?: unknown;
  enum?: string[];
  enumLabels?: Record<string, string>;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  accept?: string[];
  items?: { accept?: string[] };
};

type FormValue = string | boolean | File | File[] | null;

const fieldLabel = (name: string, schema: FieldSchema) =>
  schema.title ?? name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());

function collectionFormFields(contentSchema: unknown, label: string) {
  const schema = contentSchema as { properties: Record<string, FieldSchema> };
  const fields = Object.entries(schema.properties);
  return fields.sort(([a], [b]) => Number(b === label) - Number(a === label));
}

function CollectionItemForm({ contentSchema, label }: { contentSchema: unknown; label: string }) {
  const fields = collectionFormFields(contentSchema, label);
  const defaultValues: Record<string, FormValue> = {};
  for (const [name, schema] of fields) {
    if (schema.fieldType === "Boolean") {
      defaultValues[name] = schema.default === true;
    } else if (schema.fieldType.endsWith("List")) {
      defaultValues[name] = [];
    } else if (schema.fieldType === "Image" || schema.fieldType === "File") {
      defaultValues[name] = null;
    } else {
      defaultValues[name] = typeof schema.default === "string" ? schema.default : "";
    }
  }
  const form = useForm({ defaultValues });

  return (
    <form onSubmit={(event) => event.preventDefault()} className="max-w-2xl space-y-6">
      {fields.map(([name, schema]) => {
        const label = fieldLabel(name, schema);
        return (
          <form.Field key={name} name={name}>
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={`collection-${name}`}>{label}</Label>
                {schema.fieldType === "String" && schema.pattern && (
                  <Input
                    id={`collection-${name}`}
                    name={field.name}
                    value={typeof field.state.value === "string" ? field.state.value : ""}
                    minLength={schema.minLength}
                    maxLength={schema.maxLength}
                    pattern={schema.pattern}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
                {schema.fieldType === "String" && !schema.pattern && (
                  <Textarea
                    id={`collection-${name}`}
                    name={field.name}
                    value={typeof field.state.value === "string" ? field.state.value : ""}
                    minLength={schema.minLength}
                    maxLength={schema.maxLength}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
                {schema.fieldType === "Embed" && (
                  <Input
                    id={`collection-${name}`}
                    name={field.name}
                    type="url"
                    value={typeof field.state.value === "string" ? field.state.value : ""}
                    pattern={schema.pattern}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  />
                )}
                {schema.fieldType === "Enum" && (
                  <select
                    id={`collection-${name}`}
                    name={field.name}
                    className="border-input bg-background h-9 w-full rounded-md border px-2.5 text-sm"
                    value={typeof field.state.value === "string" ? field.state.value : ""}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                  >
                    {schema.enum?.map((option) => (
                      <option key={option} value={option}>
                        {schema.enumLabels?.[option] ?? option}
                      </option>
                    ))}
                  </select>
                )}
                {schema.fieldType === "Boolean" && (
                  <Switch
                    id={`collection-${name}`}
                    name={field.name}
                    checked={field.state.value === true}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                )}
                {["Image", "File", "ImageList", "FileList"].includes(schema.fieldType) && (
                  <Input
                    id={`collection-${name}`}
                    name={field.name}
                    type="file"
                    multiple={schema.fieldType.endsWith("List")}
                    accept={
                      schema.accept?.join(",") ??
                      schema.items?.accept?.join(",") ??
                      (schema.fieldType.startsWith("Image") ? "image/*" : undefined)
                    }
                    onBlur={field.handleBlur}
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      field.handleChange(
                        schema.fieldType.endsWith("List") ? files : (files[0] ?? null),
                      );
                    }}
                  />
                )}
              </div>
            )}
          </form.Field>
        );
      })}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled>
          Create item
        </Button>
        <p className="text-muted-foreground text-sm">Saving items is not available yet.</p>
      </div>
    </form>
  );
}

export const ContentCollectionNew = ({
  projectSlug,
  collection,
}: {
  projectSlug: string;
  collection: CollectionDefinition;
}) => {
  const {
    data: definition,
    isPending,
    isError,
    refetch,
  } = useQuery(collectionQueries.get(projectSlug, collection.collectionId));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <PanelHeader className="space-y-3">
        <Link
          to={collectionContentPath(collection.collectionId)}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon aria-hidden className="size-4" />
          {collection.title}
        </Link>
        <PanelTitle>New item</PanelTitle>
      </PanelHeader>
      <PanelContent className="p-6">
        {isPending && <p role="status">Loading fields…</p>}
        {isError && (
          <div role="alert" className="flex items-center gap-3">
            <p>Could not load collection fields.</p>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        )}
        {definition && (
          <CollectionItemForm contentSchema={definition.contentSchema} label={definition.label} />
        )}
      </PanelContent>
    </div>
  );
};
