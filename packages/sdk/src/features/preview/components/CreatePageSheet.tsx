/* -------------------------------------------------------------------------------------------------
 * CreatePageSheet
 * -----------------------------------------------------------------------------------------------*/

import { Label } from "@/components/ui/label";
import * as Sheet from "@/components/ui/sheet";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { api } from "camox/_generated/api";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Id } from "camox/_generated/dataModel";
import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { PageLocationFieldset } from "./PageLocationFieldset";

const CreatePageSheet = () => {
  const open = useSelector(
    previewStore,
    (state) => state.context.isCreatePageSheetOpen,
  );
  const pages = useQuery(api.pages.listPages);
  const project = useQuery(api.projects.getFirstProject);
  const templates = useQuery(
    api.templates.listTemplates,
    project ? { projectId: project._id } : "skip",
  );
  const camoxApp = useCamoxApp();
  const createPage = useAction(api.pageActions.createPage);
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      parentPageId: undefined as Id<"pages"> | undefined,
      pathSegment: "",
      templateId: "" as string,
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
          templateId: (values.value.templateId || undefined) as
            | Id<"templates">
            | undefined,
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

  return (
    <Sheet.Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) previewStore.send({ type: "closeCreatePageSheet" });
      }}
    >
      <Sheet.SheetContent className="min-w-[500px]">
        <Sheet.SheetHeader className="border-b border-border">
          <Sheet.SheetTitle>Create page</Sheet.SheetTitle>
          <Sheet.SheetDescription>
            Fill in the details to create a new page. It will be created as a
            draft.
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
          {templates && templates.length > 0 && (
            <form.Field name="templateId">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="templateId">Template</Label>
                  <Select
                    value={field.state.value}
                    onValueChange={field.handleChange}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t) => (
                        <SelectItem key={t._id} value={t._id}>
                          {camoxApp.getTemplateById(t.templateId)?.title ??
                            t.templateId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </form.Field>
          )}
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
