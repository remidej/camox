# The API bridges old SDKs only until every project is upgraded

Every project's Worker renders its pages by calling the API, and it deploys separately from the API, so a breaking API change would take down every project still serving an older SDK. Camox owns every project's code, so it moves projects forward instead of keeping old API shapes alive. When a change breaks the contract, the API first accepts both the old and the new shape. The SDK is then published, and a job bumps every project to it as soon as it is published. The API drops the old shape once no project serves an older SDK. Compatibility is a short bridge, not a promise to older SDKs, so it doesn't hold development back ([Keeping projects working across API upgrades](https://github.com/remidej/camox/issues/441)).

## Considered Options

- **A deadline.** The API keeps an old shape for a set time, then drops it. A project nobody got to in time goes down for its visitors.
- **Old API versions running side by side.** Heavy, and database migrations would break the old versions anyway.

## Consequences

- A project serves the SDK of its last successful release, and the release records the `camox` version, so "who still needs the old shape" is a query.
- The SDK is published only after the API that supports it is deployed.
- Breaking changes are marked with `!` in their commits, so release-please flags them. Nothing checks this automatically yet.
- A project the upgrade job can't build stays on its SDK and holds the old shape in place until Rémi fixes it by hand. Nothing changes a project's code automatically.
- Developers who deploy Camox sites themselves are no longer supported, and get no compatibility at all.
