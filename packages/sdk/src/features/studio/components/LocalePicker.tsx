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
import { useMutation } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { ChevronDownIcon, Languages, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { useLocation, useNavigate } from "@/features/navigation/navigation";
import { usePageDestinations } from "@/hooks/use-page-destinations";
import { useProjectSlug } from "@/lib/auth";
import { type LocaleView, localizedPath } from "@/lib/locale-path";
import { localeMutations } from "@/lib/queries";
import { reads, useReadQuery, useStudioCache } from "@/lib/studio-reads";
import { useLocalePath, useViewLocale } from "@/lib/view-locale";

import type { Action } from "../../provider/actionsStore";
import { actionsStore } from "../../provider/actionsStore";
import { pathInLocale } from "../localeSwitch";
import { studioStore } from "../studioStore";

const SWITCH_TO_LANGUAGE_ID = "switch-to-language";

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

/** A locale's name as the studio shows it, "German (de)", or its tag alone when unnamed. */
export function languageLabel(tag: string): string {
  try {
    const name = languageNames.of(tag);
    return name && name !== tag ? `${name} (${tag})` : tag;
  } catch {
    return tag;
  }
}

/**
 * The studio's languages (GLOSSARY: Locale): the one viewed, the others to switch to, and adding
 * and removing them. Switching keeps the page shown when the other language has it, and goes to
 * that language's home otherwise; the URL names the language by its prefix. Adding and removing
 * languages are content writes, so on Live they start a draft. The command palette offers the
 * same actions.
 */
export function LocalePicker() {
  const projectSlug = useProjectSlug();
  const view = useViewLocale();
  const dialog = useSelector(studioStore, (state) => state.context.languageDialog);
  const project = useReadQuery(reads.project({ slug: projectSlug }), { enabled: !!projectSlug });
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
  const switchTo = useSwitchLocale();

  // The dialogs belong to the language they were opened in.
  React.useEffect(() => closeLanguageDialog, [viewed.tag]);

  useLocaleActions({ enabled: !!projectId, locales, viewed, switchTo });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
          <Languages aria-hidden className="text-muted-foreground size-4" />
          <span className="max-w-40 truncate">{languageLabel(viewed.tag)}</span>
          <ChevronDownIcon aria-hidden className="size-4 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64" align="end">
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
                    <span className="truncate">{languageLabel(locale.tag)}</span>
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
              onClick={() => studioStore.send({ type: "openLanguageDialog", dialog: "add" })}
            >
              <Plus />
              Add language…
            </DropdownMenuItem>
            {!viewed.isDefault && (
              <DropdownMenuItem
                variant="destructive"
                disabled={!projectId}
                onClick={() => studioStore.send({ type: "openLanguageDialog", dialog: "remove" })}
              >
                <Trash2 />
                Remove {languageLabel(viewed.tag)}…
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {projectId && (
        <>
          <AddLanguageDialog
            projectId={projectId}
            open={dialog === "add"}
            onAdded={(added) => void switchTo(added)}
          />
          {!viewed.isDefault && (
            <RemoveLanguageDialog
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

/**
 * Switches the studio to another locale, on the same page when that locale has it (ADR 0015:
 * localizations share their original's id), or on its home.
 */
function useSwitchLocale() {
  const navigate = useNavigate();
  const cache = useStudioCache();
  const projectSlug = useProjectSlug();
  const view = useViewLocale();
  const path = useLocalePath();
  const search = useLocation({ select: (location) => location.search });
  const destinations = usePageDestinations();

  return React.useCallback(
    async (target: LocaleView) => {
      if (target.tag === view.locale.tag && target.isDefault === view.locale.isDefault) return;
      // A locale whose pages can't be read leaves nothing to match: the switch goes home.
      const pagesIn = (locale: LocaleView) =>
        cache.ensure(reads.pageList({ projectSlug }), { locale }).catch(() => []);
      const [shown, other] = await Promise.all([pagesIn(view.locale), pagesIn(target)]);
      const next = pathInLocale(path, {
        shown,
        target: other,
        singleton: (candidate) =>
          destinations.some(
            (destination) => destination.kind === "singleton" && destination.fullPath === candidate,
          ),
      });
      await navigate({ to: `${localizedPath(next, target)}${search}` });
    },
    [cache, destinations, navigate, path, projectSlug, search, view.locale],
  );
}

function closeLanguageDialog() {
  studioStore.send({ type: "closeLanguageDialog" });
}

/** Asks for a BCP 47 tag, then adds the language, a copy of the default language's content. */
function AddLanguageDialog({
  projectId,
  open,
  onAdded,
}: {
  projectId: number;
  open: boolean;
  onAdded: (added: LocaleView) => void;
}) {
  const cache = useStudioCache();
  const [tag, setTag] = React.useState("");
  const add = useMutation({
    ...localeMutations.add(),
    onSuccess: (added) => {
      closeLanguageDialog();
      setTag("");
      toast.success(`Added ${languageLabel(added.tag)}`);
      void cache.invalidate(reads.localeList({ projectId }));
      onAdded(added);
    },
    onError: (error) => toast.error(error.message || "Could not add the language"),
  });
  const trimmed = tag.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !add.isPending) closeLanguageDialog();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed) add.mutate({ projectId, tag: trimmed });
          }}
        >
          <DialogHeader>
            <DialogTitle>Add a language</DialogTitle>
            <DialogDescription>
              The new language starts as a copy of the default language's content, ready to
              translate. It goes live when the draft is published.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="camox-language-tag">Language tag</Label>
            <Input
              id="camox-language-tag"
              value={tag}
              onChange={(event) => setTag(event.target.value)}
              placeholder="de, fr or pt-BR"
              autoComplete="off"
              autoFocus
            />
            <p className="text-muted-foreground text-xs">
              {trimmed
                ? languageLabel(trimmed)
                : "A BCP 47 language tag. Its pages are served under its own prefix, like /de."}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={add.isPending}
              onClick={closeLanguageDialog}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed || add.isPending}>
              {add.isPending ? <Spinner /> : null}
              Add language
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Asks before removing a language with all its content, then removes it in the draft. */
function RemoveLanguageDialog({
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
  const label = languageLabel(locale.tag);
  const remove = useMutation({
    ...localeMutations.remove(),
    onSuccess: () => {
      closeLanguageDialog();
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
        if (!next && !remove.isPending) closeLanguageDialog();
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

/** The locale picker's actions in the command palette, offered where its menu offers them. */
function useLocaleActions({
  enabled,
  locales,
  viewed,
  switchTo,
}: {
  enabled: boolean;
  locales: readonly LocaleView[];
  viewed: LocaleView;
  switchTo: (locale: LocaleView) => Promise<void>;
}) {
  React.useEffect(() => {
    const others = locales.filter((locale) => locale.tag !== viewed.tag);
    const actions = [
      {
        id: SWITCH_TO_LANGUAGE_ID,
        label: "Switch to language…",
        aliases: ["Change language", "Locale", "Translation"],
        groupLabel: "Languages",
        checkIfAvailable: () => others.length > 0,
        hasChildren: true,
        execute: () => {},
      },
      ...others.map((other): Action => ({
        id: `${SWITCH_TO_LANGUAGE_ID}-${other.tag}`,
        parentActionId: SWITCH_TO_LANGUAGE_ID,
        label: `Switch to ${languageLabel(other.tag)}`,
        aliases: [other.tag],
        groupLabel: "Languages",
        checkIfAvailable: () => true,
        execute: () => void switchTo(other),
      })),
      {
        id: "add-language",
        label: "Add language…",
        aliases: ["New language", "Add locale", "Translate website"],
        groupLabel: "Languages",
        checkIfAvailable: () => enabled,
        execute: () => studioStore.send({ type: "openLanguageDialog", dialog: "add" }),
      },
      {
        id: "remove-language",
        label: `Remove ${languageLabel(viewed.tag)}…`,
        aliases: ["Delete language", "Remove locale"],
        groupLabel: "Languages",
        checkIfAvailable: () => enabled && !viewed.isDefault,
        execute: () => studioStore.send({ type: "openLanguageDialog", dialog: "remove" }),
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });
    return () => {
      actionsStore.send({ type: "unregisterManyActions", ids: actions.map((a) => a.id) });
    };
  }, [enabled, locales, viewed, switchTo]);
}
