/* -------------------------------------------------------------------------------------------------
 * EditPageSheet
 * -----------------------------------------------------------------------------------------------*/

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as Sheet from "@/components/ui/sheet";
import * as ControlGroup from "@/components/ui/control-group";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { api } from "camox/_generated/api";
import { Doc } from "camox/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { InputBase, InputBaseAdornment } from "@/components/ui/input-base";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatPathSegment } from "@/lib/utils";
import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";

const NO_PARENT_VALUE = "__no_parent__";

const EditPageSheet = () => {
  const editingPage = useSelector(
    previewStore,
    (state) => state.context.editingPage,
  );

  if (!editingPage) return null;

  return <EditPageSheetContent pageToEdit={editingPage} />;
};

const EditPageSheetContent = ({ pageToEdit }: { pageToEdit: Doc<"pages"> }) => {
  const isRootPage = pageToEdit.fullPath === "/";
  const pages = useQuery(api.pages.listPages);
  const updatePage = useMutation(api.pages.updatePage);
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
          pageToEdit.metaTitle ?? formatPathSegment(values.value.pathSegment);
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

  const getParentPath = (parentPageId: string | undefined) => {
    if (!pages) return "/";
    if (!parentPageId) return "/";
    const page = pages.find((p) => p._id === parentPageId);
    return page ? page.fullPath + "/" : "/";
  };

  return (
    <Sheet.Sheet
      open
      onOpenChange={(value) => {
        if (!value) previewStore.send({ type: "closeEditPageSheet" });
      }}
    >
      <Sheet.SheetContent className="min-w-[500px]">
        <Sheet.SheetHeader className="border-b border-border">
          <Sheet.SheetTitle>Edit page</Sheet.SheetTitle>
          <Sheet.SheetDescription>
            Update the page details. Changes will be reflected immediately.
          </Sheet.SheetDescription>
        </Sheet.SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4 py-4 px-4"
        >
          <form.Field name="parentPageId">
            {(field) => (
              <div className="space-y-2">
                <Label>
                  Parent page{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Select
                  value={field.state.value ?? ""}
                  disabled={isRootPage}
                  onValueChange={(value) =>
                    field.handleChange(
                      ["", NO_PARENT_VALUE].includes(value)
                        ? (undefined as any)
                        : value,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No parent" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PARENT_VALUE}>No parent</SelectItem>
                    <SelectSeparator />
                    {pages?.map((page) => (
                      <SelectItem key={page._id} value={page._id}>
                        {page.metaTitle ?? formatPathSegment(page.pathSegment)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Select a parent page to nest this page under it.
                </p>
              </div>
            )}
          </form.Field>
          <form.Field name="pathSegment">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="pathSegment">Page path</Label>
                <ControlGroup.ControlGroup>
                  <ControlGroup.ControlGroupItem className="shrink-0">
                    <InputBase>
                      <InputBaseAdornment>
                        <form.Subscribe selector={(s) => s.values.parentPageId}>
                          {(parentPageId) => getParentPath(parentPageId)}
                        </form.Subscribe>
                      </InputBaseAdornment>
                    </InputBase>
                  </ControlGroup.ControlGroupItem>
                  <ControlGroup.ControlGroupItem>
                    <Input
                      id="pathSegment"
                      value={field.state.value}
                      disabled={isRootPage}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="e.g. home, about-us"
                    />
                  </ControlGroup.ControlGroupItem>
                </ControlGroup.ControlGroup>
                <p className="text-muted-foreground text-xs">
                  Used to generate the page URL, along with the parent page.
                </p>
              </div>
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
      </Sheet.SheetContent>
    </Sheet.Sheet>
  );
};

export { EditPageSheet };
