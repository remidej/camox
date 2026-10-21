import * as React from "react";

import { useProjectUuid } from "../../lib/auth";
import { parseLocalePath } from "../../lib/locale-path";
import { reads, useReadQueries, useReadQuery } from "../../lib/studio-reads";
import { useLocalizedPath } from "../../lib/view-locale";
import { useViewLocale } from "../../lib/view-locale-context";
import { type CanvasPage, canvasPageId, getCanvasPages } from "../canvas/canvasPages";
import { selectedCanvasPage } from "../canvas/canvasSelection";
import { useDiscoveredPreviewPaths } from "../canvas/useDiscoveredPreviewPaths";
import { useLocation, useNavigate } from "../navigation/navigation";
import { useCamoxApp } from "../provider/components/CamoxAppContext";
import {
  createFollowAgent,
  type FollowAgent,
  type FollowPage,
  type FollowWhere,
} from "./followAgent";
import { FollowAgentContext, type StudioFollow } from "./followAgentContext";
import { blockCatalogPath } from "./routes";

const NO_BLOCK_IDS: readonly string[] = [];

/**
 * The blocks of the Page the editor is on, top to bottom, its Layout's included, as far as they
 * are loaded: following locates the agent's touches on the page it's on, which is also where it
 * arrives.
 */
function useCurrentPageBlocks(page: CanvasPage | undefined, path: string) {
  const projectUuid = useProjectUuid();
  const pageId = canvasPageId(page);
  const layoutId = page && page.kind !== "curated" ? page.layoutId : undefined;
  const { data: pageStructure } = useReadQuery(reads.pageStructure({ path, projectUuid }), {
    enabled: !!pageId,
  });
  const { data: layout } = useReadQuery(
    reads.layoutStructure({ projectUuid, layoutId: layoutId ?? "" }),
    { enabled: !!layoutId },
  );
  const structure = pageId
    ? pageStructure?.page.id === pageId
      ? { layout: pageStructure.layout, blockIds: pageStructure.page.blockIds }
      : undefined
    : layoutId && layout
      ? { layout, blockIds: NO_BLOCK_IDS }
      : undefined;
  const ids = structure
    ? [
        ...(structure.layout?.beforeBlockIds ?? NO_BLOCK_IDS),
        ...structure.blockIds,
        ...(structure.layout?.afterBlockIds ?? NO_BLOCK_IDS),
      ]
    : NO_BLOCK_IDS;
  const blocks = useReadQueries(ids.map((id) => reads.blockBundle(id)));
  const loaded = structure
    ? ids.flatMap((id, index) => {
        const type = blocks[index]?.data?.block.type;
        return type ? [{ id, type }] : [];
      })
    : undefined;
  // The same blocks give the same list, so following only hears of actual changes.
  const json = JSON.stringify(loaded ?? null);
  return React.useMemo(
    () => (JSON.parse(json) as FollowPage["blocks"] | null) ?? undefined,
    [json],
  );
}

/** Where the editor is, and the Studio content following locates the agent's touches with. */
function useFollowWhere(runtimeBasePath: string): FollowWhere {
  const app = useCamoxApp();
  const projectUuid = useProjectUuid();
  const location = useLocation();
  const { locale, locales } = useViewLocale();
  const localized = useLocalizedPath();
  const { data: project } = useReadQuery(reads.project({ projectUuid: projectUuid }));
  const { data: pageList } = useReadQuery(reads.pageList({ projectUuid }), {
    enabled: !!project,
  });
  const discoveredPaths = useDiscoveredPreviewPaths(runtimeBasePath);
  const canvasPages = React.useMemo(
    () => (pageList ? getCanvasPages(pageList, app.getLayouts(), discoveredPaths, locale) : []),
    [pageList, app, discoveredPaths, locale],
  );
  const current = selectedCanvasPage(canvasPages, app.getLayouts(), location.pathname, locales);
  const blocks = useCurrentPageBlocks(current, parseLocalePath(location.pathname, locales).path);
  const pages = React.useMemo(() => {
    const layoutOf = new Map(pageList?.map((page) => [page.id, page.layoutId]));
    return canvasPages.flatMap((page): FollowPage[] => {
      const layoutId = page.kind === "curated" ? layoutOf.get(page.pageId) : page.layoutId;
      if (!layoutId) return [];
      return [
        {
          key: page.key,
          pathname: page.pathname,
          owner:
            page.kind === "curated"
              ? { kind: "page", pageId: page.pageId }
              : { kind: "layout", layoutId: page.layoutId },
          layoutId,
          ...(page.key === current?.key && blocks ? { blocks } : {}),
        },
      ];
    });
  }, [canvasPages, pageList, current?.key, blocks]);
  const { pathname, search, source } = location;
  return React.useMemo(
    () => ({
      pages,
      locale: locale.tag,
      location: { pathname, search, source },
      pageKey: current?.key ?? null,
      blockCatalogPath: (type) => localized(blockCatalogPath(type)),
    }),
    [pages, locale.tag, pathname, search, source, current?.key, localized],
  );
}

/**
 * Follows the agent for the Studio session, across its pages and into the draft its Live thread
 * starts: the Canvas or the Preview goes where the editor's runs write. Only the Website Section
 * follows; elsewhere in the Studio, the editor stays where they are.
 */
export function FollowAgentProvider({
  runtimeBasePath,
  website,
  children,
}: {
  runtimeBasePath: string;
  /** Whether the Studio shows the Website Section, as the Canvas or the Preview. */
  website: boolean;
  children: React.ReactNode;
}) {
  const where = useFollowWhere(runtimeBasePath);
  const navigate = useNavigate();
  const latest = React.useRef({ navigate, where });
  React.useLayoutEffect(() => {
    latest.current = { navigate, where };
  });
  const [follow, setFollow] = React.useState<FollowAgent | null>(null);
  React.useEffect(() => {
    const created = createFollowAgent({
      navigate: (options) => latest.current.navigate(options),
      where: latest.current.where,
    });
    // oxlint-disable-next-line react/set-state-in-effect -- the module lives as long as the Studio session
    setFollow(created);
    return () => created.dispose();
  }, []);
  React.useEffect(() => {
    follow?.update(where);
  }, [follow, where]);
  const value = React.useMemo<StudioFollow | null>(
    () =>
      follow && {
        receive: (batch) => {
          if (website) follow.receive(batch);
        },
        resume: () => follow.resume(),
        takeOver: () => follow.takeOver(),
      },
    [follow, website],
  );
  return <FollowAgentContext value={value}>{children}</FollowAgentContext>;
}
