/* -------------------------------------------------------------------------------------------------
 * CreatePageModal
 * -----------------------------------------------------------------------------------------------*/

import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Label } from "@camox/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { useEffect, useMemo } from "react";

import { useNavigate } from "@/features/navigation/navigation";
import { useProjectSlug } from "@/lib/auth";
import { layoutQueries, pageMutations, pageQueries, projectQueries } from "@/lib/queries";
import { trackClientEvent } from "@/lib/telemetry-client";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { previewStore } from "../previewStore";
import { PageLocationFieldset } from "./PageLocationFieldset";
import { PageNicknameField } from "./PageNicknameField";

const slugifyPathSegment = (nickname: string) => {
  const trimmedNickname = nickname.trim();
  if (trimmedNickname.toLowerCase() === "home") return "";

  return trimmedNickname
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const CreatePageModal = () => {
  const projectSlug = useProjectSlug();
  const open = useSelector(previewStore, (state) => state.context.isCreatePageModalOpen);
  const createPage = useMutation(pageMutations.create());
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: pages } = useQuery({
    ...pageQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const { data: allLayouts } = useQuery({
    ...layoutQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const camoxApp = useCamoxApp();
  const layouts = useMemo(
    () =>
      allLayouts?.filter(
        (layout) => camoxApp.getLayoutById(layout.layoutId)?._internal.kind !== "derived",
      ),
    [allLayouts, camoxApp],
  );
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      nickname: "",
      parentPageId: undefined as number | undefined,
      pathSegment: "",
      layoutId: "" as string,
    },
    onSubmit: async (values) => {
      try {
        if (!project) {
          toast.error("Project not found");
          return;
        }

        const nickname = values.value.nickname.trim();
        if (!nickname) {
          toast.error("Page nickname is required");
          return;
        }

        const createPagePromise = createPage.mutateAsync({
          projectId: project.id,
          nickname,
          pathSegment: values.value.pathSegment,
          parentPageId: values.value.parentPageId,
          layoutId: Number(values.value.layoutId),
        });

        toast.promise(createPagePromise, {
          loading: "Creating page...",
          success: "Page created",
          error: "Failed to create page",
        });

        const { fullPath } = await createPagePromise;
        trackClientEvent("page_created", {
          projectId: project.id,
          pathSegment: values.value.pathSegment,
          layoutId: values.value.layoutId,
        });
        previewStore.send({ type: "closeCreatePageModal" });
        form.reset();

        // Small delay to allow database to sync before navigation
        await new Promise((resolve) => setTimeout(resolve, 50));
        await navigate({ to: fullPath });
      } catch (error) {
        console.error("Failed to create page:", error);
        toast.error("Could not create page");
      }
    },
  });

  useEffect(() => {
    if (layouts && layouts.length > 0 && !form.getFieldValue("layoutId")) {
      form.setFieldValue("layoutId", String(layouts[0].id));
    }
  }, [layouts, form]);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) previewStore.send({ type: "closeCreatePageModal" });
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create page</DialogTitle>
          <DialogDescription>
            Fill in the details to create a new page. It will be created as a draft.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="-mx-1 space-y-4 overflow-y-auto px-1 py-2"
        >
          <form.Field name="nickname">
            {(field) => (
              <PageNicknameField
                value={field.state.value}
                onChange={(value) => {
                  field.handleChange(value);

                  if (form.getFieldMeta("pathSegment")?.isDirty) return;
                  form.setFieldValue("pathSegment", slugifyPathSegment(value), {
                    dontUpdateMeta: true,
                  });
                }}
                autoFocus
              />
            )}
          </form.Field>
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
                  onValueChange={(value) => {
                    if (value != null) field.handleChange(value);
                  }}
                  disabled={layouts != null && layouts.length <= 1}
                  items={layouts?.map((t) => ({
                    value: String(t.id),
                    label: camoxApp.getLayoutById(t.layoutId)?._internal.title ?? t.layoutId,
                  }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a layout" />
                  </SelectTrigger>
                  <SelectContent>
                    {layouts?.map((t) => (
                      <SelectItem key={t.id} value={String(t.id)}>
                        {camoxApp.getLayoutById(t.layoutId)?._internal.title ?? t.layoutId}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </form.Field>
          <Button type="submit" disabled={form.state.isSubmitting}>
            {form.state.isSubmitting && <Spinner />}
            Create page
            {form.state.isSubmitting && "..."}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export { CreatePageModal };
