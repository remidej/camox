import {
  ga4MeasurementIdSchema,
  type PosthogRegion,
  posthogProjectApiKeySchema,
  posthogRegionSchema,
} from "@camox/api-contract/analytics";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Separator } from "@camox/ui/separator";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useForm, useStore } from "@tanstack/react-form";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CopyIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useMemo, useState } from "react";

import { ProjectSetup, siteUrl } from "@/components/ProjectSetup";
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

type Provider = keyof ProjectAnalytics;

/** What a provider's row needs: the provider's saved settings, if any. */
interface ProviderRowProps<P extends Provider> {
  projectId: number;
  saved: NonNullable<ProjectAnalytics[P]> | undefined;
  /** Leaves the form, once cancelled or once the provider is removed. */
  onClose: () => void;
}

/** Saves a provider's settings, or removes the provider when given null. */
function useSaveProvider<P extends Provider>(
  provider: P,
  /** The provider's name, as the toasts say it. */
  name: string,
  { projectId, onClose }: Pick<ProviderRowProps<P>, "projectId" | "onClose">,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: ProjectAnalytics[P]) =>
      api.projects.updateAnalytics({ id: projectId, [provider]: settings } as Parameters<
        typeof api.projects.updateAnalytics
      >[0]),
    onSuccess: async (_, settings) => {
      await queryClient.invalidateQueries({ queryKey: projectQueries.all() });
      if (settings === null) onClose();
      toast.success(settings === null ? `${name} removed` : `${name} saved`);
    },
    onError: (error) => {
      console.error(`Failed to save ${name}:`, error);
      toast.error(`Could not save ${name}`);
    },
  });
}

/**
 * A provider's form: its fields, then Save, and either Cancel while adding it or Remove once it's
 * saved.
 */
function ProviderForm({
  name,
  saved,
  dirty,
  submitting,
  save,
  onSubmit,
  onCancel,
  children,
}: {
  /** The provider's name, as the Remove button says it. */
  name: string;
  saved: boolean;
  dirty: boolean;
  submitting: boolean;
  save: { isPending: boolean; mutate: (settings: null) => void };
  onSubmit: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSubmit();
      }}
      className="space-y-4"
    >
      {children}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!dirty || submitting || save.isPending}>
          {submitting && <Spinner />}
          Save changes
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            <Trash2Icon />
            Remove {name}
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** A monospace text input for an ID or key, with its validation error. */
function IdInput({
  id,
  placeholder,
  field,
}: {
  id: string;
  placeholder: string;
  field: {
    state: { value: string; meta: { errors: readonly ReactNode[] } };
    handleChange: (value: string) => void;
  };
}) {
  return (
    <>
      <Input
        id={id}
        className="font-mono"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        value={field.state.value}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={!!field.state.meta.errors.length}
      />
      {field.state.meta.errors.length > 0 && (
        <p className="text-destructive text-xs">{field.state.meta.errors[0]}</p>
      )}
    </>
  );
}

function Ga4Row(props: ProviderRowProps<"ga4">) {
  const { saved, onClose } = props;
  const save = useSaveProvider("ga4", "Google Analytics", props);
  const form = useForm({
    defaultValues: { measurementId: saved?.measurementId ?? "" },
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({ measurementId: value.measurementId.trim().toUpperCase() })
        .catch(() => undefined);
    },
  });
  const dirty = useStore(form.store, (state) => state.isDirty);
  const submitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <ProviderForm
      name="Google Analytics"
      saved={!!saved}
      dirty={dirty}
      submitting={submitting}
      save={save}
      onSubmit={() => void form.handleSubmit()}
      onCancel={onClose}
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
            <IdInput id="ga4-measurement-id" placeholder="G-XXXXXXXXXX" field={field} />
          </div>
        )}
      </form.Field>
    </ProviderForm>
  );
}

const POSTHOG_REGION_LABELS: Record<PosthogRegion, string> = {
  us: "US Cloud",
  eu: "EU Cloud",
};

const POSTHOG_REGIONS = posthogRegionSchema.options.map((value) => ({
  value,
  label: POSTHOG_REGION_LABELS[value],
}));

