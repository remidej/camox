import * as React from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "convex/react";
import { api } from "camox/_generated/api";
import { toast } from "@/components/ui/toaster";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const ProjectSettingsModal = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const project = useQuery(api.projects.getFirstProject);
  const updateProject = useMutation(api.projects.updateProject);

  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
      domain: "",
    },
    onSubmit: async (values) => {
      try {
        if (!project) {
          toast.error("Project not found");
          return;
        }

        await updateProject({
          projectId: project._id,
          name: values.value.name,
          description: values.value.description,
          domain: values.value.domain,
        });

        toast.success("Project settings updated");
        onOpenChange(false);
      } catch (error) {
        console.error("Failed to update project:", error);
        toast.error("Could not update project settings");
      }
    },
  });

  // Reset form when modal opens with current project data
  React.useEffect(() => {
    if (open && project) {
      form.update({
        defaultValues: {
          name: project.name,
          description: project.description,
          domain: project.domain,
        },
      });
    }
  }, [open, project, form]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="min-w-[500px]">
        <SheetHeader className="border-b border-border">
          <SheetTitle>Project settings</SheetTitle>
          <SheetDescription>
            Update your project details. Changes will be saved immediately.
          </SheetDescription>
        </SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-4 py-4 px-4"
        >
          <form.Field
            name="name"
            validators={{
              onChange: ({ value }) => {
                if (!value || value.trim().length === 0) {
                  return "Project name is required";
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="name">Project name</Label>
                <Input
                  id="name"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={!!field.state.meta.errors.length}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-xs">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="description">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  rows={3}
                />
                <p className="text-muted-foreground text-xs">
                  A brief description of your project
                </p>
              </div>
            )}
          </form.Field>

          <form.Field
            name="domain"
            validators={{
              onChange: ({ value }) => {
                if (!value || value.trim().length === 0) {
                  return "Domain is required";
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor="domain">Domain</Label>
                <Input
                  id="domain"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={!!field.state.meta.errors.length}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-xs">
                    {field.state.meta.errors[0]}
                  </p>
                )}
                <p className="text-muted-foreground text-xs">
                  Your project's domain name
                </p>
              </div>
            )}
          </form.Field>

          <Button type="submit" disabled={form.state.isSubmitting}>
            {form.state.isSubmitting && <Spinner />}
            Save changes
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export { ProjectSettingsModal };
