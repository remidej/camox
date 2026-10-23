import {
  ga4MeasurementIdSchema,
  type PosthogRegion,
  posthogProjectApiKeySchema,
  posthogRegionSchema,
} from "@camox/api-contract/analytics";
import { Alert, AlertDescription } from "@camox/ui/alert";
import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Separator } from "@camox/ui/separator";
import { Spinner } from "@camox/ui/spinner";
import { useForm, useStore } from "@tanstack/react-form";
import { Info, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import type { Project } from "@/lib/queries";

import { SettingsPart } from "./SettingsPart";
import { useProjectMutation } from "./useProjectMutation";

type Analytics = Project["analytics"];
type Provider = keyof Analytics;

/** What a provider's form needs: the provider's saved settings, if any. */
interface ProviderFormProps<P extends Provider> {
  project: Project;
  saved: NonNullable<Analytics[P]> | undefined;
  /** Leaves the form, once cancelled or once the provider is removed. */
  onClose: () => void;
}

/** Saves a provider's settings, or removes the provider when given null. */
function useSaveProvider<P extends Provider>(
  provider: P,
  /** The provider's name, as the toasts say it. */
  name: string,
  { project, onClose }: Pick<ProviderFormProps<P>, "project" | "onClose">,
) {
  const mutation = useProjectMutation(project, "updateAnalytics", {
    success: (input) => (input[provider] === null ? `${name} removed` : `${name} saved`),
    failure: `Could not save ${name}`,
    onSuccess: (input) => {
      if (input[provider] === null) onClose();
    },
  });
  const input = (settings: Analytics[P]) => ({ id: project.id, [provider]: settings });
  return {
    isPending: mutation.isPending,
    mutate: (settings: Analytics[P]) => mutation.mutate(input(settings)),
    mutateAsync: (settings: Analytics[P]) => mutation.mutateAsync(input(settings)),
  };
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
  children: React.ReactNode;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onSubmit();
      }}
      className="flex flex-col gap-4"
    >
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty || submitting || save.isPending}>
          {submitting && <Spinner />}
          Save
        </Button>
        {saved ? (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto"
            disabled={save.isPending}
            onClick={() => save.mutate(null)}
          >
            <Trash2 />
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
    state: { value: string; meta: { errors: readonly React.ReactNode[] } };
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
        onChange={(event) => field.handleChange(event.target.value)}
        aria-invalid={field.state.meta.errors.length ? true : undefined}
      />
      {field.state.meta.errors.length > 0 && (
        <p className="text-destructive text-xs">{field.state.meta.errors[0]}</p>
      )}
    </>
  );
}

function Ga4Form(props: ProviderFormProps<"ga4">) {
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
          <div className="flex flex-col gap-2">
            <Label htmlFor="camox-ga4-measurement-id">Google Analytics 4 measurement ID</Label>
            <p className="text-muted-foreground text-sm">
              In Google Analytics, go to Admin, then Data streams, and open your website's stream.
              The measurement ID is at the top right, starting with G-.
            </p>
            <IdInput id="camox-ga4-measurement-id" placeholder="G-XXXXXXXXXX" field={field} />
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

function PosthogForm(props: ProviderFormProps<"posthog">) {
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
            <div className="flex min-w-64 flex-1 flex-col gap-2">
              <Label htmlFor="camox-posthog-project-api-key">PostHog project API key</Label>
              <IdInput
                id="camox-posthog-project-api-key"
                placeholder="phc_XXXXXXXXXX"
                field={field}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="region">
          {(field) => (
            <div className="flex flex-col gap-2">
              <Label htmlFor="camox-posthog-region">Region</Label>
              <Select
                value={field.state.value}
                onValueChange={(value) => {
                  if (value != null) field.handleChange(value);
                }}
                items={POSTHOG_REGIONS}
              >
                <SelectTrigger id="camox-posthog-region">
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

/** Each provider the Analytics part offers, in the order it lists them. */
const PROVIDERS: {
  [P in Provider]: {
    addLabel: string;
    Form: (props: ProviderFormProps<P>) => React.ReactNode;
  };
} = {
  ga4: { addLabel: "Add Google Analytics 4", Form: Ga4Form },
  posthog: { addLabel: "Add PostHog", Form: PosthogForm },
};

function ProviderSettings<P extends Provider>({
  provider,
  ...props
}: ProviderFormProps<P> & { provider: P }) {
  const { Form } = PROVIDERS[provider];
  return <Form {...props} />;
}

export function AnalyticsSettings({ project }: { project: Project }) {
  const { analytics } = project;
  const [adding, setAdding] = React.useState<Provider[]>([]);
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
          <Plus />
          {PROVIDERS[provider].addLabel}
        </Button>
      ))}
    </div>
  );

  return (
    <SettingsPart
      title="Analytics"
      description="Count your website's visitors with the analytics tools you already use."
    >
      <div className="flex flex-col gap-4">
        {shown.map((provider, index) => {
          const saved = analytics[provider] ?? undefined;
          return (
            <React.Fragment key={provider}>
              {index > 0 && <Separator />}
              <ProviderSettings
                // Saved settings start the form afresh.
                key={saved ? JSON.stringify(saved) : "new"}
                provider={provider}
                project={project}
                saved={saved}
                onClose={() => setAdding((current) => current.filter((p) => p !== provider))}
              />
            </React.Fragment>
          );
        })}
        {shown.length === 0 ? (
          <div className="flex flex-col gap-3 rounded-lg border border-dashed p-6 text-center">
            <p className="text-muted-foreground text-sm">
              No analytics yet. Add a provider to count your website's visitors.
            </p>
            {addButtons}
          </div>
        ) : (
          addable.length > 0 && <div className="flex">{addButtons}</div>
        )}
        <Alert>
          <Info />
          <AlertDescription>
            Your team's visits aren't counted. To check it works, open the website in a private
            window.
          </AlertDescription>
        </Alert>
      </div>
    </SettingsPart>
  );
}
