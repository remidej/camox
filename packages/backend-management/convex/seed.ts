import { hashPassword } from "better-auth/crypto";

import { components } from "./_generated/api";
import { internalMutation } from "./functions";

export const seedProjects = internalMutation({
  args: {},
  handler: async (ctx) => {
    const existingProjects = await ctx.db.query("projects").collect();
    for (const project of existingProjects) {
      await ctx.db.delete(project._id);
    }

    const paginationOpts = { cursor: null, numItems: 100 };
    const authModels = [
      "invitation",
      "member",
      "session",
      "account",
      "organization",
      "user",
    ] as const;
    for (const model of authModels) {
      await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
        input: { model },
        paginationOpts,
      });
    }

    const now = Date.now();

    const org = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "organization",
        data: {
          name: "Camox Demo",
          slug: "camox-demo",
          createdAt: now,
        },
      },
    });

    const devEmail = "dev@camox.dev";
    const devPassword = "camox-dev-123";

    const user = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: "Dev User",
          email: devEmail,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    const hashedPassword = await hashPassword(devPassword);
    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          accountId: user._id,
          providerId: "credential",
          userId: user._id,
          password: hashedPassword,
          createdAt: now,
          updatedAt: now,
        },
      },
    });

    await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "member",
        data: {
          organizationId: org._id,
          userId: user._id,
          role: "owner",
          createdAt: now,
        },
      },
    });

    const projectId = await ctx.db.insert("projects", {
      slug: "camox-demo-01",
      name: "Camox Demo",
      domain: "demo.camox.dev",
      organizationSlug: "camox-demo",
      createdAt: now,
      updatedAt: now,
    });

    console.log("Management seeded successfully!");
    console.log(`Dev user credentials — email: ${devEmail}, password: ${devPassword}`);
    return { success: true, projectId };
  },
});
