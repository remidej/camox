import type { OldExport, Row } from "./migrate";

/**
 * A hand-written export of the old database, shaped like `wrangler d1 export` rows: snake_case
 * columns, integer ids, JSON as text. Project 1 is the one migrated; project 2 is another
 * project, and project 3 belongs to an organization that no longer exists.
 */

const t = 1_780_000_000_000;

function snapshotBlock(block: Partial<Row> & { id: number; type: string }): Row {
  return {
    pageId: null,
    layoutId: null,
    content: {},
    settings: null,
    summary: "",
    position: "a0",
    createdAt: t,
    updatedAt: t,
    slot: null,
    ...block,
  };
}

function snapshotItem(
  item: Partial<Row> & { id: number; blockId: number; fieldName: string },
): Row {
  return {
    parentItemId: null,
    content: {},
    settings: null,
    summary: "",
    position: "a0",
    createdAt: t,
    updatedAt: t,
    ...item,
  };
}

function page(row: Partial<Row> & { id: number; environment_id: number }): Row {
  return {
    project_id: 1,
    path_segment: "",
    full_path: "/",
    parent_page_id: null,
    layout_id: 5,
    meta_title: null,
    meta_description: null,
    ai_seo_enabled: null,
    created_at: t,
    updated_at: t,
    custom_og_image_blob_id: null,
    custom_og_image_url: null,
    live_published_checkpoint_id: null,
    content_updated_at: t,
    nickname: null,
    created_by_id: "user-1",
    ...row,
  };
}

function file(row: Partial<Row> & { id: number; environment_id: number }): Row {
  return {
    project_id: 1,
    url: `https://api.camox.dev/files/serve/1/${row.id}.png`,
    alt: "",
    filename: `${row.id}.png`,
    mime_type: "image/png",
    size: 100,
    optimized_size: null,
    blob_id: `blob-${row.id}`,
    path: `1/${row.id}.png`,
    ai_metadata_enabled: null,
    created_at: t,
    updated_at: t,
    ...row,
  };
}

function blockDefinition(
  row: Partial<Row> & { id: number; environment_id: number; block_id: string },
): Row {
  return {
    project_id: 1,
    title: row.block_id,
    description: "",
    content_schema: JSON.stringify({ type: "object", properties: {} }),
    settings_schema: null,
    layout_only: null,
    created_at: t,
    updated_at: t,
    default_content: null,
    default_settings: null,
    synced: 0,
    synced_published_data: null,
    ...row,
  };
}

const homeSnapshot = {
  page: { id: 100, fullPath: "/old-home-path", metaTitle: "Old snapshot title" },
  blocks: [
    snapshotBlock({
      id: 1000,
      pageId: 100,
      type: "hero",
      summary: "A hero",
      content: {
        title: "Welcome",
        image: { _fileId: 300 },
        gallery: [{ _fileId: 301 }, { _fileId: 399 }],
        cta: { type: "page", pageId: 101, text: "About" },
        broken: { type: "page", pageId: 102, text: "Unpublished" },
        body: JSON.stringify({
          root: {
            children: [
              { type: "link", url: "camox:page:101" },
              { type: "link", url: "camox:page:999" },
            ],
          },
        }),
      },
    }),
    snapshotBlock({ id: 1001, pageId: 100, type: "navbar", position: "a1" }),
  ],
  repeatableItems: [
    snapshotItem({
      id: 2000,
      blockId: 1000,
      fieldName: "features",
      summary: "First feature",
      content: { title: "Fast", icon: { _fileId: 300 } },
    }),
    snapshotItem({
      id: 2001,
      blockId: 1000,
      parentItemId: 2000,
      fieldName: "points",
      content: { title: "Very fast" },
    }),
    // The navbar placement's own items: Live shows the synced definition's published items.
    snapshotItem({ id: 2002, blockId: 1001, fieldName: "links", content: { label: "Stale" } }),
  ],
};

const aboutSnapshot = {
  page: { id: 101 },
  blocks: [snapshotBlock({ id: 1010, pageId: 101, type: "hero", content: { title: "About us" } })],
  repeatableItems: [],
};

const layoutSnapshot = {
  layout: { id: 5 },
  blocks: [
    snapshotBlock({ id: 1100, layoutId: 5, type: "footer", slot: "after", content: { c: "©" } }),
  ],
  repeatableItems: [],
};

