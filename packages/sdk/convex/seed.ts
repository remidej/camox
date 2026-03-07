import { mutation } from "./_generated/server";
import { generateNKeysBetween } from "fractional-indexing";
import { plainTextToLexicalState } from "../src/core/lib/lexicalState";

/**
 * Seed script to populate the database with initial homepage and blocks
 * Run this once to set up the initial data
 */
export const seedWebsite = mutation({
  args: {},
  handler: async (ctx) => {
    // Delete all pre-existing blocks, pages, repeatable items, and projects
    const existingPages = await ctx.db.query("pages").collect();
    for (const page of existingPages) {
      await ctx.db.delete(page._id);
    }

    const existingBlocks = await ctx.db.query("blocks").collect();
    for (const block of existingBlocks) {
      await ctx.db.delete(block._id);
    }

    const existingItems = await ctx.db.query("repeatableItems").collect();
    for (const item of existingItems) {
      await ctx.db.delete(item._id);
    }

    const existingFiles = await ctx.db.query("files").collect();
    for (const file of existingFiles) {
      await ctx.db.delete(file._id);
    }

    const existingProjects = await ctx.db.query("projects").collect();
    for (const project of existingProjects) {
      await ctx.db.delete(project._id);
    }

    const existingLayouts = await ctx.db.query("layouts").collect();
    for (const tmpl of existingLayouts) {
      await ctx.db.delete(tmpl._id);
    }

    const existingBlockDefinitions = await ctx.db
      .query("blockDefinitions")
      .collect();
    for (const def of existingBlockDefinitions) {
      await ctx.db.delete(def._id);
    }

    const now = Date.now();

    // Create project
    const projectId = await ctx.db.insert("projects", {
      name: "Camox Demo",
      description: "Demo website showcasing Camox features",
      domain: "demo.camox.dev",
      createdAt: now,
      updatedAt: now,
    });

    // Generate fractional index positions for two blocks
    const [pos0, pos1] = generateNKeysBetween(null, null, 2);

    // Create landing-page layout
    const layoutId = await ctx.db.insert("layouts", {
      projectId,
      layoutId: "landing-page",
      createdAt: now,
      updatedAt: now,
    });

    const [tplPos0, tplPos1] = generateNKeysBetween(null, null, 2);

    // Navbar block (before)
    await ctx.db.insert("blocks", {
      layoutId,
      type: "navbar",
      content: {
        title: { type: "external", text: "Acme", href: "/", newTab: false },
        cta: { type: "external", text: "Get Started", href: "#", newTab: false },
      },
      settings: { floating: true },
      placement: "before",
      summary: "navbar",
      position: tplPos0,
      createdAt: now,
      updatedAt: now,
    });

    // Footer block (after)
    await ctx.db.insert("blocks", {
      layoutId,
      type: "footer",
      content: {
        title: plainTextToLexicalState("Acme"),
      },
      placement: "after",
      summary: "footer",
      position: tplPos1,
      createdAt: now,
      updatedAt: now,
    });

    // Create homepage
    const homepageId = await ctx.db.insert("pages", {
      projectId,
      pathSegment: "",
      fullPath: "/",
      layoutId,
      metaTitle: "The website framework for agents",
      metaDescription:
        "Meet Camox, the web toolkit designed for developers, LLMs and content editors.",
      createdAt: now,
      updatedAt: now,
    });

    // Create hero block
    await ctx.db.insert("blocks", {
      pageId: homepageId,
      type: "hero",
      content: {
        title: plainTextToLexicalState("Websites you'll love to maintain"),
        description: plainTextToLexicalState(
          "Meet Camox, the web toolkit designed for developers, LLMs and content editors.",
        ),
        cta: {
          type: "external",
          text: "Start building",
          href: "/",
          newTab: false,
        },
      },
      summary: "Camox benefits",
      position: pos0,
      createdAt: now,
      updatedAt: now,
    });

    // Create statistics block
    const statisticsBlockId = await ctx.db.insert("blocks", {
      pageId: homepageId,
      type: "statistics",
      content: {
        title: plainTextToLexicalState("Platform performance"),
        subtitle: plainTextToLexicalState("Built for modern web development"),
        description: plainTextToLexicalState(
          "Camox empowers developers to build and deploy websites with unprecedented speed and flexibility. Our platform handles millions of page views and serves content globally with enterprise-grade reliability.",
        ),
      },
      summary: "Camox platform statistics",
      position: pos1,
      createdAt: now,
      updatedAt: now,
    });

    // Generate positions for statistics items
    const [statPos0, statPos1, statPos2, statPos3] = generateNKeysBetween(
      null,
      null,
      4,
    );

    // Create statistics repeatableItems
    await ctx.db.insert("repeatableItems", {
      blockId: statisticsBlockId,
      fieldName: "statistics",
      content: {
        number: plainTextToLexicalState("100M+"),
        label: plainTextToLexicalState("pages served monthly across all projects."),
      },
      summary: "100M pages served",
      position: statPos0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("repeatableItems", {
      blockId: statisticsBlockId,
      fieldName: "statistics",
      content: {
        number: plainTextToLexicalState("99.9%"),
        label: plainTextToLexicalState("uptime with global CDN infrastructure."),
      },
      summary: "99.9% uptime",
      position: statPos1,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("repeatableItems", {
      blockId: statisticsBlockId,
      fieldName: "statistics",
      content: {
        number: plainTextToLexicalState("50+"),
        label: plainTextToLexicalState("countries served worldwide."),
      },
      summary: "50+ countries served",
      position: statPos2,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("repeatableItems", {
      blockId: statisticsBlockId,
      fieldName: "statistics",
      content: {
        number: plainTextToLexicalState("10ms"),
        label: plainTextToLexicalState("average response time for content delivery."),
      },
      summary: "10ms response time",
      position: statPos3,
      createdAt: now,
      updatedAt: now,
    });

    console.log("Website seeded successfully!");
    return {
      success: true,
      message: "Homepage created",
      projectId,
      homepageId,
    };
  },
});
