/* -------------------------------------------------------------------------------------------------
 * Page metadata sidebar pieces
 * -----------------------------------------------------------------------------------------------*/

import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import { Input } from "@camox/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
} from "@camox/ui/input-group";
import { Label } from "@camox/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@camox/ui/select";
import { Spinner } from "@camox/ui/spinner";
import { Switch } from "@camox/ui/switch";
import { toast } from "@camox/ui/toaster";
import { Tooltip, TooltipContent, TooltipTrigger } from "@camox/ui/tooltip";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, Info, Pencil, Trash2, Upload } from "lucide-react";
import * as React from "react";

import { useNavigate } from "@/features/navigation/navigation";
import { useDebouncedField } from "@/hooks/use-debounced-field";
import { useProjectSlug } from "@/lib/auth";
import type { Page } from "@/lib/queries";
import {
  blockQueries,
  layoutQueries,
  pageMutations,
  pageQueries,
  projectQueries,
} from "@/lib/queries";
import { cn } from "@/lib/utils";

import { UploadDropZone } from "../../content/components/UploadDropZone";
import { useCamoxApp } from "../../provider/components/CamoxAppContext";
import { areCommentsEnabled } from "../commentsEnabled";
import { AttachedComments } from "./AttachedComments";
import { DebouncedFieldEditor } from "./DebouncedFieldEditor";
import { formatRelativeTime, Metadata, MetadataRow } from "./Metadata";
import { PageLocationFieldset } from "./PageLocationFieldset";
import { PAGE_NICKNAME_MAX_LENGTH, PageNicknameField } from "./PageNicknameField";
import { ShikiMarkdown } from "./ShikiMarkdown";

type PageMetadataData = ReturnType<typeof usePageMetadataData>;

const usePageMetadataData = (pageId: number) => {
  const projectSlug = useProjectSlug();
  const camoxApp = useCamoxApp();
  const { data: page } = useQuery(pageQueries.getById(pageId));
  const { data: project } = useQuery(projectQueries.getBySlug(projectSlug));
  const { data: pages } = useQuery({
    ...pageQueries.list(project?.id ?? 0),
    enabled: !!project,
  });
  const { data: allLayouts } = useQuery({
    ...layoutQueries.list(project?.id ?? 0),
    enabled: !!project,
  });

  const layouts = allLayouts?.filter(
    (layout) => camoxApp.getLayoutById(layout.layoutId)?._internal.kind !== "derived",
  );
  const pageLayoutRecord = allLayouts?.find((l) => l.id === page?.layoutId);
  const layoutDef = pageLayoutRecord
    ? camoxApp.getLayoutById(pageLayoutRecord.layoutId)
    : undefined;
  const metaTitle =
    layoutDef && page
      ? layoutDef._internal.buildMetaTitle({
          pageMetaTitle: page.metaTitle ?? "",
          projectName: project?.name ?? "",
          pageFullPath: page.fullPath,
        })
      : (page?.metaTitle ?? "");

  return { page, project, pages, layouts, pageLayoutRecord, metaTitle, camoxApp };
};

