import { ga4MeasurementIdSchema } from "@camox/api-contract/analytics";
import { Alert, AlertDescription } from "@camox/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@camox/ui/alert-dialog";
import { Button } from "@camox/ui/button";
import { FaviconDropZone, validateFaviconFile } from "@camox/ui/favicon-drop-zone";
import { Input } from "@camox/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@camox/ui/input-group";
import { Label } from "@camox/ui/label";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CopyIcon, EyeIcon, EyeOffIcon, InfoIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  api,
  deleteFavicon,
  FAVICON_PLACEHOLDER_URL,
  getFaviconUrl,
  type Project,
  type ProjectAnalytics,
  uploadFavicon,
} from "@/lib/api";
import { projectQueries } from "@/lib/queries";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-8">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

export const Route = createFileRoute("/_app/_dashboard/$orgSlug/$projectSlug/overview")({
  component: ProjectSettingsPage,
  head: () => ({
    meta: [{ title: "Camox Dashboard" }],
  }),
});

function ProjectSettingsFormInner({ project }: { project: Project }) {
  const form = useForm({
    defaultValues: {
      name: project.name,
    },
    onSubmit: async ({ value }) => {
      try {
        await api.projects.update({
          id: project.id,
          name: value.name,
        });
        toast.success("Project settings updated");
      } catch (error) {
        console.error("Failed to update project:", error);
        toast.error("Could not update project settings");
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field
        name="name"
        validators={{
          onSubmit: ({ value }) => {
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
              <p className="text-destructive text-xs">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting, state.canSubmit]}>
        {([isDirty, isSubmitting, canSubmit]) => (
          <Button type="submit" disabled={!isDirty || isSubmitting || !canSubmit}>
            {isSubmitting && <Spinner />}
            Save changes
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}

type PendingFaviconChange = { type: "upload"; file: File } | { type: "remove" } | null;

function FaviconSection({ project }: { project: Project }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingFaviconChange>(null);
  const [hasCurrent, setHasCurrent] = useState(false);
  const currentUrl = getFaviconUrl(project);

  // The favicon URL 404s when none was uploaded, which tells us whether there is one to show
  // and remove. Re-probes after each save, since saving bumps `updatedAt`.
  useEffect(() => {
    const probe = new Image();
    probe.onload = () => setHasCurrent(true);
    probe.onerror = () => setHasCurrent(false);
    probe.src = currentUrl;
    return () => {
      probe.onload = null;
      probe.onerror = null;
    };
  }, [currentUrl]);

  const pendingFile = pending?.type === "upload" ? pending.file : null;
  const pendingUrl = useMemo(
    () => (pendingFile ? URL.createObjectURL(pendingFile) : null),
    [pendingFile],
  );
  useEffect(() => {
    if (!pendingUrl) return;
    return () => URL.revokeObjectURL(pendingUrl);
  }, [pendingUrl]);

  const save = useMutation({
    mutationFn: async (change: NonNullable<PendingFaviconChange>) => {
      if (change.type === "upload") {
        await uploadFavicon(project.id, change.file);
        return;
      }
      await deleteFavicon(project.id);
    },
    onSuccess: async (_, change) => {
      await queryClient.invalidateQueries({ queryKey: projectQueries.all() });
      setPending(null);
      toast.success(change.type === "remove" ? "Favicon removed" : "Favicon updated");
    },
    onError: (error) => {
      console.error("Failed to save favicon:", error);
      toast.error(error instanceof Error ? error.message : "Could not save the favicon");
    },
  });

  const choose = (file: File) => {
    const error = validateFaviconFile(file);
    if (error) {
      toast.error(error);
      return;
    }
    setPending({ type: "upload", file });
  };

  const showsFavicon = pending ? pending.type === "upload" : hasCurrent;
  const previewUrl = pendingUrl ?? (showsFavicon ? currentUrl : FAVICON_PLACEHOLDER_URL);
  const prompt = pendingFile
    ? pendingFile.name
    : showsFavicon
      ? "Drop a new favicon, or click to browse"
      : "Drop your favicon here, or click to browse";

  return (
    <div className="space-y-4">
      <FaviconDropZone
        previewUrl={previewUrl}
        prompt={prompt}
        disabled={save.isPending}
        onFileSelected={choose}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          disabled={!pending || save.isPending}
          onClick={() => pending && save.mutate(pending)}
        >
          {save.isPending && <Spinner />}
          Save changes
        </Button>
        {pending && (
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={() => setPending(null)}
          >
            Cancel
          </Button>
        )}
        {showsFavicon && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto"
            disabled={save.isPending}
            onClick={() => setPending(hasCurrent ? { type: "remove" } : null)}
          >
            <Trash2Icon />
            Remove favicon
          </Button>
        )}
      </div>
    </div>
  );
}

function Ga4Row({
  projectId,
  measurementId,
  onClose,
}: {
  projectId: number;
  /** The saved measurement ID, if any. */
  measurementId: string | undefined;
  /** Leaves the form, once cancelled or once Google Analytics is removed. */
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: string | null) =>
      api.projects.updateAnalytics({
        id: projectId,
        ga4: next === null ? null : { measurementId: next },
      }),
    onSuccess: async (_, next) => {
      await queryClient.invalidateQueries({ queryKey: projectQueries.all() });
      if (next === null) onClose();
      toast.success(next === null ? "Google Analytics removed" : "Google Analytics saved");
    },
    onError: (error) => {
      console.error("Failed to save Google Analytics:", error);
      toast.error("Could not save Google Analytics");
    },
  });
  const form = useForm({
    defaultValues: { measurementId: measurementId ?? "" },
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value.measurementId.trim().toUpperCase()).catch(() => undefined);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      <form.Field
        name="measurementId"
        validators={{
          onSubmit: ({ value }) =>
            ga4MeasurementIdSchema.safeParse(value.trim().toUpperCase()).success
              ? undefined
              : "Enter a measurement ID that starts with G-, like G-A1B2C3D4E5",
        }}
      >
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor="ga4-measurement-id">Google Analytics 4 measurement ID</Label>
            <p className="text-muted-foreground text-sm">
              In Google Analytics, go to Admin, then Data streams, and open your website's stream.
              The measurement ID is at the top right, starting with G-.
            </p>
            <Input
              id="ga4-measurement-id"
              className="font-mono"
              placeholder="G-XXXXXXXXXX"
              autoComplete="off"
              spellCheck={false}
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              aria-invalid={!!field.state.meta.errors.length}
            />
            {field.state.meta.errors.length > 0 && (
              <p className="text-destructive text-xs">{field.state.meta.errors[0]}</p>
            )}
          </div>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting]}>
        {([isDirty, isSubmitting]) => (
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!isDirty || isSubmitting || save.isPending}>
              {isSubmitting && <Spinner />}
              Save changes
            </Button>
            {!measurementId && (
              <Button type="button" variant="outline" disabled={isSubmitting} onClick={onClose}>
                Cancel
              </Button>
            )}
            {measurementId && (
              <Button
                type="button"
                variant="ghost"
                className="ml-auto"
                disabled={save.isPending}
                onClick={() => save.mutate(null)}
              >
                <Trash2Icon />
                Remove Google Analytics
              </Button>
            )}
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function AnalyticsSection({
  projectId,
  analytics,
}: {
  projectId: number;
  analytics: ProjectAnalytics;
}) {
  const [addingGa4, setAddingGa4] = useState(false);
  const ga4 = analytics.ga4;

  return (
    <div className="space-y-4">
      {ga4 || addingGa4 ? (
        <Ga4Row
          // A saved ID starts the form afresh.
          key={ga4?.measurementId ?? "new"}
          projectId={projectId}
          measurementId={ga4?.measurementId}
          onClose={() => setAddingGa4(false)}
        />
      ) : (
        <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-sm">
            No analytics yet. Add a provider to count your website's visitors.
          </p>
          <Button type="button" variant="outline" onClick={() => setAddingGa4(true)}>
            <PlusIcon />
            Add Google Analytics 4
          </Button>
        </div>
      )}
      <Alert>
        <InfoIcon />
        <AlertDescription>
          Your team's visits aren't counted. To check it works, open the site in a private window.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function ProjectCredentialsSection({ slug, deployToken }: { slug: string; deployToken: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="project-slug">Project slug</Label>
        <InputGroup>
          <InputGroupInput id="project-slug" readOnly value={slug} className="font-mono" />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    size="icon-xs"
                    onClick={() => {
                      void navigator.clipboard.writeText(slug);
                      toast.success("Slug copied to clipboard");
                    }}
                  />
                }
              >
                <CopyIcon className="size-4" />
              </TooltipTrigger>
              <TooltipContent>Copy slug</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <div className="space-y-2">
        <Label htmlFor="deploy-token">Deploy token</Label>
        <p className="text-muted-foreground text-sm">
          Store this as <code>CAMOX_DEPLOY_TOKEN</code> in your CI environment.
        </p>
        <InputGroup>
          <InputGroupInput
            id="deploy-token"
            readOnly
            value={revealed ? deployToken : "*".repeat(deployToken.length)}
            className="font-mono"
          />
          <InputGroupAddon align="inline-end">
            <Tooltip>
              <TooltipTrigger
                render={<InputGroupButton size="icon-xs" onClick={() => setRevealed((v) => !v)} />}
              >
                {revealed ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </TooltipTrigger>
              <TooltipContent>{revealed ? "Hide secret" : "Reveal secret"}</TooltipContent>
            </Tooltip>
          </InputGroupAddon>
        </InputGroup>
      </div>
      <Button
        type="button"
        variant="secondary"
        className="-mt-2"
        onClick={async () => {
          await navigator.clipboard.writeText(deployToken);
          toast.success("Deploy token copied to clipboard");
        }}
      >
        <CopyIcon className="size-4" />
        Copy deploy token
      </Button>
    </div>
  );
}

function DeleteProjectSection({ project }: { project: Project }) {
  const [confirmValue, setConfirmValue] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { orgSlug } = Route.useParams();

  const deleteProject = useMutation({
    mutationFn: () => api.projects.delete({ id: project.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries(projectQueries.list(project.organizationId));
      toast.success("Project deleted");
      void navigate({ to: "/$orgSlug", params: { orgSlug } });
    },
    onError: (error) => {
      console.error("Failed to delete project:", error);
      toast.error("Could not delete project");
    },
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) setConfirmValue("");
      }}
    >
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        Delete project
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete project</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the project <strong>{project.name}</strong> and all of its
            data including drafts, pages, blocks, and files. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="confirm-slug">
            Type <span className="font-mono font-semibold">{project.slug}</span> to confirm
          </Label>
          <Input
            id="confirm-slug"
            value={confirmValue}
            onChange={(e) => setConfirmValue(e.target.value)}
            placeholder={project.slug}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" size="default">
            Cancel
          </AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={confirmValue !== project.slug || deleteProject.isPending}
            onClick={() => deleteProject.mutate()}
          >
            {deleteProject.isPending && <Spinner />}
            Delete project
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ProjectSettingsPage() {
  const { projectSlug } = Route.useParams();

  const { data: project } = useSuspenseQuery(projectQueries.getBySlug(projectSlug));

  if (!project) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-12">
      <Section title="Project settings" description="Manage your project's general configuration.">
        <ProjectSettingsFormInner key={project.id} project={project} />
      </Section>
      <Section
        title="Favicon"
        description="The icon shown in browser tabs for this project's pages."
      >
        <FaviconSection project={project} />
      </Section>
      <Section
        title="Analytics"
        description="Count your website's visitors with the analytics tools you already use."
      >
        <AnalyticsSection projectId={project.id} analytics={project.analytics} />
      </Section>
      <Section
        title="Project credentials"
        description="The token used by CI to prepare production releases."
      >
        <ProjectCredentialsSection slug={project.slug} deployToken={project.deployToken} />
      </Section>
      <Section title="Danger zone" description="Irreversible and destructive actions.">
        <DeleteProjectSection project={project} />
      </Section>
    </div>
  );
}
