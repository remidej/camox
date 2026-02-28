import { mutation } from "./_generated/server";
import { generateNKeysBetween } from "fractional-indexing";

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

    const existingProjects = await ctx.db.query("projects").collect();
    for (const project of existingProjects) {
      await ctx.db.delete(project._id);
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

    // Create homepage
    const homepageId = await ctx.db.insert("pages", {
      projectId,
      pathSegment: "",
      fullPath: "/",
      nickname: "Home",
      metaTitle: "Camox - Websites you'll love to maintain",
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
        title: "Websites you'll love to maintain",
        description:
          "Meet Camox, the web toolkit designed for developers, LLMs and content editors.",
        cta: { type: "external", text: "Start building", href: "/", newTab: false },
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
        title: "Platform performance",
        subtitle: "Built for modern web development",
        description:
          "Camox empowers developers to build and deploy websites with unprecedented speed and flexibility. Our platform handles millions of page views and serves content globally with enterprise-grade reliability.",
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
      4
    );

    // Create statistics repeatableItems
    await ctx.db.insert("repeatableItems", {
      blockId: statisticsBlockId,
      fieldName: "statistics",
      content: {
        number: "100M+",
        label: "pages served monthly across all projects.",
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
        number: "99.9%",
        label: "uptime with global CDN infrastructure.",
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
        number: "50+",
        label: "countries served worldwide.",
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
        number: "10ms",
        label: "average response time for content delivery.",
      },
      summary: "10ms response time",
      position: statPos3,
      createdAt: now,
      updatedAt: now,
    });

    // Generate positions for studio page blocks
    const [studioPos0, studioPos1, studioPos2] = generateNKeysBetween(
      null,
      null,
      3
    );

    // Create studio page
    const studioPageId = await ctx.db.insert("pages", {
      projectId,
      pathSegment: "studio-ui",
      fullPath: "/studio-ui",
      nickname: "Studio",
      metaTitle: "Camox Studio - Edit Within Your Website",
      metaDescription:
        "Discover the power of Camox Studio: edit content directly within your website with instant feedback and real-time collaboration.",
      createdAt: now,
      updatedAt: now,
    });

    // Create hero block for Studio page
    await ctx.db.insert("blocks", {
      pageId: studioPageId,
      type: "hero",
      content: {
        title: "Studio: Edit Within Your Website",
        description:
          "Experience the future of web content management with Camox Studio. Edit directly on your live website with instant feedback and real-time collaboration.",
        cta: { type: "external", text: "Try Studio Now", href: "/", newTab: false },
      },
      summary: "Camox Studio hero",
            position: studioPos0,
      createdAt: now,
      updatedAt: now,
    });

    // Create statistics block to showcase Studio benefits
    const studioStatisticsBlockId = await ctx.db.insert("blocks", {
      pageId: studioPageId,
      type: "statistics",
      content: {
        title: "Why Choose Camox Studio?",
        subtitle: "The modern way to manage website content",
        description:
          "Edit your website content without leaving your live site. See changes instantly, collaborate in real-time, and maintain consistency across your entire project.",
      },
      summary: "Camox Studio statistics",
            position: studioPos1,
      createdAt: now,
      updatedAt: now,
    });

    // Generate positions for statistics items
    const [studioStatPos0, studioStatPos1, studioStatPos2] =
      generateNKeysBetween(null, null, 3);

    // Create statistics items showcasing Studio features
    await ctx.db.insert("repeatableItems", {
      blockId: studioStatisticsBlockId,
      fieldName: "statistics",
      content: {
        number: "Edit Within",
        label: "your website - no more context switching.",
      },
      summary: "Contained editing",
      position: studioStatPos0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("repeatableItems", {
      blockId: studioStatisticsBlockId,
      fieldName: "statistics",
      content: {
        number: "Instant",
        label: "feedback - see changes as you type.",
      },
      summary: "Instant feedback",
      position: studioStatPos1,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("repeatableItems", {
      blockId: studioStatisticsBlockId,
      fieldName: "statistics",
      content: {
        number: "Real-Time",
        label: "collaboration with your entire team.",
      },
      summary: "Live collaboration",
      position: studioStatPos2,
      createdAt: now,
      updatedAt: now,
    });

    // Create testimonial block
    await ctx.db.insert("blocks", {
      pageId: studioPageId,
      type: "testimonial",
      content: {
        quote:
          "Camox Studio changed how we manage our website. Editing within the site itself saves us hours every week.",
        author: "Alex Johnson",
        title: "Content Manager",
        company: "Modern Web Co.",
      },
      summary: "Alex Johnson testimonial",
            position: studioPos2,
      createdAt: now,
      updatedAt: now,
    });

    console.log("Website seeded successfully!");
    return {
      success: true,
      message: "Homepage and studio page created",
      projectId,
      homepageId,
      studioPageId,
    };
  },
});