const PageInfoSidebar = ({
  pageId,
  scrollable = true,
  aboutOnly = false,
}: {
  pageId: number;
  scrollable?: boolean;
  aboutOnly?: boolean;
}) => {
  const data = usePageMetadataData(pageId);
  const { page, metaTitle } = data;
  const [isStructureModalOpen, setIsStructureModalOpen] = React.useState(false);
  const [isSeoModalOpen, setIsSeoModalOpen] = React.useState(false);
  const [isMarkdownModalOpen, setIsMarkdownModalOpen] = React.useState(false);

  if (!page) {
    return (
      <div className="text-muted-foreground flex flex-1 items-center justify-center px-2 text-sm">
        <Spinner className="mr-2 size-3.5" /> Loading page info...
      </div>
    );
  }

  return (
    <>
      <div className={cn("space-y-4 p-2 pt-4", scrollable && "flex-1 overflow-auto")}>
        <section className="space-y-4">
          {!aboutOnly && <p className="text-base font-semibold">About this page</p>}
          <PageNicknameSidebarEditor data={data} />
          <div className="space-y-2">
            <Label>Page path</Label>
            <InputGroup className="px-1">
              <InputGroupText className="min-w-0 flex-1 px-2 py-1.5 font-mono font-normal break-all">
                {page.fullPath}
              </InputGroupText>
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setIsStructureModalOpen(true)}
                  aria-label="Edit page structure"
                >
                  <Pencil />
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </div>
          <PageLayoutSidebarSelect data={data} />
        </section>
        {!aboutOnly && (
          <>
            <div className="space-y-2">
              <Label>SEO</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setIsSeoModalOpen(true)}
              >
                Manage SEO metadata
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Markdown</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => setIsMarkdownModalOpen(true)}
              >
                View page markdown
              </Button>
            </div>
          </>
        )}
        <Metadata>
          <MetadataRow label="Created">{formatRelativeTime(page.createdAt)}</MetadataRow>
          <MetadataRow label="Created by">{page.createdBy ?? "Unknown"}</MetadataRow>
          <MetadataRow label="Updated">{formatRelativeTime(page.updatedAt)}</MetadataRow>
          <MetadataRow label="Published">
            {page.publishedAt == null ? "Never" : formatRelativeTime(page.publishedAt)}
          </MetadataRow>
          {page.publishedAt != null && (
            <MetadataRow label="Published by">{page.publishedBy ?? "Unknown"}</MetadataRow>
          )}
        </Metadata>
        {areCommentsEnabled() && (
          <div className="-mx-2">
            <AttachedComments pageId={pageId} />
          </div>
        )}
      </div>
      <PageStructureModal
        open={isStructureModalOpen}
        onOpenChange={setIsStructureModalOpen}
        pageId={page.id}
      />
      {!aboutOnly && (
        <>
          <PageSeoModal open={isSeoModalOpen} onOpenChange={setIsSeoModalOpen} pageId={page.id} />
          <PageMarkdownModal
            open={isMarkdownModalOpen}
            onOpenChange={setIsMarkdownModalOpen}
            pageId={page.id}
            metaTitle={metaTitle}
            metaDescription={page.metaDescription ?? ""}
          />
        </>
      )}
    </>
  );
};

const PageNicknameSidebarEditor = ({ data }: { data: PageMetadataData }) => {
  const { page } = data;
  const updatePage = useMutation(pageMutations.update());
  const inputId = React.useId();

  const saveNickname = React.useCallback(
    (value: string) => {
      if (!page) return;

      const nickname = value.trim();
      if (nickname === page.nickname) return;
      if (!nickname) {
        toast.error("Page nickname is required");
        return;
      }

      updatePage.mutate(
        {
          id: page.id,
          nickname,
          pathSegment: page.pathSegment,
          parentPageId: page.parentPageId,
        },
        {
          onError: () => {
            toast.error("Could not update page");
          },
        },
      );
    },
    [page, updatePage],
  );

  const { value, setValue, onFocus, onBlur } = useDebouncedField(
    page?.nickname ?? "",
    saveNickname,
  );

  if (!page) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={inputId}>Page nickname</Label>
        <Tooltip>
          <TooltipTrigger render={<Info className="text-muted-foreground size-3.5" />} />
          <TooltipContent>A short internal name. Does not affect SEO.</TooltipContent>
        </Tooltip>
      </div>
      <Input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="e.g. Home, Pricing, About"
        maxLength={PAGE_NICKNAME_MAX_LENGTH}
      />
    </div>
  );
};

