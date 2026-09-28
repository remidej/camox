import { Button, buttonVariants } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { PanelContent, PanelHeader, PanelTitle } from "@camox/ui/panel";
import { Switch } from "@camox/ui/switch";
import { Textarea } from "@camox/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, ListIcon, PlusCircleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Link, useNavigate } from "@/features/navigation/navigation";
import { SingleAssetFieldEditor } from "@/features/preview/components/AssetFieldEditor";
import { MultipleAssetFieldEditor } from "@/features/preview/components/MultipleAssetFieldEditor";
import {
  collectionContentPath,
  newCollectionItemPath,
  editCollectionItemPath,
} from "@/features/studio/routes";
import {
  collectionQueries,
  collectionMutations,
  type CollectionDefinition,
  type CollectionRecord,
} from "@/lib/queries";

import {
  collectionFormFields,
  collectionFormDefaults,
  collectionFormContent,
  type FieldSchema,
} from "./collection-form";
import { DeleteCollectionItemButton } from "./components/DeleteCollectionItemButton";

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
              <li key={record.id} className="group hover:bg-accent flex items-center">
                <Link
                  to={editCollectionItemPath(collection.collectionId, record.id)}
                  className="focus-visible:bg-accent block min-w-0 flex-1 px-4 py-3 text-sm"
                >
                  {record.label || "Untitled item"}
                </Link>
                <DeleteCollectionItemButton
                  projectSlug={projectSlug}
                  collectionId={collection.collectionId}
                  id={record.id}
                  version={record.version}
                  label={record.label}
                  compact
                />
              </li>
            ))}
            <li className="flex justify-start px-2 py-1">
              <Link
                className={buttonVariants({
                  variant: "ghost",
                  size: "sm",
                  className: "text-muted-foreground hover:text-foreground font-normal",
                })}
                to={newCollectionItemPath(collection.collectionId)}
              >
                <PlusCircleIcon aria-hidden className="size-3.5" />
                Add item
              </Link>
            </li>
          </ul>
        )}
      </PanelContent>
    </div>
  );
};

const fieldLabel = (name: string, schema: FieldSchema) =>
  schema.title ?? name.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());

function CollectionItemForm({
  contentSchema,
  label,
  projectSlug,
  collectionId,
  record,
}: {
  contentSchema: unknown;
  label: string;
  projectSlug: string;
  collectionId: string;
  record?: CollectionRecord;
}) {
  const fields = collectionFormFields(contentSchema, label);
  // Background refetches must not replace edits or advance the expected version.
  const [initialRecord] = useState(record);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const create = useMutation(collectionMutations.create());
  const edit = useMutation(collectionMutations.edit());
  const saving = create.isPending || edit.isPending;
  const [defaultValues] = useState(() => collectionFormDefaults(fields, initialRecord?.draft));
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const content = collectionFormContent(fields, value, initialRecord?.draft);
        const scope = { projectSlug, collectionId, content };
        const saved = initialRecord
          ? await edit.mutateAsync({
              ...scope,
              id: initialRecord.id,
              expectedVersion: initialRecord.version,
            })
          : await create.mutateAsync(scope);
        queryClient.setQueryData(
          collectionQueries.record(projectSlug, collectionId, saved.id).queryKey,
          saved,
        );
        await queryClient.invalidateQueries({
          queryKey: collectionQueries.records(projectSlug, collectionId).queryKey,
        });
        await navigate({ to: collectionContentPath(collectionId) });
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not save item. Please try again.");
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
      className="mx-auto w-full max-w-2xl space-y-6"
    >
      <fieldset disabled={saving} className="space-y-6">
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
                    <fieldset aria-label={label} onBlur={field.handleBlur}>
                      {schema.fieldType.endsWith("List") ? (
                        <MultipleAssetFieldEditor
                          fieldName={name}
                          assetType={schema.fieldType === "ImageList" ? "Image" : "File"}
                          currentData={{ [name]: field.state.value }}
                          onFieldChange={(_, value) => field.handleChange(value)}
                          accept={schema.items?.accept ?? schema.accept}
                          resolveLocally
                        />
                      ) : (
                        <SingleAssetFieldEditor
                          fieldName={name}
                          assetType={schema.fieldType === "Image" ? "Image" : "File"}
                          currentData={{ [name]: field.state.value }}
                          onFieldChange={(_, value) => field.handleChange(value)}
                          accept={schema.accept}
                          resolveLocally
                        />
                      )}
                    </fieldset>
                  )}
                </div>
              )}
            </form.Field>
          );
        })}
      </fieldset>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : initialRecord ? "Save changes" : "Create item"}
        </Button>
        <Link
          className={buttonVariants({ variant: "outline" })}
          to={collectionContentPath(collectionId)}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

export const ContentCollectionNew = ({
  projectSlug,
  collection,
  itemId,
}: {
  projectSlug: string;
  collection: CollectionDefinition;
  itemId?: string;
}) => {
  const recordQuery = useQuery({
    ...collectionQueries.record(projectSlug, collection.collectionId, itemId ?? ""),
    enabled: !!itemId,
  });
  const {
    data: definition,
    isPending,
    isError,
    refetch,
  } = useQuery(collectionQueries.get(projectSlug, collection.collectionId));

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="px-6 pt-2">
        <div className="mx-auto w-full max-w-2xl">
          <Link
            to={collectionContentPath(collection.collectionId)}
            className={buttonVariants({ variant: "ghost", className: "justify-start" })}
          >
            <ArrowLeftIcon aria-hidden className="text-muted-foreground" />
            {itemId ? "Edit item" : "New item"}
          </Link>
        </div>
      </div>
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
        {itemId && recordQuery.isPending && <p role="status">Loading item…</p>}
        {itemId && recordQuery.isError && (
          <div role="alert" className="flex items-center gap-3">
            <p>Could not load item. It may no longer exist.</p>
            <Button variant="outline" onClick={() => void recordQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {definition && (!itemId || recordQuery.data) && (
          <CollectionItemForm
            key={itemId ?? "new"}
            contentSchema={definition.contentSchema}
            label={definition.label}
            projectSlug={projectSlug}
            collectionId={collection.collectionId}
            record={itemId ? recordQuery.data : undefined}
          />
        )}
      </PanelContent>
    </div>
  );
};
