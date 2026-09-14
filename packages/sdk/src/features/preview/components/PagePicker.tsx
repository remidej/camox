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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@camox/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@camox/ui/popover";
import { Skeleton } from "@camox/ui/skeleton";
import { toast } from "@camox/ui/toaster";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSelector } from "@xstate/store-react";
import { Check, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";

import { useLocation, useNavigate } from "@/features/navigation/navigation";
import { useProjectSlug } from "@/lib/auth";
import type { Page } from "@/lib/queries";
import { layoutQueries, pageMutations, pageQueries, projectQueries } from "@/lib/queries";
import { cn } from "@/lib/utils";

import type { Layout } from "../../../core/createLayout";
import { matchDerivedLayout, routeSegments } from "../../../core/derivedRoutes";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { previewStore } from "../previewStore";
import { DerivedLayoutDialog } from "./DerivedLayoutDialog";
import { PageStatusBadge } from "./PageStatusBadge";

/* -------------------------------------------------------------------------------------------------
 * PagePicker
 * -----------------------------------------------------------------------------------------------*/

const CREATE_PAGE_VALUE = "__create_page__";
const DERIVED_LAYOUT_PREFIX = "__derived_layout__:";

const PagePicker = () => {
  const [open, setOpen] = React.useState(false);
  const [highlightedValue, setHighlightedValue] = React.useState<string | null>(null);
  const camoxApp = useCamoxApp();
  const derivedLayouts = camoxApp
    .getLayouts()
    .filter((layout) => layout._internal.kind === "derived");
  const [layoutToPreview, setLayoutToPreview] = React.useState<Layout | null>(null);
  const [pageToDelete, setPageToDelete] = React.useState<Page | null>(null);
  const peekedPagePathname = useSelector(previewStore, (state) => state.context.peekedPagePathname);

  const projectSlug = useProjectSlug();
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: layoutRecords } = useQuery({
    ...layoutQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const layoutStatusById = new Map(
    layoutRecords?.map((layout) => [layout.layoutId, layout.status]),
  );
  const deletePage = useMutation(pageMutations.delete());
  const { data: pages } = useQuery({
    ...pageQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const closePopover = () => {
    previewStore.send({ type: "clearPeekedPage" });
    setOpen(false);
    setHighlightedValue(null);
  };

  const handleDeletePage = async (page: Page) => {
    const displayName = page.nickname;
    try {
      await deletePage.mutateAsync({ id: page.id });
      toast.success(`Deleted ${displayName} page`);

      if (pathname === page.fullPath) {
        await navigate({ to: "/" });
      }
    } catch (error) {
      console.error("Failed to delete page:", error);
      toast.error(`Could not delete ${displayName} page`);
    } finally {
      setPageToDelete(null);
    }
  };

  const skeleton = (
    <div className="border-input flex h-9 w-full items-center gap-2 rounded-md border px-2">
      <Skeleton className="h-3 flex-1" />
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </div>
  );

  if (!pages) {
    return skeleton;
  }

  const currentPage = pages.find((page) => page.fullPath === pathname);
  const currentDerived = currentPage ? null : matchDerivedLayout(derivedLayouts, pathname);
  const currentLayoutStatus = currentDerived
    ? layoutStatusById.get(currentDerived.layout._internal.id)
    : undefined;
  const peekedFullPath =
    peekedPagePathname ??
    currentPage?.fullPath ??
    (currentDerived ? `${DERIVED_LAYOUT_PREFIX}${currentDerived.layout._internal.id}` : pathname);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(value) => {
          if (!value) {
            closePopover();
            return;
          }
          setOpen(value);
        }}
      >
        <PopoverTrigger
          render={
            <Button variant="outline" role="combobox" className="min-w-0 flex-1 justify-between" />
          }
        >
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate">
              {currentPage?.nickname ?? currentDerived?.layout._internal.title ?? "Select page"}
            </span>
            {currentPage && (
              <PageStatusBadge
                size="sm"
                status={currentPage.status}
                modifiedReason={currentPage.modifiedReason}
              />
            )}
            {currentLayoutStatus && <PageStatusBadge size="sm" status={currentLayoutStatus} />}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent
          className="flex h-[300px] w-[400px] flex-col p-0"
          align="start"
          side="bottom"
        >
          <Command
            value={highlightedValue ?? peekedFullPath}
            onValueChange={(value) => {
              setHighlightedValue(value);
              if (value === CREATE_PAGE_VALUE || value.startsWith(DERIVED_LAYOUT_PREFIX)) {
                previewStore.send({ type: "clearPeekedPage" });
                return;
              }
              previewStore.send({ type: "setPeekedPage", pathname: value });
            }}
            className="flex flex-1 flex-col overflow-hidden"
          >
            <CommandInput placeholder="Search page..." className="h-9" />
            <CommandList className="flex-1 overflow-y-auto">
              <CommandEmpty>No page found.</CommandEmpty>
              <CommandGroup>
                {pages.map((page) => (
                  <CommandItem
                    key={page.id}
                    value={page.fullPath}
                    className="group/item justify-between"
                    hideCheck
                    onSelect={() => {
                      void navigate({ to: page.fullPath });
                      closePopover();
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2">
                      <Check
                        className={cn(
                          "size-4 mt-0.5 shrink-0",
                          currentPage?.fullPath !== page.fullPath && "invisible",
                        )}
                      />
                      <div className="flex min-w-0 flex-col">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className="truncate">{page.nickname}</p>
                          <PageStatusBadge
                            size="sm"
                            status={page.status}
                            modifiedReason={page.modifiedReason}
                          />
                        </div>
                        <p className="text-muted-foreground truncate font-mono text-xs">
                          {page.fullPath}
                        </p>
                      </div>
                    </div>
                    <div className="hidden gap-1 group-data-[selected=true]/item:flex">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          previewStore.send({
                            type: "openEditPageModal",
                            pageId: page.id,
                          });
                          closePopover();
                        }}
                        onKeyDown={(e) => {
                          // Prevent the button keyboard events from being hyjacked by CommandItem
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            previewStore.send({
                              type: "openEditPageModal",
                              pageId: page.id,
                            });
                            closePopover();
                          }
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      {page.fullPath !== "/" && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPageToDelete(page);
                          }}
                          onKeyDown={(e) => {
                            // Prevent the button keyboard events from being hyjacked by CommandItem
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setPageToDelete(page);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              {derivedLayouts.length > 0 && (
                <CommandGroup heading="Derived pages">
                  {derivedLayouts.map((layout) => (
                    <CommandItem
                      key={layout._internal.id}
                      value={`${DERIVED_LAYOUT_PREFIX}${layout._internal.id}`}
                      keywords={[layout._internal.title]}
                      hideCheck
                      onSelect={() => {
                        closePopover();
                        const segments = routeSegments(layout._internal.id);
                        if (!segments.some((segment) => segment.startsWith("$"))) {
                          void navigate({ to: `/${segments.map(encodeURIComponent).join("/")}` });
                          return;
                        }
                        setLayoutToPreview(layout);
                      }}
                    >
                      <div className="flex min-w-0 flex-1 items-start gap-2">
                        <Check
                          className={cn(
                            "size-4 mt-0.5 shrink-0",
                            currentDerived?.layout._internal.id !== layout._internal.id &&
                              "invisible",
                          )}
                        />
                        <div className="flex min-w-0 flex-col">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <p className="truncate">{layout._internal.title}</p>
                            {layoutStatusById.has(layout._internal.id) && (
                              <PageStatusBadge
                                size="sm"
                                status={layoutStatusById.get(layout._internal.id)!}
                              />
                            )}
                          </div>
                          <p className="text-muted-foreground truncate font-mono text-xs">
                            /{routeSegments(layout._internal.id).join("/")}
                          </p>
                        </div>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  closePopover();
                  previewStore.send({ type: "openCreatePageModal" });
                }}
                value={CREATE_PAGE_VALUE}
              >
                <Plus className="size-4" />
                Create page
              </CommandItem>
            </CommandGroup>
          </Command>
        </PopoverContent>
      </Popover>
      {layoutToPreview && (
        <DerivedLayoutDialog
          key={layoutToPreview._internal.id}
          layout={layoutToPreview}
          projectSlug={projectSlug}
          currentParams={
            currentDerived?.layout._internal.id === layoutToPreview._internal.id
              ? currentDerived.params
              : undefined
          }
          onClose={() => setLayoutToPreview(null)}
        />
      )}
      <AlertDialog open={!!pageToDelete} onOpenChange={(open) => !open && setPageToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{pageToDelete ? pageToDelete.nickname : ""}</strong>? This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pageToDelete && handleDeletePage(pageToDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export { PagePicker };