const PageLayoutSidebarSelect = ({ data }: { data: PageMetadataData }) => {
  const { page, layouts, camoxApp } = data;
  const setLayout = useMutation(pageMutations.setLayout());

  if (!page || !layouts || layouts.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Label>Layout</Label>
        <Tooltip>
          <TooltipTrigger render={<Info className="text-muted-foreground size-3.5" />} />
          <TooltipContent className="max-w-xs">
            A layout wraps page content in shared structure, like navbars and footers, and controls
            how metadata is generated.
          </TooltipContent>
        </Tooltip>
      </div>
      <Select
        value={page.layoutId ? String(page.layoutId) : ""}
        onValueChange={(value) => {
          const layoutId = Number(value);
          if (layoutId === page.layoutId) return;
          setLayout.mutate(
            { id: page.id, layoutId },
            {
              onError: () => {
                toast.error("Could not update page layout");
              },
            },
          );
        }}
        items={layouts.map((t) => ({
          value: String(t.id),
          label: camoxApp.getLayoutById(t.layoutId)?._internal.title ?? t.layoutId,
        }))}
      >
        <SelectTrigger disabled={setLayout.isPending} className="w-full">
          <SelectValue placeholder="Select a layout" />
        </SelectTrigger>
        <SelectContent>
          {layouts.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              {camoxApp.getLayoutById(t.layoutId)?._internal.title ?? t.layoutId}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const PageStructureModal = ({
  open,
  onOpenChange,
  pageId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: number;
}) => {
  const data = usePageMetadataData(pageId);
  const { page } = data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Page page</DialogTitle>
          <DialogDescription>Update the URL path for this page.</DialogDescription>
        </DialogHeader>
        {page ? (
          <PageStructureEditor
            data={data}
            includeNickname={false}
            includeLayout={false}
            onSaved={() => onOpenChange(false)}
          />
        ) : (
          <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
            <Spinner className="size-3.5" /> Loading...
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const PageStructureEditor = ({
  data,
  includeNickname = true,
  includeLayout = true,
  onSaved,
}: {
  data: PageMetadataData;
  includeNickname?: boolean;
  includeLayout?: boolean;
  onSaved?: () => void;
}) => {
  const { page, project, pages, layouts, camoxApp } = data;
  const updatePage = useMutation(pageMutations.update());
  const setLayout = useMutation(pageMutations.setLayout());
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: {
      nickname: page?.nickname ?? "",
      pathSegment: page?.pathSegment ?? "",
      parentPageId: page?.parentPageId ?? undefined,
      layoutId: page?.layoutId ?? 0,
    },
    onSubmit: async (values) => {
      if (!page) return;
      try {
        const nickname = values.value.nickname.trim();
        if (!nickname) {
          toast.error("Page nickname is required");
          return;
        }

        const { fullPath } = await updatePage.mutateAsync({
          id: page.id,
          nickname,
          pathSegment: values.value.pathSegment,
          parentPageId: values.value.parentPageId,
        });

        if (includeLayout && values.value.layoutId) {
          await setLayout.mutateAsync({ id: page.id, layoutId: values.value.layoutId });
        }

        toast.success(`Updated ${nickname} page`);
        form.reset();
        onSaved?.();
        await navigate({ to: fullPath });
      } catch (error) {
        console.error("Failed to update page:", error);
        toast.error("Could not update page");
      }
    },
  });

  React.useEffect(() => {
    if (!page) return;
    form.reset({
      nickname: page.nickname,
      pathSegment: page.pathSegment,
      parentPageId: page.parentPageId ?? undefined,
      layoutId: page.layoutId ?? 0,
    });
  }, [page?.id]);

  if (!page || !project) return null;

  const isRootPage = page.fullPath === "/";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-4"
    >
      {includeNickname && (
        <form.Field name="nickname">
          {(field) => <PageNicknameField value={field.state.value} onChange={field.handleChange} />}
        </form.Field>
      )}
      {isRootPage ? (
        <Alert>
          <Info className="size-4" />
          <AlertTitle>Homepage</AlertTitle>
          <AlertDescription>You can't change the path of the home page.</AlertDescription>
        </Alert>
      ) : (
        <form.Field name="parentPageId">
          {(parentField) => (
            <form.Field name="pathSegment">
              {(pathField) => (
                <PageLocationFieldset
                  parentPageId={parentField.state.value}
                  onParentPageIdChange={parentField.handleChange}
                  pathSegment={pathField.state.value}
                  onPathSegmentChange={pathField.handleChange}
                  pages={pages}
                  excludePageId={page.id}
                />
              )}
            </form.Field>
          )}
        </form.Field>
      )}
      {includeLayout && layouts && layouts.length > 0 && (
        <form.Field name="layoutId">
          {(field) => (
            <div className="space-y-2">
              <Label>Layout</Label>
              <Select
                value={field.state.value ? String(field.state.value) : ""}
                onValueChange={(value) => field.handleChange(Number(value))}
                items={layouts.map((t) => ({
                  value: String(t.id),
                  label: camoxApp.getLayoutById(t.layoutId)?._internal.title ?? t.layoutId,
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a layout" />
                </SelectTrigger>
                <SelectContent>
                  {layouts.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {camoxApp.getLayoutById(t.layoutId)?._internal.title ?? t.layoutId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
      )}
      <form.Subscribe
        selector={(s) => ({ isSubmitting: s.isSubmitting, isPristine: s.isPristine })}
      >
        {({ isSubmitting, isPristine }) => (
          <Button type="submit" disabled={isSubmitting || isPristine}>
            {isSubmitting && <Spinner />}
            Save changes{isSubmitting && "..."}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
};

const PageSeoModal = ({
  open,
  onOpenChange,
  pageId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: number;
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>SEO metadata</DialogTitle>
          <DialogDescription>
            Control how this page appears in search and social previews.
          </DialogDescription>
        </DialogHeader>
        <PageSeoContent pageId={pageId} />
      </DialogContent>
    </Dialog>
  );
};

export const PageSeoContent = ({ pageId }: { pageId: number }) => {
  const { page, metaTitle, pageLayoutRecord, project } = usePageMetadataData(pageId);
  return page ? (
    <PageSeoEditor
      page={page}
      metaTitle={metaTitle}
      layoutId={pageLayoutRecord?.layoutId}
      projectName={project?.name}
    />
  ) : (
    <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
      <Spinner className="size-3.5" /> Loading...
    </div>
  );
};

const PageSeoEditor = ({
  page,
  metaTitle,
  layoutId,
  projectName,
}: {
  page: Pick<
    Page,
    | "id"
    | "aiSeoEnabled"
    | "metaTitle"
    | "metaDescription"
    | "fullPath"
    | "pathSegment"
    | "customOgImageUrl"
  >;
  metaTitle: string;
  layoutId?: string;
  projectName?: string;
}) => {
  const setAiSeo = useMutation(pageMutations.setAiSeo());
  const setMetaTitle = useMutation(pageMutations.setMetaTitle());
  const setMetaDescription = useMutation(pageMutations.setMetaDescription());

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Switch
          id="ai-seo"
          checked={page.aiSeoEnabled !== false}
          onCheckedChange={(checked) => {
            setAiSeo.mutate({ id: page.id, enabled: checked });
          }}
        />
        <Label htmlFor="ai-seo">AI metadata</Label>
      </div>
      <DebouncedFieldEditor
        label="Page title"
        placeholder="Page title..."
        initialValue={page.metaTitle ?? ""}
        disabled={page.aiSeoEnabled !== false}
        onSave={(value) => setMetaTitle.mutate({ id: page.id, metaTitle: value })}
      />
      <DebouncedFieldEditor
        label="Page description"
        placeholder="Page description..."
        initialValue={page.metaDescription ?? ""}
        disabled={page.aiSeoEnabled !== false}
        rows={2}
        onSave={(value) => setMetaDescription.mutate({ id: page.id, metaDescription: value })}
      />
      <SearchEnginePreview
        page={page}
        metaTitle={metaTitle}
        metaDescription={page.metaDescription ?? ""}
      />
      <SocialPreviewSection
        page={page}
        metaTitle={metaTitle}
        metaDescription={page.metaDescription ?? ""}
        layoutId={layoutId}
        projectName={projectName}
      />
    </div>
  );
};

const PageMarkdownModal = ({
  open,
  onOpenChange,
  pageId,
  metaTitle,
  metaDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageId: number;
  metaTitle: string;
  metaDescription: string;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle>Markdown content</DialogTitle>
        <DialogDescription>How your content will be served to AI agents.</DialogDescription>
      </DialogHeader>
      <PageMarkdownPreview
        pageId={pageId}
        metaTitle={metaTitle}
        metaDescription={metaDescription}
      />
    </DialogContent>
  </Dialog>
);

export const PageMarkdownContent = ({ pageId }: { pageId: number }) => {
  const { page, metaTitle } = usePageMetadataData(pageId);
  if (!page) return <Spinner className="size-4" />;
  return (
    <PageMarkdownPreview
      pageId={pageId}
      metaTitle={metaTitle}
      metaDescription={page.metaDescription ?? ""}
    />
  );
};

function truncateText(text: string, maxLen: number) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

const SearchEnginePreview = ({
  page,
  metaTitle,
  metaDescription,
}: {
  page: Pick<Page, "fullPath">;
  metaTitle: string;
  metaDescription: string;
}) => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}${page.fullPath}`;

  return (
    <div className="space-y-1 pt-2">
      <div className="flex items-center gap-1.5">
        <Label>Search engine preview</Label>
        <Tooltip>
          <TooltipTrigger delay={50} render={<Info className="text-muted-foreground size-3.5" />} />
          <TooltipContent>
            Titles are cropped after 60 characters and descriptions after 155, like on Google Search
            results.
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="border-border space-y-0.5 rounded-lg border p-3">
        <p className="text-muted-foreground truncate text-xs">{url}</p>
        <p className="text-base font-medium text-blue-600 dark:text-blue-400">
          {truncateText(metaTitle || "Untitled", 60)}
        </p>
        <p className="text-muted-foreground line-clamp-2 text-xs">
          {truncateText(metaDescription || "No description", 155)}
        </p>
      </div>
    </div>
  );
};

const SocialPreviewSection = ({
  page,
  metaTitle,
  metaDescription,
  layoutId,
  projectName,
}: {
  page: Pick<
    Page,
    "id" | "fullPath" | "metaTitle" | "metaDescription" | "pathSegment" | "customOgImageUrl"
  >;
  metaTitle: string;
  metaDescription: string;
  layoutId?: string;
  projectName?: string;
}) => {
  const pageMetaTitle = page.metaTitle ?? page.pathSegment;
  const ogImageParams = new URLSearchParams({
    ...(layoutId && { layoutId }),
    title: pageMetaTitle,
    ...(page.metaDescription && { description: page.metaDescription }),
    ...(projectName && { projectName }),
  });
  const generatedOgImage = `/og?${ogImageParams.toString()}`;
  const ogImage = page.customOgImageUrl ?? generatedOgImage;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}${page.fullPath}`;
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const uploadCustomOgImage = useMutation({
    ...pageMutations.uploadCustomOgImage(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageQueries.getById(page.id).queryKey });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Could not upload image");
    },
  });

  const deleteCustomOgImage = useMutation({
    ...pageMutations.deleteCustomOgImage(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: pageQueries.getById(page.id).queryKey });
    },
    onError: () => {
      toast.error("Could not remove image");
    },
  });

  const hasCustomImage = !!page.customOgImageUrl;
  const isBusy = uploadCustomOgImage.isPending || deleteCustomOgImage.isPending;

  const handleFiles = (files: FileList) => {
    const file = files[0];
    if (file) uploadCustomOgImage.mutate({ pageId: page.id, file });
  };

  return (
    <div className="space-y-2 pt-2">
      <Label>Social preview</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={isBusy}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploadCustomOgImage.isPending ? <Spinner /> : <Upload className="size-3.5" />}
          {hasCustomImage ? "Replace custom image" : "Upload custom image"}
        </Button>
        {hasCustomImage && (
          <Button
            type="button"
            variant="ghost"
            disabled={isBusy}
            onClick={() => deleteCustomOgImage.mutate({ pageId: page.id })}
            aria-label="Remove custom image"
          >
            {deleteCustomOgImage.isPending ? (
              <Spinner className="text-muted-foreground" />
            ) : (
              <Trash2 className="text-muted-foreground" />
            )}{" "}
            Clear
          </Button>
        )}
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept="image/jpeg,image/png,image/gif,image/webp"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      <div className="border-border max-w-xl overflow-hidden rounded-lg border">
        <UploadDropZone
          onDrop={handleFiles}
          label={hasCustomImage ? "Drop image to replace" : "Drop image to upload"}
          className="block"
        >
          <img
            src={ogImage}
            alt=""
            className="w-full object-cover"
            style={{ aspectRatio: "1200 / 630" }}
          />
        </UploadDropZone>
        <div className="space-y-1.5 border-t px-3 py-2.5">
          <p className="text-foreground truncate text-sm font-semibold">
            {metaTitle || "Untitled"}
          </p>
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {metaDescription || "No description"}
          </p>
          <div className="pt-1.5">
            <p className="text-muted-foreground flex items-center gap-1 text-xs">
              <Globe className="size-3 shrink-0" />
              <span className="truncate">{url}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const PageMarkdownPreview = ({
  pageId,
  metaTitle,
  metaDescription,
}: {
  pageId: number;
  metaTitle: string;
  metaDescription: string;
}) => {
  const { data: markdown } = useQuery(blockQueries.getPageMarkdown(pageId));
  if (markdown === undefined) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
        <Spinner className="size-3.5" />
        Loading...
      </div>
    );
  }

  const frontmatterLines = ["---", `title: "${metaTitle}"`, `description: "${metaDescription}"`];
  frontmatterLines.push("---");

  const fullMarkdown = frontmatterLines.join("\n") + "\n\n" + (markdown ?? "");

  return <ShikiMarkdown code={fullMarkdown} />;
};

export { PageInfoSidebar };
