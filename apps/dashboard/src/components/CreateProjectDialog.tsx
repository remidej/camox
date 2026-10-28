import { projectSlugSchema, UNAVAILABLE_SLUG_MESSAGES } from "@camox/api-contract/projects";
import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Input } from "@camox/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@camox/ui/input-group";
import { Label } from "@camox/ui/label";
import { Spinner } from "@camox/ui/spinner";
import { useForm, useStore } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import slugify from "slugify";

import { api } from "@/lib/api";
import { projectQueries } from "@/lib/queries";

const SLUG_CHECK_DELAY_MS = 300;

/** `value`, once it has stopped changing for `delay` milliseconds. */
function useDebouncedValue<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

/**
 * Why `slug` can't be used, as the member is told it, or nothing while it's free or still being
 * checked. The format is checked here, then reserved and taken slugs by the API.
 */
function useSlugProblem(slug: string) {
  const debounced = useDebouncedValue(slug, SLUG_CHECK_DELAY_MS);
  const wellFormed = projectSlugSchema.safeParse(debounced).success;
  const availability = useQuery({
    queryKey: [...projectQueries.all(), "slugAvailability", debounced] as const,
    queryFn: () => api.projects.checkSlugAvailability({ slug: debounced }),
    enabled: wellFormed,
  });

  const settled = slug === debounced;
  if (!slug) return { problem: null, checking: false };
  if (!settled) return { problem: null, checking: true };
  if (!wellFormed) return { problem: UNAVAILABLE_SLUG_MESSAGES.invalid, checking: false };
  if (!availability.data) return { problem: null, checking: availability.isFetching };
  const { available, reason } = availability.data;
  return {
    problem: available ? null : UNAVAILABLE_SLUG_MESSAGES[reason ?? "taken"],
    checking: false,
  };
}

/**
 * The dialog a member creates a project in: its name and slug, which is its address. Once the
 * project is created, the dialog closes and the organization's project list refreshes, where the
 * new project's card follows its setup.
 */
export function CreateProjectDialog({
  organizationId,
  open,
  onOpenChange,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        await api.projects.create({
          name: value.name.trim(),
          slug: value.slug,
          organizationId,
        });
        await queryClient.invalidateQueries({ queryKey: projectQueries.all() });
        onOpenChange(false);
        form.reset();
      } catch (error) {
        setSubmitError(error instanceof Error ? error.message : "Could not create the project.");
      }
    },
  });

  const slug = useStore(form.store, (state) => state.values.slug);
  const { problem, checking } = useSlugProblem(slug);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          form.reset();
          setSubmitError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Camox sets up your website from its Template. It's live a few minutes later.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="grid gap-4 py-2"
        >
          <form.Field
            name="name"
            validators={{
              onSubmit: ({ value }) => (value.trim() ? undefined : "Name is required"),
            }}
          >
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="project-name">Name</Label>
                <Input
                  id="project-name"
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    if (!form.getFieldMeta("slug")?.isDirty) {
                      form.setFieldValue(
                        "slug",
                        slugify(e.target.value, { lower: true, strict: true }),
                        { dontUpdateMeta: true },
                      );
                    }
                  }}
                  placeholder="My Website"
                  aria-invalid={!!field.state.meta.errors.length}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-xs">{field.state.meta.errors[0]}</p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field name="slug">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="project-slug">Slug</Label>
                <InputGroup>
                  <InputGroupInput
                    id="project-slug"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="my-website"
                    className="font-mono"
                    aria-invalid={!!problem}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText className="font-mono">.camox.site</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                {problem && <p className="text-destructive text-xs">{problem}</p>}
              </div>
            )}
          </form.Field>

          {submitError && <p className="text-destructive text-sm">{submitError}</p>}

          <DialogFooter>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting || checking || !!problem || !slug}>
                  {isSubmitting && <Spinner />}
                  Create project
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
