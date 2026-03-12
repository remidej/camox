/* -------------------------------------------------------------------------------------------------
 * CreatePageSheet
 * -----------------------------------------------------------------------------------------------*/

import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store/react";
import { api } from "camox/_generated/api";
import { Id } from "camox/_generated/dataModel";
import { useAction, useQuery } from "convex/react";
import { useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as Sheet from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { previewStore } from "../previewStore";
import { PageLocationFieldset } from "./PageLocationFieldset";

const CreatePageSheet = () => {
  const open = useSelector(previewStore, (state) => state.context.isCreatePageSheetOpen);
  const pages = useQuery(api.pages.listPages);
  const project = useQuery(api.projects.getFirstProject);
  const layouts = useQuery(api.layouts.listLayouts, project ? { projectId: project._id } : "skip");
  const camoxApp = useCamoxApp();
  const createPage = useAction(api.pageActions.createPage);
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      parentPageId: undefined as Id<"pages"> | undefined,
      pathSegment: "",
      layoutId: "" as string,
      contentDescription: "",
    },
    onSubmit: async (values) => {
      try {
        if (!project) {
          toast.error("Project not found");
          return;
        }

        const createPagePromise = createPage({
          projectId: project._id,
          pathSegment: values.value.pathSegment,
          parentPageId: values.value.parentPageId,
          layoutId: values.value.layoutId as Id<"layouts">,
          contentDescription: values.value.contentDescription || undefined,
        });

        toast.promise(createPagePromise, {
          loading: "Creating page...",
          success: "Page created",
          error: "Failed to create page",
        });

        const { fullPath } = await createPagePromise;
        previewStore.send({ type: "closeCreatePageSheet" });
        form.reset();

        // Small delay to allow database to sync before navigation
        await new Promise((resolve) => setTimeout(resolve, 50));
        navigate({ to: fullPath });
      } catch (error) {
        console.error("Failed to create page:", error);
        toast.error("Could not create page");
      }
    },
  });

  useEffect(() => {
    if (layouts && layouts.length > 0 && !form.getFieldValue("layoutId")) {
      form.setFieldValue("layoutId", layouts[0]._id);
    }
  }, [layouts, form]);

  return (
    <Sheet.Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) previewStore.send({ type: "closeCreatePageSheet" });
      }}
    >
      <Sheet.SheetContent className="flex max-h-dvh min-w-[500px] flex-col">
        <Sheet.SheetHeader className="border-border border-b">
          <Sheet.SheetTitle>Create page</Sheet.SheetTitle>
          <Sheet.SheetDescription>
            Fill in the details to create a new page. It will be created as a draft.
          </Sheet.SheetDescription>
        </Sheet.SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4 overflow-y-auto px-4 py-4"
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
                    pages={pages}
                  />
                )}
              </form.Field>
            )}
          </form.Field>
          <form.Field name="layoutId">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="layoutId">Layout</Label>
                <Select
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  disabled={layouts != null && layouts.length <= 1}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a layout" />
                  </SelectTrigger>
                  <SelectContent>
                    {layouts?.map((t) => (
                      <SelectItem key={t._id} value={t._id}>
                        {camoxApp.getLayoutById(t.layoutId)?.title ?? t.layoutId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <form.Field name="contentDescription">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="contentDescription">Content description</Label>
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
          <Button type="submit" disabled={form.state.isSubmitting}>
            {form.state.isSubmitting && <Spinner />}
            Create page
            {form.state.isSubmitting && "..."}
          </Button>
        </form>
      </Sheet.SheetContent>
    </Sheet.Sheet>
  );
};

export { CreatePageSheet };
