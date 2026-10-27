# The sandbox each release step runs in. Its tag must match the `@cloudflare/sandbox` version
# that `@cloudflare/ci` depends on, which talks to the server inside it.
FROM docker.io/cloudflare/sandbox:0.12.1

# Projects install with pnpm. pnpm then switches to the version a project's `packageManager` names.
RUN npm install --global pnpm@11.1.3

# Revisions are type checked with native tsrs, pinned here rather than in projects' package.json
# (spec #560). Bump it on purpose: a new version can report new errors.
RUN npm install --global tsrs@0.18.0-ts7.1.0-dev.20260929

# A draft with code builds its revisions in /opt/camox/website (src/domains/revisions/sandbox.ts),
# which starts out holding the Template's install, so a new sandbox skips `pnpm install` for a
# project whose lockfile is the Template's, as every project's is until it diverges, and installs
# only what changed otherwise. `template/` holds the files of `template-default` that the install
# reads, fetched at deploy (fetch-template.mjs); without them, the image holds no install. The
# digest says which lockfile is installed, as the sandbox checks it. Releases don't use it, and it
# stays out of /workspace, which `@cloudflare/ci` snapshots after each release step.
COPY template/ /opt/camox/website/
RUN cd /opt/camox/website \
  && if [ -f pnpm-lock.yaml ]; then \
    CI=1 pnpm install --frozen-lockfile \
    && printf %s "$(sha256sum pnpm-lock.yaml | cut -c1-64)" > node_modules/.camox-installed-lockfile; \
  fi \
  && find . -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
