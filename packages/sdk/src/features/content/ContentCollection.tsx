import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { PanelContent, PanelHeader, PanelTitle } from "@camox/ui/panel";
import { Switch } from "@camox/ui/switch";
import { Textarea } from "@camox/ui/textarea";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListIcon, PlusCircleIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { SingleAssetFieldEditor } from "@/features/preview/components/AssetFieldEditor";
import { MultipleAssetFieldEditor } from "@/features/preview/components/MultipleAssetFieldEditor";
import { PageStatusBadge } from "@/features/preview/components/PageStatusBadge";
import { invalidateCollectionRecordViews } from "@/lib/collection-cache";
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
import { useCollectionItemModal } from "./CollectionItemModalContext";
import { DeleteCollectionItemButton } from "./components/DeleteCollectionItemButton";
import { PublishCollectionItemButton } from "./components/PublishCollectionItemButton";

export const ContentCollection = ({
  projectSlug,
  collection,
}: {
  projectSlug: string;
  collection: CollectionDefinition;
}) => {
  const itemModal = useCollectionItemModal();
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
        <Button
          variant="outline"
          onClick={() => itemModal.open({ collectionId: collection.collectionId })}
        >
          <PlusIcon aria-hidden className="size-4" />
          Create item
        </Button>
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
            <Button
              variant="outline"
              className="mt-2"
              onClick={() => itemModal.open({ collectionId: collection.collectionId })}
            >
              <PlusIcon aria-hidden className="size-4" />
              Create item
            </Button>
          </div>
        )}
        {!isError && records && records.length > 0 && (
          <ul aria-label={`${collection.title} items`} className="divide-y rounded-md border">
            {records.map((record) => (
              <li key={record.id} className="group hover:bg-accent flex items-center">
                <button
                  type="button"
                  onClick={() =>
                    itemModal.open({ collectionId: collection.collectionId, itemId: record.id })
                  }
                  className="focus-visible:bg-accent flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-sm"
                >
                  <span className="truncate">{record.label || "Untitled item"}</span>
                  <PageStatusBadge size="sm" status={record.status} />
                </button>
                <PublishCollectionItemButton
                  projectSlug={projectSlug}
                  collectionId={collection.collectionId}
                  record={record}
                />
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
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground font-normal"
                onClick={() => itemModal.open({ collectionId: collection.collectionId })}
              >
                <PlusCircleIcon aria-hidden className="size-3.5" />
                Add item
              </Button>
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
  initialContent,
  onSaved,
}: {
  contentSchema: unknown;
  label: string;
  projectSlug: string;
  collectionId: string;
  record?: CollectionRecord;
  initialContent?: Record<string, unknown>;
  onSaved: (record: CollectionRecord) => void | Promise<void>;
}) {
  const fields = collectionFormFields(contentSchema, label);
  // Background refetches must not replace edits or advance the expected version.
  const [savedRecord, setSavedRecord] = useState(record);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const create = useMutation(collectionMutations.create());
  const edit = useMutation(collectionMutations.edit());
  const [submitting, setSubmitting] = useState(false);
  const saving = submitting || create.isPending || edit.isPending;
  const [defaultValues] = useState(() =>
    collectionFormDefaults(fields, savedRecord?.draft ?? initialContent),
  );
  const form = useForm({
    defaultValues,
    onSubmit: async ({ value }) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        const content = collectionFormContent(fields, value, savedRecord?.draft);
        const scope = { projectSlug, collectionId, content };
        const saved = savedRecord
          ? await edit.mutateAsync({
              ...scope,
              id: savedRecord.id,
              expectedVersion: savedRecord.version,
            })
          : await create.mutateAsync(scope);
        // Advance only after our own successful save, never from a refetch.
        setSavedRecord(saved);
        queryClient.setQueryData(
          collectionQueries.record(projectSlug, collectionId, saved.id).queryKey,
          saved,
        );
        await invalidateCollectionRecordViews(queryClient, projectSlug, collectionId);
        await onSaved(saved);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Please try again.";
        setError(`Could not save item. ${message}`);
        await queryClient.invalidateQueries({
          queryKey: collectionQueries.records(projectSlug, collectionId).queryKey,
        });
      } finally {
        setSubmitting(false);
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
          {saving ? "Saving…" : savedRecord ? "Save changes" : "Create item"}
        </Button>
      </div>
    </form>
  );
}

export const ContentCollectionItemEditor = ({
  collectionId,
  itemId,
  initialContent,
  onSaved,
  projectSlug,
}: {
  collectionId: string;
  itemId?: string;
  /** Prefills a new item's form; ignored when editing. */
  initialContent?: Record<string, unknown>;
  onSaved: (record: CollectionRecord) => void | Promise<void>;
  projectSlug: string;
}) => {
  const recordQuery = useQuery({
    ...collectionQueries.record(projectSlug, collectionId, itemId ?? ""),
    enabled: !!itemId,
  });
  const {
    data: definition,
    isPending,
    isError,
    refetch,
  } = useQuery({
    ...collectionQueries.get(projectSlug, collectionId),
  });

  return (
    <>
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
          key={`${collectionId}:${itemId ?? "new"}`}
          contentSchema={definition.contentSchema}
          label={definition.label}
          projectSlug={projectSlug}
          collectionId={collectionId}
          record={itemId ? recordQuery.data : undefined}
          initialContent={itemId ? undefined : initialContent}
          onSaved={onSaved}
        />
      )}
    </>
  );
};

export const ContentCollectionItemModal = ({ projectSlug }: { projectSlug: string }) => {
  const { close, complete, target } = useCollectionItemModal();

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && close()}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target?.itemId ? "Edit item" : "New item"}</DialogTitle>
          <DialogDescription>
            {target?.itemId ? "Update this collection item." : "Create a new collection item."}
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-1 min-h-0 overflow-y-auto px-1">
          {target && (
            <ContentCollectionItemEditor
              key={`${target.collectionId}:${target.itemId ?? "new"}`}
              projectSlug={projectSlug}
              collectionId={target.collectionId}
              itemId={target.itemId}
              initialContent={target.initialContent}
              onSaved={(record) => complete(target, record)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
