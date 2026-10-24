# The sandbox each release step runs in. Its tag must match the `@cloudflare/sandbox` version
# that `@cloudflare/ci` depends on, which talks to the server inside it.
FROM docker.io/cloudflare/sandbox:0.12.1

# Projects install with pnpm. pnpm then switches to the version a project's `packageManager` names.
RUN npm install --global pnpm@11.1.3

# Revisions are type checked with native tsrs, pinned here rather than in projects' package.json
# (spec #560). Bump it on purpose: a new version can report new errors.
RUN npm install --global tsrs@0.18.0-ts7.1.0-dev.20260929
