# The sandbox a publish with code uploads and promotes a project's Worker in
# (src/domains/publishes/README.md). It runs wrangler on a revision's build and nothing else: no
# install, no build, no project code. Its tag must match the `@cloudflare/sandbox` version the
# API drives it with.
FROM docker.io/cloudflare/sandbox:0.12.1

# The API's own wrangler version (apps/api/package.json).
RUN npm install --global wrangler@4.151.0
