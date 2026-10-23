import { socialProfileUrlSchema } from "@camox/api-contract/projects";
import { Button } from "@camox/ui/button";
import { Input } from "@camox/ui/input";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { useMutation } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { type Project, projectMutations } from "@/lib/queries";

import { reads, useStudioCache } from "../../lib/studio-reads";
import { SettingsPart } from "./SettingsPart";

/** A profile being edited, keyed so its input keeps focus as rows move. */
type Row = { key: number; url: string };

let nextRowKey = 0;
const row = (url: string): Row => ({ key: nextRowKey++, url });

export function SocialProfilesSettings({ project }: { project: Project }) {
  const studioCache = useStudioCache();
  const [rows, setRows] = React.useState<Row[]>(() => project.socialProfiles.map(row));
  const [showErrors, setShowErrors] = React.useState(false);

  // Empty rows are dropped rather than refused, so adding one by mistake never blocks saving.
  const filled = rows.map((entry) => ({ ...entry, url: entry.url.trim() })).filter((e) => e.url);

  const save = useMutation({
    ...projectMutations.updateSocialProfiles(),
    onSuccess: async () => {
      await studioCache.invalidate(reads.project({ projectUuid: project.uuid }));
      setRows(filled);
      setShowErrors(false);
      toast.success("Social profiles updated");
    },
    onError: (error) => {
      toast.error(error.message || "Could not save the social profiles");
    },
  });

  const errorOf = (url: string) => {
    const result = socialProfileUrlSchema.safeParse(url.trim());
    return result.success ? undefined : result.error.issues[0]?.message;
  };

  const update = (key: number, url: string) =>
    setRows((current) => current.map((entry) => (entry.key === key ? { ...entry, url } : entry)));
  const remove = (key: number) =>
    setRows((current) => current.filter((entry) => entry.key !== key));
  const move = (index: number, by: -1 | 1) =>
    setRows((current) => {
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(index + by, 0, moved!);
      return next;
    });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (filled.some((entry) => errorOf(entry.url))) {
      setShowErrors(true);
      return;
    }
    save.mutate({ id: project.id, socialProfiles: filled.map((entry) => entry.url) });
  };

  return (
    <SettingsPart
      title="Social profiles"
      description="The project's accounts elsewhere, such as on LinkedIn, X or GitHub. Search engines and AI answer engines use them to tie the website to your organization."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        {rows.length > 0 && (
          <ol className="flex flex-col gap-2">
            {rows.map((entry, index) => {
              const error = showErrors && entry.url.trim() ? errorOf(entry.url) : undefined;
              return (
                <li key={entry.key} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Input
                      type="url"
                      value={entry.url}
                      placeholder="https://www.linkedin.com/company/…"
                      aria-label={`Profile ${index + 1}`}
                      aria-invalid={error ? true : undefined}
                      disabled={save.isPending}
                      onChange={(event) => update(entry.key, event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move up"
                      disabled={index === 0 || save.isPending}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Move down"
                      disabled={index === rows.length - 1 || save.isPending}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="Remove"
                      disabled={save.isPending}
                      onClick={() => remove(entry.key)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {error && <p className="text-destructive text-xs">{error}</p>}
                </li>
              );
            })}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />}
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => setRows((current) => [...current, row("")])}
          >
            <Plus />
            Add profile
          </Button>
        </div>
      </form>
    </SettingsPart>
  );
}
