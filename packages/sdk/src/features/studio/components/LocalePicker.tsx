import { Combobox } from "@base-ui/react/combobox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Spinner } from "@camox/ui/spinner";
import { toast } from "@camox/ui/toaster";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { ChevronsUpDown, Languages, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { useLocation, useNavigate } from "@/features/navigation/navigation";
import { usePageDestinations } from "@/hooks/use-page-destinations";
import { useProjectUuid } from "@/lib/auth";
import { useCurrentDraftId } from "@/lib/draft-scope";
import { type LocaleView, localizedPath } from "@/lib/locale-path";
import { localeMutations } from "@/lib/queries";
import { reads, useReadQuery, useStudioCache } from "@/lib/studio-reads";
import { useLocalePath } from "@/lib/view-locale";
import { useViewLocale } from "@/lib/view-locale-context";

import type { ShownRecordPage } from "../../preview/pageRecord";
import { type LocaleOption, localeLabel, localeOptions } from "../localeOptions";
import { pathInLocale } from "../localeSwitch";
import { studioStore } from "../studioStore";

/**
 * The studio's languages (GLOSSARY: Locale): the one viewed, the others to switch to, and adding
 * and removing them. Switching keeps the page shown when the other language has it, and goes to
 * that language's home otherwise; the URL names the language by its prefix. Adding and removing
 * languages are content writes, so on Live they start a draft. While Camox translates the draft
 * into its languages, the picker shows a spinner, and nothing else does. A `disabled` picker still
 * names the language viewed.
 */
export function LocalePicker({
  recordPage,
  disabled = false,
}: {
  recordPage?: ShownRecordPage;
  disabled?: boolean;
}) {
  const projectUuid = useProjectUuid();
  const view = useViewLocale();
  const dialog = useSelector(studioStore, (state) => state.context.localeDialog);
  const project = useReadQuery(reads.project({ projectUuid }), {
    enabled: !!projectUuid,
  });
  const projectId = project.data?.id;
  const list = useReadQuery(reads.localeList({ projectId: projectId ?? 0 }), {
    enabled: !!projectId,
  });
  const locales = list.data ?? view.locales;
  // Before the runtime reads the scope's locales, a render names its default locale by none.
  const viewed =
    locales.find((locale) =>
      view.locale.isDefault ? locale.isDefault : locale.tag === view.locale.tag,
    ) ?? view.locale;
  const switchTo = useSwitchLocale(recordPage);
  // Camox translates the draft's default-locale changes into its other locales (ADR 0015).
  const draftId = useCurrentDraftId();
  const draft = useReadQuery(reads.draft({ projectId: projectId ?? 0, draftId: draftId ?? "" }), {
    enabled: !!projectId && !!draftId,
  });
  const translatingLocales = draft.data?.translatingLocales ?? [];

  // The dialogs belong to the locale they were opened in.
  React.useEffect(() => closeLocaleDialog, [viewed.tag]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger disabled={disabled} render={<Button type="button" variant="ghost" />}>
          {translatingLocales.length > 0 ? (
            <TranslatingSpinner tags={translatingLocales} />
          ) : (
            <Languages aria-hidden className="text-muted-foreground size-4" />
          )}
          <span className="max-w-40 truncate">{localeLabel(viewed.tag)}</span>
          <ChevronsUpDown aria-hidden className="size-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="start">
          <DropdownMenuRadioGroup
            value={viewed.tag}
            onValueChange={(tag) => {
              const next = locales.find((locale) => locale.tag === tag);
              if (next) void switchTo(next);
            }}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Languages</DropdownMenuLabel>
              {locales.map((locale) => (
                <DropdownMenuRadioItem key={locale.tag} value={locale.tag} closeOnClick>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate">{localeLabel(locale.tag)}</span>
                    {locale.isDefault && (
                      <span className="text-muted-foreground text-xs">Default language</span>
                    )}
                  </div>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!projectId}
              onClick={() => studioStore.send({ type: "openLocaleDialog", dialog: "add" })}
            >
              <Plus />
              Add language…
            </DropdownMenuItem>
            {!viewed.isDefault && (
              <DropdownMenuItem
                variant="destructive"
                disabled={!projectId}
                onClick={() => studioStore.send({ type: "openLocaleDialog", dialog: "remove" })}
              >
                <Trash2 />
                Remove {localeLabel(viewed.tag)}…
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {projectId && (
        <>
          <AddLocaleDialog
            projectId={projectId}
            locales={locales}
            open={dialog === "add"}
            onAdded={(added) => void switchTo(added)}
          />
          {!viewed.isDefault && (
            <RemoveLocaleDialog
              projectId={projectId}
              locale={viewed}
              open={dialog === "remove"}
              onRemoved={() => {
                const fallback = locales.find((locale) => locale.isDefault);
                if (fallback) void switchTo(fallback);
              }}
            />
          )}
        </>
      )}
    </>
  );
}

/** Stands for the languages icon while Camox translates the draft, naming them on hover. */
function TranslatingSpinner({ tags }: { tags: readonly string[] }) {
  const label = `Translating into ${tags.map(localeLabel).join(", ")}…`;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>
        <Spinner aria-label={label} className="text-muted-foreground size-4" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Switches the studio to another locale, on the same page when that locale has it (ADR 0015:
 * localizations share their original's id) or the same record when it shows a record page, or on
 * its home.
 */
function useSwitchLocale(recordPage: ShownRecordPage | undefined) {
  const navigate = useNavigate();
  const cache = useStudioCache();
  const projectUuid = useProjectUuid();
  const view = useViewLocale();
  const path = useLocalePath();
  const search = useLocation({ select: (location) => location.search });
  const destinations = usePageDestinations();

  return React.useCallback(
    async (target: LocaleView) => {
      if (target.tag === view.locale.tag && target.isDefault === view.locale.isDefault) return;
      // A locale whose pages can't be read leaves nothing to match: the switch goes home.
      const pagesIn = (locale: LocaleView) =>
        cache.ensure(reads.pageList({ projectUuid }), { locale }).catch(() => []);
      // The record's slug may have changed since: its page is found again, not from the cache.
      const recordPath = recordPage
        ? cache
            .reload(reads.discoveredPath({ projectUuid, ...recordPage }), { locale: target })
            .catch(() => null)
        : null;
      const [shown, other] = await Promise.all([pagesIn(view.locale), pagesIn(target)]);
      const next = pathInLocale(path, {
        shown,
        target: other,
        singleton: (candidate) =>
          destinations.some(
            (destination) => destination.kind === "singleton" && destination.fullPath === candidate,
          ),
        recordPath: await recordPath,
      });
      await navigate({ to: `${localizedPath(next, target)}${search}` });
    },
    [cache, destinations, navigate, path, projectUuid, recordPage, search, view.locale],
  );
}

function closeLocaleDialog() {
  studioStore.send({ type: "closeLocaleDialog" });
}

/** Asks which language to add, then adds the locale, which Camox translates the website into. */
function AddLocaleDialog({
  projectId,
  locales,
  open,
  onAdded,
}: {
  projectId: number;
  locales: readonly LocaleView[];
  open: boolean;
  onAdded: (added: LocaleView) => void;
}) {
  const cache = useStudioCache();
  const options = React.useMemo(() => localeOptions(locales), [locales]);
  const [picked, setPicked] = React.useState<LocaleOption | null>(null);
  const add = useMutation({
    ...localeMutations.add(),
    onSuccess: (added) => {
      closeLocaleDialog();
      setPicked(null);
      toast.success(`Added ${localeLabel(added.tag)}`);
      void cache.invalidate(reads.localeList({ projectId }));
      onAdded(added);
    },
    onError: (error) => toast.error(error.message || "Could not add the language"),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !add.isPending) closeLocaleDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (picked) add.mutate({ projectId, tag: picked.tag });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a language</DialogTitle>
            <DialogDescription>
              Camox translates the whole website into the new language in a draft. It goes live when
              the draft is published.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="camox-locale-tag">Language</Label>
            <Combobox.Root
              items={options}
              value={picked}
              onValueChange={setPicked}
              itemToStringLabel={(option: LocaleOption) => option.label}
              itemToStringValue={(option: LocaleOption) => option.tag}
              isItemEqualToValue={(option: LocaleOption, value: LocaleOption) =>
                option.tag === value.tag
              }
              autoHighlight
            >
              <Combobox.Input
                render={<Input id="camox-locale-tag" />}
                placeholder="Search languages…"
                autoFocus
              />
              <Combobox.Portal>
                <Combobox.Positioner sideOffset={4} align="start" className="isolate z-50">
                  <Combobox.Popup className="bg-popover text-popover-foreground ring-foreground/10 flex max-h-(--available-height) w-(--anchor-width) flex-col rounded-md p-1 shadow-md ring-1">
                    <Combobox.Empty className="text-muted-foreground text-sm">
                      <div className="p-2">No languages found.</div>
                    </Combobox.Empty>
                    <Combobox.List className="max-h-64 min-h-0 overflow-y-auto">
                      {(option: LocaleOption) => (
                        <Combobox.Item
                          key={option.tag}
                          value={option}
                          className="data-highlighted:bg-accent data-highlighted:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none"
                        >
                          <span className="min-w-0 flex-1 truncate">{option.label}</span>
                        </Combobox.Item>
                      )}
                    </Combobox.List>
                  </Combobox.Popup>
                </Combobox.Positioner>
              </Combobox.Portal>
            </Combobox.Root>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={add.isPending}
              onClick={closeLocaleDialog}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!picked || add.isPending}>
              {add.isPending ? <Spinner /> : null}
              Add language
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Asks before removing a locale with all its content, then removes it in the draft. */
function RemoveLocaleDialog({
  projectId,
  locale,
  open,
  onRemoved,
}: {
  projectId: number;
  locale: LocaleView;
  open: boolean;
  onRemoved: () => void;
}) {
  const cache = useStudioCache();
  const label = localeLabel(locale.tag);
  const remove = useMutation({
    ...localeMutations.remove(),
    onSuccess: () => {
      closeLocaleDialog();
      toast.success(`Removed ${label}`);
      void cache.invalidate(reads.localeList({ projectId }));
      onRemoved();
    },
    onError: (error) => toast.error(error.message || "Could not remove the language"),
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !remove.isPending) closeLocaleDialog();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its pages and content in {label} are removed in this draft. Once the draft is published,
            its content will be gone for good.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel variant="outline" size="default" disabled={remove.isPending}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate({ projectId, tag: locale.tag })}
          >
            {remove.isPending ? <Spinner /> : null}
            Remove language
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
