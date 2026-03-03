import * as React from "react";
import { Check, ChevronsUpDown, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { api } from "camox/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store/react";
import { previewStore } from "../previewStore";
import { cn, formatPathSegment } from "@/lib/utils";
import { Doc } from "camox/_generated/dataModel";
import { toast } from "@/components/ui/toaster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

/* -------------------------------------------------------------------------------------------------
 * PagePicker
 * -----------------------------------------------------------------------------------------------*/

const CREATE_PAGE_VALUE = "__create_page__";

const PagePicker = () => {
  const [open, setOpen] = React.useState(false);
  const [pageToDelete, setPageToDelete] = React.useState<Doc<"pages"> | null>(
    null,
  );
  const peekedPagePathname = useSelector(
    previewStore,
    (state) => state.context.peekedPagePathname,
  );

  const pages = useQuery(api.pages.listPages);
  const deletePage = useMutation(api.pages.deletePage);
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const handleDeletePage = async (page: Doc<"pages">) => {
    const displayName = page.metaTitle ?? formatPathSegment(page.pathSegment);
    try {
      await deletePage({ pageId: page._id });
      toast.success(`Deleted ${displayName} page`);

      if (pathname === page.fullPath) {
        navigate({ to: "/" });
      }
    } catch (error) {
      console.error("Failed to delete page:", error);
      toast.error(`Could not delete ${displayName} page`);
    } finally {
      setPageToDelete(null);
    }
  };

  const skeleton = (
    <div className="w-full flex items-center gap-2 h-9 px-2 border border-input rounded-md">
      <Skeleton className="h-3 flex-1" />
      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
    </div>
  );

  if (!pages) {
    return skeleton;
  }

  const currentPage = pages.find((page) => page.fullPath === pathname);
  if (!currentPage) {
    return skeleton;
  }

  const peekedFullPath = peekedPagePathname ?? currentPage.fullPath;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(value) => {
          previewStore.send({ type: "clearPeekedPage" });
          setOpen(value);
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            className="w-full grow justify-between"
          >
            <span className="truncate">
              {currentPage.metaTitle ?? currentPage.fullPath}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[400px] h-[300px] p-0 flex flex-col"
          align="start"
          side="bottom"
        >
          <Command
            value={peekedFullPath}
            onValueChange={(value) => {
              if (value === CREATE_PAGE_VALUE) {
                previewStore.send({ type: "clearPeekedPage" });
                return;
              }
              previewStore.send({ type: "setPeekedPage", pathname: value });
            }}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <CommandInput placeholder="Search page..." className="h-9" />
            <CommandList className="flex-1 overflow-y-auto">
              <CommandEmpty>No page found.</CommandEmpty>
              <CommandGroup>
                {pages.map((page) => (
                  <CommandItem
                    key={page._id}
                    value={page.fullPath}
                    className="justify-between group/item"
                    onSelect={() => {
                      navigate({ to: page.fullPath });
                      setOpen(false);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <Check
                        className={cn(
                          "size-4 mt-0.5",
                          currentPage.fullPath !== page.fullPath && "invisible",
                        )}
                      />
                      <div className="flex flex-col">
                        <p className="truncate">
                          {page.metaTitle ??
                            formatPathSegment(page.pathSegment)}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono truncate">
                          {page.fullPath}
                        </p>
                      </div>
                    </div>
                    <div className="hidden group-data-[selected=true]/item:flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          previewStore.send({
                            type: "openEditPageSheet",
                            page,
                          });
                          setOpen(false);
                        }}
                        onKeyDown={(e) => {
                          // Prevent the button keyboard events from being hyjacked by CommandItem
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            previewStore.send({
                              type: "openEditPageSheet",
                              page,
                            });
                            setOpen(false);
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
            </CommandList>
            <CommandSeparator className="m-0" />
            <CommandGroup className="p-1">
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  previewStore.send({ type: "openCreatePageSheet" });
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
      <AlertDialog
        open={!!pageToDelete}
        onOpenChange={(open) => !open && setPageToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>
                {pageToDelete
                  ? (pageToDelete.metaTitle ??
                    formatPathSegment(pageToDelete.pathSegment))
                  : ""}
              </strong>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pageToDelete && handleDeletePage(pageToDelete)}
              asChild
            >
              <Button variant="destructive">Delete</Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export { PagePicker };
