/* -------------------------------------------------------------------------------------------------
 * EditPageSheet
 * -----------------------------------------------------------------------------------------------*/

import * as Sheet from "@/components/ui/sheet";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { api } from "camox/_generated/api";
import { Doc } from "camox/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatPathSegment } from "@/lib/utils";
import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";
import { DebouncedFieldEditor } from "./DebouncedFieldEditor";
import { PageLocationFieldset } from "./PageLocationFieldset";

const EditPageSheet = () => {
  const editingPage = useSelector(
    previewStore,
    (state) => state.context.editingPage,
  );

  if (!editingPage) return null;

  return <EditPageSheetContent pageToEdit={editingPage} />;
};

const EditPageSheetContent = ({ pageToEdit }: { pageToEdit: Doc<"pages"> }) => {
  const livePage = useQuery(api.pages.getPageById, {
    pageId: pageToEdit._id,
  });
  const page = livePage ?? pageToEdit;
  const isRootPage = page.fullPath === "/";
  const pages = useQuery(api.pages.listPages);
  const updatePage = useMutation(api.pages.updatePage);
  const setAiSeo = useMutation(api.pages.setAiSeo);
  const updatePageMetaTitle = useMutation(api.pages.updatePageMetaTitle);
  const updatePageMetaDescription = useMutation(
    api.pages.updatePageMetaDescription,
  );
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      pathSegment: pageToEdit.pathSegment,
      parentPageId: pageToEdit.parentPageId,
    },
    onSubmit: async (values) => {
      try {
        const { fullPath } = await updatePage({
          pageId: pageToEdit._id,
          pathSegment: values.value.pathSegment,
          parentPageId: values.value.parentPageId,
        });

        const displayName =
          page.metaTitle ?? formatPathSegment(values.value.pathSegment);
        toast.success(`Updated ${displayName} page`);
        previewStore.send({ type: "closeEditPageSheet" });
        form.reset();

        navigate({ to: fullPath });
      } catch (error) {
        console.error("Failed to update page:", error);
        toast.error("Could not update page");
      }
    },
  });

  // Reset form when opening with a different page
  React.useEffect(() => {
    form.update({
      defaultValues: {
        pathSegment: pageToEdit.pathSegment,
        parentPageId: pageToEdit.parentPageId,
      },
    });
  }, [pageToEdit, form]);

  return (
    <Sheet.Sheet
      open
      onOpenChange={(value) => {
        if (!value) previewStore.send({ type: "closeEditPageSheet" });
      }}
    >
      <Sheet.SheetContent className="min-w-[500px] gap-0">
        <Sheet.SheetHeader className="border-b border-border">
          <Sheet.SheetTitle>Edit page</Sheet.SheetTitle>
          <Sheet.SheetDescription>
            Update the page details.
          </Sheet.SheetDescription>
        </Sheet.SheetHeader>
        <div className="space-y-4 py-4 px-4">
          <p className="text-xs font-medium text-muted-foreground">URL</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            className="space-y-4"
          >
            <form.Field name="parentPageId">
              {(parentField) => (
                <form.Field name="pathSegment">
                  {(pathField) => (
                    <PageLocationFieldset
                      parentPageId={parentField.state.value}
                      onParentPageIdChange={parentField.handleChange}
                      pathSegment={pathField.state.value}
                      onPathSegmentChange={pathField.handleChange}
                      disabled={isRootPage}
                      pages={pages}
                      excludePageId={pageToEdit._id}
                    />
                  )}
                </form.Field>
              )}
            </form.Field>
            <Button
              type="submit"
              disabled={form.state.isSubmitting || form.state.isPristine}
            >
              {form.state.isSubmitting && <Spinner />}
              Save changes
              {form.state.isSubmitting && "..."}
            </Button>
          </form>
        </div>
        <div className="space-y-4 py-4 px-4">
          <p className="text-xs font-medium text-muted-foreground">SEO</p>
          <div className="flex items-center gap-2">
            <Switch
              id="ai-seo"
              checked={page.aiSeoEnabled !== false}
              onCheckedChange={(checked) =>
                setAiSeo({ pageId: page._id, enabled: checked })
              }
            />
            <Label htmlFor="ai-seo">AI metadata</Label>
          </div>
          <DebouncedFieldEditor
            label="Page title"
            placeholder="Page title..."
            initialValue={page.metaTitle ?? ""}
            disabled={page.aiSeoEnabled !== false}
            onSave={(value) =>
              updatePageMetaTitle({ pageId: page._id, metaTitle: value })
            }
          />
          <DebouncedFieldEditor
            label="Page description"
            placeholder="Page description..."
            initialValue={page.metaDescription ?? ""}
            disabled={page.aiSeoEnabled !== false}
            rows={2}
            onSave={(value) =>
              updatePageMetaDescription({
                pageId: page._id,
                metaDescription: value,
              })
            }
          />
        </div>
      </Sheet.SheetContent>
    </Sheet.Sheet>
  );
};

export { EditPageSheet };
