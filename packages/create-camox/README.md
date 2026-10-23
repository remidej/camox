# create-camox

`npm create camox` no longer creates projects. Create a [Camox](https://camox.ai) project from the dashboard at [app.camox.ai](https://app.camox.ai), which sets up and hosts its website.

## Why does this package exist?

This is a thin wrapper around `@camox/cli init`, which now only points to the dashboard. It's kept so that `npm create camox` says where projects are created instead of failing to resolve.
