## Summary of Conclusions: Cloudflare Migration for Camox

### Current Architecture (Convex)

- **backend-management**: SaaS, always Camox-controlled. Handles auth, billing, AI proxying, sensitive keys. Multi-tenant.
- **backend-content**: In **dev**, each user runs their own Convex deployment. In **prod**, shared multi-tenant under Camox.
- A complex sync layer (`SYNC_SECRET`, `syncToContent.ts`, JWT validation) bridges the two backends.

### Target Architecture (Cloudflare)

**Merge into one backend.** The two-backend split was a Convex constraint, not a real requirement. Since both backends are yours in production, they can be one Worker + one D1.

```
PRODUCTION (Camox CF account):
  One CF Worker (Hono) → one D1 database (multi-tenant, projectId scoping)
  Routes: /api/auth/*, /api/content/*, /api/files/* (R2)
  All secrets (AI keys, etc.) via wrangler secret

DEVELOPMENT (user's machine):
  wrangler dev → local Worker + local D1 (SQLite) + local R2 (filesystem)
  No cloud deployment needed. No API keys needed.
  AI features call a thin proxy route on production, or are mocked.
```

### Key Tech Choices

- **Hono** for the Worker framework (routing, middleware)
- **Drizzle ORM** + **D1** (SQLite) for database
- **R2** for file storage (replaces Convex file storage)
- **Cloudflare Auth** (or Lucia/custom) replaces Convex auth
- **`wrangler dev`** replaces per-developer Convex deployments

### What Gets Eliminated

- `SYNC_SECRET` and all sync logic
- JWT validation between backends
- Two separate schemas/deployments
- Per-developer cloud provisioning for local dev

### Migration Strategy

1. Build one Drizzle schema merging management + content tables
2. Build one Hono Worker with all routes
3. `wrangler dev` for local dev, `pnpm db:seed` for dev data
4. Migrate data from Convex to D1 (export → transform → import)

### Open Question (not yet resolved)

How local dev handles AI features that need API keys the user doesn't have — options are a production proxy route or mocking. We hadn't finalized this.
