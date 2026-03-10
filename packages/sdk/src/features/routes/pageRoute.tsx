import { notFound } from "@tanstack/react-router";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { api } from "camox/_generated/api";
import { CamoxPreview, PageContent } from "../preview/CamoxPreview";
import type { CamoxApp } from "../../core/createApp";
import { ConvexHttpClient } from "convex/browser";

/* -------------------------------------------------------------------------------------------------
 * Helpers
 * -----------------------------------------------------------------------------------------------*/

export function parseQuality(part: string): number {
  const match = part.match(/;\s*q=([0-9.]+)/);
  return match ? parseFloat(match[1]) : 1;
}

export function prefersMarkdown(accept: string): boolean {
  let markdownQ = -1;
  let htmlQ = -1;
  for (const part of accept.split(",")) {
    const trimmed = part.trim();
    if (trimmed.startsWith("text/markdown")) {
      markdownQ = parseQuality(trimmed);
    } else if (trimmed.startsWith("text/html")) {
      htmlQ = parseQuality(trimmed);
    }
  }
  return markdownQ > 0 && markdownQ >= htmlQ;
}

/* -------------------------------------------------------------------------------------------------
 * Server functions
 * -----------------------------------------------------------------------------------------------*/

export const getOrigin = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const url = new URL(request.url);
  return url.origin;
});

/* -------------------------------------------------------------------------------------------------
 * Factories
 * -----------------------------------------------------------------------------------------------*/

export function createMarkdownMiddleware(convexUrl: string) {
  return createMiddleware().server(async ({ next, request }) => {
    const accept = request.headers.get("Accept") ?? "";
    if (prefersMarkdown(accept)) {
      const url = new URL(request.url);
      const client = new ConvexHttpClient(convexUrl);
      const page = await client.query(api.pages.getPage, {
        fullPath: url.pathname,
      });
      if (page) {
        const markdown = await client.query(api.blocks.getPageMarkdown, {
          pageId: page.page._id,
        });
        if (markdown) {
          throw new Response(markdown, {
            headers: { "Content-Type": "text/markdown; charset=utf-8" },
          });
        }
      }
    }
    return next();
  });
}

export function createPageLoader() {
  return async ({
    context,
    location,
  }: {
    context: { convexHttpClient: { query: ConvexHttpClient["query"] } };
    location: { pathname: string };
  }) => {
    const [page, origin] = await Promise.all([
      context.convexHttpClient.query(api.pages.getPage, {
        fullPath: location.pathname,
      }),
      getOrigin(),
    ]);

    if (!page) {
      throw notFound();
    }

    return { page, origin };
  };
}

export function createPageHead(camoxApp: CamoxApp) {
  return ({
    loaderData,
  }: {
    loaderData?: {
      page: NonNullable<typeof api.pages.getPage._returnType>;
      origin: string;
    };
  }) => {
    if (!loaderData) {
      return {};
    }

    const { page, origin } = loaderData;
    const pageMetaTitle = page.page.metaTitle ?? page.page.pathSegment;

    const meta: Array<Record<string, string>> = [];
    let title = pageMetaTitle;

    if (page.layout) {
      const layout = camoxApp.getLayoutById(page.layout.layoutId);
      if (layout) {
        title = layout.buildMetaTitle({
          pageMetaTitle,
          projectName: page.projectName,
          pageFullPath: page.page.fullPath,
        });
        meta.push({ title });
      }
    }

    if (page.page.metaDescription) {
      meta.push({ name: "description", content: page.page.metaDescription });
    }

    const ogImageParams = new URLSearchParams({
      ...(page.layout && { layoutId: page.layout.layoutId }),
      title: pageMetaTitle,
      ...(page.page.metaDescription && {
        description: page.page.metaDescription,
      }),
      ...(page.projectName && { projectName: page.projectName }),
    });
    const ogImageUrl = `${origin}/og?${ogImageParams.toString()}`;

    meta.push(
      { property: "og:title", content: title },
      { property: "og:image", content: ogImageUrl },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
    );

    if (page.page.metaDescription) {
      meta.push({
        property: "og:description",
        content: page.page.metaDescription,
      });
    }

    return { meta };
  };
}

/* -------------------------------------------------------------------------------------------------
 * Component
 * -----------------------------------------------------------------------------------------------*/

export const PageRouteComponent = ({
  page,
}: {
  page: NonNullable<typeof api.pages.getPage._returnType>;
}) => {
  return (
    <CamoxPreview>
      <PageContent page={page} />
    </CamoxPreview>
  );
};