const navbarPublished = {
  block: snapshotBlock({
    id: 1001,
    pageId: 100,
    type: "navbar",
    summary: "The navbar",
    content: { logo: { _fileId: 300 } },
    settings: { sticky: true },
  }),
  items: [
    snapshotItem({
      id: 2100,
      blockId: 1001,
      fieldName: "links",
      summary: "Home link",
      content: { link: { type: "page", pageId: 100, text: "Home" } },
    }),
    // Live rendered items in this order, whatever their positions said.
    snapshotItem({
      id: 2101,
      blockId: 1001,
      fieldName: "socials",
      position: "a1",
      content: { label: "First" },
    }),
    snapshotItem({
      id: 2102,
      blockId: 1001,
      fieldName: "socials",
      position: "a0",
      content: { label: "Second" },
    }),
  ],
};

export function oldExport(): OldExport {
  return {
    user: [
      {
        id: "user-1",
        name: "Ada",
        email: "ada@example.com",
        emailVerified: 1,
        image: null,
        createdAt: t,
        updatedAt: t,
      },
    ],
    account: [
      {
        id: "account-1",
        accountId: "a",
        providerId: "github",
        userId: "user-1",
        accessToken: null,
        refreshToken: null,
        idToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        scope: null,
        password: null,
        createdAt: t,
        updatedAt: t,
      },
    ],
    session: [
      {
        id: "session-1",
        expiresAt: t,
        token: "token-1",
        ipAddress: null,
        userAgent: null,
        userId: "user-1",
        activeOrganizationId: "org-1",
        createdAt: t,
        updatedAt: t,
      },
    ],
    verification: [],
    organization: [
      { id: "org-1", name: "Org", slug: "org", logo: null, metadata: null, createdAt: t },
    ],
    member: [
      { id: "member-1", organizationId: "org-1", userId: "user-1", role: "owner", createdAt: t },
    ],
    invitation: [],
    projects: [
      {
        id: 1,
        slug: "landing",
        name: "Landing",
        created_at: t,
        updated_at: t,
        deploy_token: "deploy-1",
        organization_id: "org-1",
      },
      {
        id: 2,
        slug: "other",
        name: "Other",
        created_at: t,
        updated_at: t,
        deploy_token: "deploy-2",
        organization_id: "org-1",
      },
      {
        id: 3,
        slug: "orphan",
        name: "Orphan",
        created_at: t,
        updated_at: t,
        deploy_token: "deploy-3",
        organization_id: "org-gone",
      },
    ],
    environments: [
      { id: 10, project_id: 1, name: "production", type: "production" },
      { id: 11, project_id: 1, name: "dev:ada@example.com", type: "development" },
      { id: 20, project_id: 2, name: "production", type: "production" },
    ],
    layouts: [
      {
        id: 5,
        project_id: 1,
        layout_id: "regular-page",
        description: "Regular",
        created_at: t,
        updated_at: t,
        environment_id: 10,
        live_published_checkpoint_id: 59,
        content_updated_at: t,
        kind: "curated",
      },
      {
        id: 6,
        project_id: 1,
        layout_id: "regular-page",
        description: "Regular",
        created_at: t,
        updated_at: t,
        environment_id: 11,
        live_published_checkpoint_id: null,
        content_updated_at: null,
        kind: "curated",
      },
    ],
    layout_checkpoints: [
      {
        id: 59, // Checkpoint ids repeat across the page and layout tables.
        layout_id: 5,
        kind: "auto-publish",
        snapshot: JSON.stringify(layoutSnapshot),
        created_at: t + 5,
        created_by: "user-1",
      },
    ],
    pages: [
      page({
        id: 100,
        environment_id: 10,
        nickname: "Home",
        meta_title: "Home title",
        meta_description: "Home description",
        ai_seo_enabled: null,
        live_published_checkpoint_id: 60,
      }),
      page({
        id: 101,
        environment_id: 10,
        path_segment: "about",
        full_path: "/about",
        parent_page_id: 100,
        nickname: "About",
        meta_title: "About title",
        meta_description: "About description",
        ai_seo_enabled: 0,
        live_published_checkpoint_id: 61,
      }),
      page({
        id: 102,
        environment_id: 10,
        path_segment: "unpublished",
        full_path: "/unpublished",
        nickname: "Unpublished",
      }),
      page({ id: 110, environment_id: 11, nickname: "Dev home", live_published_checkpoint_id: 62 }),
    ],
    page_checkpoints: [
      {
        id: 59,
        page_id: 100,
        kind: "auto-publish",
        // An earlier publication: not Live anymore.
        snapshot: JSON.stringify({
          page: { id: 100 },
          blocks: [snapshotBlock({ id: 990, pageId: 100, type: "hero" })],
          repeatableItems: [],
        }),
        created_at: t + 1,
        created_by: "user-1",
      },
      {
        id: 60,
        page_id: 100,
        kind: "auto-publish",
        snapshot: JSON.stringify(homeSnapshot),
        created_at: t + 2,
        created_by: "user-1",
      },
      {
        id: 61,
        page_id: 101,
        kind: "auto-publish",
        snapshot: JSON.stringify(aboutSnapshot),
        created_at: t + 3,
        created_by: "user-1",
      },
      {
        id: 62,
        page_id: 110,
        kind: "auto-publish",
        snapshot: JSON.stringify({
          page: { id: 110 },
          blocks: [snapshotBlock({ id: 1200, pageId: 110, type: "hero" })],
          repeatableItems: [],
        }),
        created_at: t + 4,
        created_by: "user-1",
      },
    ],
    // Unpublished edits: the current blocks table is never read.
    blocks: [
      {
        id: 1000,
        page_id: 100,
        layout_id: null,
        type: "hero",
        content: JSON.stringify({ title: "Unpublished edit" }),
        settings: null,
        slot: null,
        summary: "",
        position: "a0",
        created_at: t,
        updated_at: t,
      },
    ],
    repeatable_items: [],
    block_definitions: [
      blockDefinition({ id: 40, environment_id: 10, block_id: "hero" }),
      blockDefinition({
        id: 41,
        environment_id: 10,
        block_id: "navbar",
        synced: 1,
        synced_published_data: JSON.stringify(navbarPublished),
      }),
      blockDefinition({ id: 42, environment_id: 10, block_id: "footer", layout_only: 1 }),
      blockDefinition({ id: 43, environment_id: 11, block_id: "hero" }),
      blockDefinition({ id: 44, environment_id: 20, project_id: 2, block_id: "hero" }),
    ],
    collection_definitions: [],
    collection_records: [],
    files: [
      file({ id: 300, environment_id: 10, alt: "Logo", filename: "logo.png" }),
      file({
        id: 301,
        environment_id: 10,
        alt: "Manual alt",
        filename: "manual.png",
        ai_metadata_enabled: 0,
      }),
      file({ id: 302, environment_id: 11 }),
    ],
    comments: [
      // Anchored to a Live block: survives, with its target's ids rewritten.
      {
        id: "comment-block",
        environment_id: 10,
        page_id: 100,
        block_id: null,
        item_id: null,
        target: JSON.stringify({ kind: "block-field", blockId: 1000, fieldName: "title" }),
        message: "Shorter?",
        author_id: "user-1",
        created_at: t,
        resolved: 0,
      },
      // Anchored to a Live item.
      {
        id: "comment-item",
        environment_id: 10,
        page_id: 100,
        block_id: 1000,
        item_id: 2000,
        target: JSON.stringify({
          kind: "item-field",
          blockId: 1000,
          itemId: 2000,
          fieldName: "title",
        }),
        message: "Typo",
        author_id: "user-1",
        created_at: t,
        resolved: 1,
      },
      // On a page that was never published: dropped.
      {
        id: "comment-unpublished-page",
        environment_id: 10,
        page_id: 102,
        block_id: null,
        item_id: null,
        target: null,
        message: "Draft page",
        author_id: "user-1",
        created_at: t,
        resolved: 0,
      },
      // On a block that only exists as an unpublished edit: dropped.
      {
        id: "comment-unpublished-block",
        environment_id: 10,
        page_id: 100,
        block_id: null,
        item_id: null,
        target: JSON.stringify({ kind: "block-field", blockId: 1999, fieldName: "title" }),
        message: "Gone",
        author_id: "user-1",
        created_at: t,
        resolved: 0,
      },
      // In a development environment: dropped.
      {
        id: "comment-dev",
        environment_id: 11,
        page_id: 110,
        block_id: null,
        item_id: null,
        target: null,
        message: "Dev",
        author_id: "user-1",
        created_at: t,
        resolved: 0,
      },
    ],
  };
}
