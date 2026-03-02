/* -------------------------------------------------------------------------------------------------
 * CreatePageSheet
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
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { InputBase, InputBaseAdornment } from "@/components/ui/input-base";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatPathSegment } from "@/lib/utils";
import { Id } from "camox/_generated/dataModel";
import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";

const NO_PARENT_VALUE = "__no_parent__";

const CreatePageSheet = () => {
  const open = useSelector(
    previewStore,
    (state) => state.context.isCreatePageSheetOpen,
  );
  const pages = useQuery(api.pages.listPages);
  const project = useQuery(api.projects.getFirstProject);
  const createPage = useAction(api.pageActions.createPage);
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      parentPageId: undefined as Id<"pages"> | undefined,
      pathSegment: "",
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

  const getParentPath = (parentPageId: string | undefined) => {
    if (!pages) return "/";
    if (!parentPageId) return "/";
    const page = pages.find((p) => p._id === parentPageId);
    return page ? page.fullPath + "/" : "/";
  };

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
                        {page.metaTitle ??
                          formatPathSegment(page.pathSegment)}
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
