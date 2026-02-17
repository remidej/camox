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
import { cn } from "@/lib/utils";
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
import { PageSheet } from "./PageSheet";

/* -------------------------------------------------------------------------------------------------
 * PagePicker
 * -----------------------------------------------------------------------------------------------*/

const CREATE_PAGE_VALUE = "__create_page__";

const PagePicker = () => {
  const [open, setOpen] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [sheetMode, setSheetMode] = React.useState<"create" | "edit">("create");
  const [pageToEdit, setPageToEdit] = React.useState<Doc<"pages"> | null>(null);
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
    try {
      await deletePage({ pageId: page._id });
      toast.success(`Deleted ${page.nickname} page`);

      if (pathname === page.fullPath) {
        navigate({ to: "/" });
      }
    } catch (error) {
      console.error("Failed to delete page:", error);
      toast.error(`Could not delete ${page.nickname} page`);
    } finally {
      setPageToDelete(null);
    }
  };

  if (!pages) {
    return (
      <div className="flex items-center gap-2 min-w-[150px] h-9 px-4 border border-input rounded-md">
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-4" />
      </div>
    );
  }

  const currentPage = pages.find((page) => page.fullPath === pathname);
  if (!currentPage) {
    return (
      <div className="flex items-center gap-2 min-w-[150px] h-9 px-4 border border-input rounded-md">
        <Skeleton className="h-4 flex-1" />
        <Skeleton className="h-4 w-4" />
      </div>
    );
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
            className="min-w-[150px] grow justify-between"
          >
            {currentPage.nickname}
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
                        <p>{page.nickname}</p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {page.fullPath}
                        </p>
                      </div>
                    </div>
                    {page.fullPath !== "/" && (
                      <div className="hidden group-data-[selected=true]/item:flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPageToEdit(page);
                            setSheetMode("edit");
                            setSheetOpen(true);
                            setOpen(false);
                          }}
                          onKeyDown={(e) => {
                            // Prevent the button keyboard events from being hyjacked by CommandItem
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setPageToEdit(page);
                              setSheetMode("edit");
                              setSheetOpen(true);
                              setOpen(false);
                            }
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
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
                      </div>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
            <CommandSeparator className="m-0" />
            <CommandGroup className="p-1">
              <CommandItem
                onSelect={() => {
                  setOpen(false);
                  setSheetMode("create");
                  setPageToEdit(null);
                  setSheetOpen(true);
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
      <PageSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        mode={sheetMode}
        pageToEdit={pageToEdit ?? undefined}
      />
      <AlertDialog
        open={!!pageToDelete}
        onOpenChange={(open) => !open && setPageToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete page</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>{pageToDelete?.nickname}</strong>? This action cannot be
              undone.
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