function PosthogRow(props: ProviderRowProps<"posthog">) {
  const { saved, onClose } = props;
  const save = useSaveProvider("posthog", "PostHog", props);
  const form = useForm({
    defaultValues: {
      projectApiKey: saved?.projectApiKey ?? "",
      region: saved?.region ?? ("us" as PosthogRegion),
    },
    onSubmit: async ({ value }) => {
      await save
        .mutateAsync({ projectApiKey: value.projectApiKey.trim(), region: value.region })
        .catch(() => undefined);
    },
  });
  const dirty = useStore(form.store, (state) => state.isDirty);
  const submitting = useStore(form.store, (state) => state.isSubmitting);

  return (
    <ProviderForm
      name="PostHog"
      saved={!!saved}
      dirty={dirty}
      submitting={submitting}
      save={save}
      onSubmit={() => void form.handleSubmit()}
      onCancel={onClose}
    >
      <p className="text-muted-foreground text-sm">
        In PostHog, go to Project settings. The project API key starts with phc_, and the region is
        the cloud your project is hosted in, shown in your PostHog address (us.posthog.com or
        eu.posthog.com).
      </p>
      <div className="flex flex-wrap items-start gap-4">
        <form.Field
          name="projectApiKey"
          validators={{
            onSubmit: ({ value }) =>
              posthogProjectApiKeySchema.safeParse(value.trim()).success
                ? undefined
                : "Enter a project API key that starts with phc_",
          }}
        >
          {(field) => (
            <div className="min-w-64 flex-1 space-y-2">
              <Label htmlFor="posthog-project-api-key">PostHog project API key</Label>
              <IdInput id="posthog-project-api-key" placeholder="phc_XXXXXXXXXX" field={field} />
            </div>
          )}
        </form.Field>
        <form.Field name="region">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor="posthog-region">Region</Label>
              <Select
                value={field.state.value}
                onValueChange={(value) => {
                  if (value != null) field.handleChange(value);
                }}
                items={POSTHOG_REGIONS}
              >
                <SelectTrigger id="posthog-region">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSTHOG_REGIONS.map((region) => (
                    <SelectItem key={region.value} value={region.value}>
                      {region.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
      </div>
    </ProviderForm>
  );
}

/** Each provider the Analytics section offers, in the order it lists them. */
const PROVIDERS: {
  [P in Provider]: { addLabel: string; Row: (props: ProviderRowProps<P>) => ReactNode };
} = {
  ga4: { addLabel: "Add Google Analytics 4", Row: Ga4Row },
  posthog: { addLabel: "Add PostHog", Row: PosthogRow },
};

function ProviderRow<P extends Provider>({
  provider,
  ...props
}: ProviderRowProps<P> & { provider: P }) {
  const { Row } = PROVIDERS[provider];
  return <Row {...props} />;
}

function AnalyticsSection({
  projectId,
  analytics,
}: {
  projectId: number;
  analytics: ProjectAnalytics;
}) {
  const [adding, setAdding] = useState<Provider[]>([]);
  const providers = Object.keys(PROVIDERS) as Provider[];
  const shown = providers.filter((provider) => analytics[provider] || adding.includes(provider));
  const addable = providers.filter((provider) => !shown.includes(provider));

  const addButtons = (
    <div className="flex flex-wrap justify-center gap-2">
      {addable.map((provider) => (
        <Button
          key={provider}
          type="button"
          variant="outline"
          onClick={() => setAdding((current) => [...current, provider])}
        >
          <PlusIcon />
          {PROVIDERS[provider].addLabel}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      {shown.map((provider, index) => {
        const saved = analytics[provider] ?? undefined;
        return (
          <Fragment key={provider}>
            {index > 0 && <Separator />}
            <ProviderRow
              // Saved settings start the form afresh.
              key={saved ? JSON.stringify(saved) : "new"}
              provider={provider}
              projectId={projectId}
              saved={saved}
              onClose={() => setAdding((current) => current.filter((p) => p !== provider))}
            />
          </Fragment>
        );
      })}
      {shown.length === 0 ? (
        <div className="space-y-3 rounded-lg border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-sm">
            No analytics yet. Add a provider to count your website's visitors.
          </p>
          {addButtons}
        </div>
      ) : (
        addable.length > 0 && <div className="flex">{addButtons}</div>
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

/** A read-only monospace value with a button to copy it. */
function CopyableValue({ id, value, label }: { id: string; value: string; label: string }) {
  return (
    <InputGroup>
      <InputGroupInput id={id} readOnly value={value} className="font-mono" />
      <InputGroupAddon align="inline-end">
        <Tooltip>
          <TooltipTrigger
            render={
              <InputGroupButton
                size="icon-xs"
                onClick={() => {
                  void navigator.clipboard.writeText(value);
                  toast.success(`${label} copied to clipboard`);
                }}
              />
            }
          >
            <CopyIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Copy {label}</TooltipContent>
        </Tooltip>
      </InputGroupAddon>
    </InputGroup>
  );
}

function ProjectCredentialsSection({
  projectId,
  slug,
  deployToken,
}: {
  projectId: string;
  slug: string;
  deployToken: string;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="project-id">Project ID</Label>
        <p className="text-muted-foreground text-sm">
          Your website's code names this project by its Project ID. It never changes.
        </p>
        <CopyableValue id="project-id" value={projectId} label="Project ID" />
      </div>
      <div className="space-y-2">
        <Label htmlFor="project-slug">Project slug</Label>
        <CopyableValue id="project-slug" value={slug} label="slug" />
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
      {project.status === "live" ? (
        <Section title="Website" description="Where your website is live.">
          <Button variant="outline" nativeButton={false} render={<a href={siteUrl(project)} />}>
            {project.slug}.camox.site
            <ExternalLinkIcon />
          </Button>
        </Section>
      ) : (
        <Section
          title="Setting up your website"
          description="Camox is copying the Template and publishing your website. It takes a few minutes."
        >
          <ProjectSetup project={project} />
        </Section>
      )}
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
        description="How your website's code names this project, and the token CI uses to prepare production releases."
      >
        <ProjectCredentialsSection
          projectId={project.uuid}
          slug={project.slug}
          deployToken={project.deployToken}
        />
      </Section>
      <Section title="Danger zone" description="Irreversible and destructive actions.">
        <DeleteProjectSection project={project} />
      </Section>
    </div>
  );
}
