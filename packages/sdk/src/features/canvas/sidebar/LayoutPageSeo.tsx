import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Spinner } from "@camox/ui/spinner";
import { Textarea } from "@camox/ui/textarea";
import * as React from "react";

import { useProjectUuid } from "../../../lib/auth";
import { useOptionalDraftScope } from "../../../lib/draft-scope";
import { reads, useReadQuery } from "../../../lib/studio-reads";
import { useLocation } from "../../navigation/navigation";
import { pageImageUrl } from "../../og/pageImage";
import {
  PageDiscoverabilityButtons,
  PageMarkdownSheetFrame,
  PageSeoSheetFrame,
  SearchEnginePreview,
  SocialPreviewCard,
  SocialPreviewImage,
} from "../../preview/components/PageInfo";
import { ShikiMarkdown } from "../../preview/components/ShikiMarkdown";
import type { PageHead } from "../../routes/pageRuntime";

/** The singleton or derived page a layout page's SEO reads, at the path the Canvas shows. */
export interface LayoutPageTarget {
  runtimeBasePath: string;
  /** The derived layout a derived page's frame renders; none for a singleton page. */
  derivedLayoutId?: string;
}

/**
 * A layout page's SEO metadata and Markdown. Its layout's code builds both, so editors read them
 * here rather than edit them.
 */
export function LayoutPageSeo({ target }: { target: LayoutPageTarget }) {
  const [isSeoSheetOpen, setIsSeoSheetOpen] = React.useState(false);
  const [isMarkdownSheetOpen, setIsMarkdownSheetOpen] = React.useState(false);
  return (
    <>
      <PageDiscoverabilityButtons
        metadataLabel="View page metadata"
        onOpenMetadata={() => setIsSeoSheetOpen(true)}
        onOpenMarkdown={() => setIsMarkdownSheetOpen(true)}
      />
      <PageSeoSheetFrame open={isSeoSheetOpen} onOpenChange={setIsSeoSheetOpen}>
        <LayoutPageSeoContent target={target} />
      </PageSeoSheetFrame>
      <PageMarkdownSheetFrame open={isMarkdownSheetOpen} onOpenChange={setIsMarkdownSheetOpen}>
        <LayoutPageMarkdown target={target} />
      </PageMarkdownSheetFrame>
    </>
  );
}

/** The title and description a page's head names. */
export function headMetadata(head: unknown): { title: string; description: string } {
  const meta = (head as PageHead | null | undefined)?.meta ?? [];
  return {
    title: meta.find((entry) => entry.title !== undefined)?.title ?? "",
    description: meta.find((entry) => entry.name === "description")?.content ?? "",
  };
}

function Loading() {
  return (
    <div className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
      <Spinner className="size-3.5" />
      Loading...
    </div>
  );
}

function LayoutPageSeoContent({ target }: { target: LayoutPageTarget }) {
  const projectUuid = useProjectUuid();
  const { pathname } = useLocation();
  const { scope } = useOptionalDraftScope();
  // The page's frame reads the same render, with the head its layout's code builds.
  const { data: render, error } = useReadQuery(
    reads.canvasFrame({ projectUuid, pathname, ...target }),
  );
  if (error) return <p role="alert">{error.message}</p>;
  if (!render) return <Loading />;
  const { title, description } = headMetadata(render.head);
  // `/og` renders the page in the draft the studio views. `v` only fetches it again on a retitle.
  const version = new URLSearchParams({ v: `${title}|${description}` });
  const image = `${pageImageUrl({ origin: "", path: pathname })}&${version.toString()}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="layout-page-title">Page title</Label>
        <Input id="layout-page-title" value={title} readOnly />
      </div>
      <div className="space-y-2">
        <Label htmlFor="layout-page-description">Page description</Label>
        <Textarea
          id="layout-page-description"
          value={description}
          placeholder="No description"
          rows={2}
          readOnly
        />
      </div>
      <SearchEnginePreview path={pathname} metaTitle={title} metaDescription={description} />
      <div className="space-y-2 pt-2">
        <Label>Social preview</Label>
        <SocialPreviewCard
          image={<SocialPreviewImage src={scope?.hrefFor(image) ?? image} />}
          metaTitle={title}
          metaDescription={description}
          url={`${origin}${pathname}`}
        />
      </div>
    </div>
  );
}

function LayoutPageMarkdown({ target }: { target: LayoutPageTarget }) {
  const projectUuid = useProjectUuid();
  const { pathname } = useLocation();
  const { data: markdown, error } = useReadQuery(
    reads.layoutPageMarkdown({ projectUuid, runtimeBasePath: target.runtimeBasePath, pathname }),
  );
  if (error) return <p role="alert">{error.message}</p>;
  if (markdown === undefined) return <Loading />;
  if (markdown === null)
    return (
      <Alert>
        <AlertTitle>No Markdown for this page</AlertTitle>
        <AlertDescription>
          AI agents read this page’s HTML. Its layout can serve them Markdown by declaring{" "}
          <code>toMarkdown</code> in code.
        </AlertDescription>
      </Alert>
    );
  return <ShikiMarkdown code={markdown} />;
}
