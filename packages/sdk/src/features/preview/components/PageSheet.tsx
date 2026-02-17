/* -------------------------------------------------------------------------------------------------
 * PageSheet
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
import { useAction, useMutation, useQuery } from "convex/react";
import * as React from "react";
import { toast } from "sonner";
import { InputBase, InputBaseAdornment } from "@/components/ui/input-base";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const NO_PARENT_VALUE = "__no_parent__";

type PageFormValues = Pick<
  Doc<"pages">,
  "nickname" | "pathSegment" | "parentPageId"
> & {
  contentDescription: string;
};

const defaultPageFormValues: PageFormValues = {
  nickname: "",
  parentPageId: undefined,
  pathSegment: "",
  contentDescription: "",
};

const PageSheet = ({
  open,
  onOpenChange,
  mode,
  pageToEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  pageToEdit?: Doc<"pages">;
}) => {
  const pages = useQuery(api.pages.listPages);
  const project = useQuery(api.projects.getFirstProject);
  const createPage = useAction(api.pageActions.createPage);
  const updatePage = useMutation(api.pages.updatePage);
  const navigate = useNavigate();

  const isEditMode = mode === "edit" && pageToEdit;

  const form = useForm({
    defaultValues: isEditMode
      ? {
          nickname: pageToEdit.nickname,
          pathSegment: pageToEdit.pathSegment,
          parentPageId: pageToEdit.parentPageId,
          contentDescription: "",
        }
      : defaultPageFormValues,
    onSubmit: async (values) => {
      try {
        if (isEditMode) {
          const { fullPath } = await updatePage({
            pageId: pageToEdit._id,
            nickname: values.value.nickname,
            pathSegment: values.value.pathSegment,
            parentPageId: values.value.parentPageId,
          });

          toast.success(`Updated ${values.value.nickname} page`);
          onOpenChange(false);
          form.reset();

          navigate({ to: fullPath });
        } else {
          if (!project) {
            toast.error("Project not found");
            return;
          }

          const createPagePromise = createPage({
            projectId: project._id,
            nickname: values.value.nickname,
            pathSegment: values.value.pathSegment,
            parentPageId: values.value.parentPageId,
            contentDescription: values.value.contentDescription || undefined,
          });

          toast.promise(createPagePromise, {
            loading: "Creating page...",
            success: `Created ${values.value.nickname} page`,
            error: "Failed to create page",
          });

          const { fullPath } = await createPagePromise;
          onOpenChange(false);
          form.reset();

          // Small delay to allow database to sync before navigation
          await new Promise((resolve) => setTimeout(resolve, 50));
          navigate({ to: fullPath });
        }
      } catch (error) {
        console.error(
          `Failed to ${isEditMode ? "update" : "create"} page:`,
          error,
        );
        toast.error(
          `Could not ${isEditMode ? "update" : "create"} ${
            values.value.nickname
          } page`,
        );
      }
    },
  });

  // Reset form when opening in edit mode with different page
  React.useEffect(() => {
    if (isEditMode && open) {
      form.update({
        defaultValues: {
          nickname: pageToEdit.nickname,
          pathSegment: pageToEdit.pathSegment,
          parentPageId: pageToEdit.parentPageId,
          contentDescription: "",
        },
      });
    } else if (!isEditMode && open) {
      form.reset();
    }
  }, [open, isEditMode, pageToEdit, form]);

  const getParentPath = (parentPageId: string | undefined) => {
    if (!pages) return "/";
    if (!parentPageId) return "/";
    const page = pages.find((p) => p._id === parentPageId);
    return page ? page.fullPath + "/" : "/";
  };

  return (
    <Sheet.Sheet open={open} onOpenChange={onOpenChange}>
      <Sheet.SheetContent className="min-w-[500px]">
        <Sheet.SheetHeader className="border-b border-border">
          <Sheet.SheetTitle>
            {isEditMode ? "Edit page" : "Create page"}
          </Sheet.SheetTitle>
          <Sheet.SheetDescription>
            {isEditMode
              ? "Update the page details. Changes will be reflected immediately."
              : "Fill in the details to create a new page. It will be created as a draft."}
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
          <form.Field name="nickname">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="nickname">Page nickname</Label>
                <Input
                  id="nickname"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="e.g. Home, About Us"
                />
                <p className="text-muted-foreground text-xs">
                  Used to identify the page within Camox. Does not affect SEO.
                </p>
              </div>
            )}
          </form.Field>
          <form.Field name="parentPageId">
            {(field) => (
              <div className="space-y-2">
                <Label>
                  Parent page{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Select
                  value={field.state.value ?? ""}
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
                        {page.nickname}
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
          {mode === "create" && (
            <form.Field name="contentDescription">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="contentDescription">
                    Content description
                  </Label>
                  <Textarea
                    id="contentDescription"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="What your page will be about"
                  />
                  <p className="text-muted-foreground text-xs">
                    Used to generate a first draft of the page with AI.
                  </p>
                </div>
              )}
            </form.Field>
          )}
          <Button type="submit" disabled={form.state.isSubmitting}>
            {form.state.isSubmitting && <Spinner />}
            {isEditMode ? "Save changes" : "Create page"}
            {form.state.isSubmitting && "..."}
          </Button>
        </form>
      </Sheet.SheetContent>
    </Sheet.Sheet>
  );
};

export { PageSheet };
