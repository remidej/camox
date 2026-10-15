# Managing Environments with the Camox CLI

Read [cli-common.md](cli-common.md) first for `{{CAMOX_CMD}}`, help verification, and the dev-first workflow.

Every command works in the current developer's development draft. No command reads or writes Live: changes reach the public site only when the developer publishes the draft from the studio.

## Replicate an entire Environment

Use the `env` group when the user wants to copy all dev content to production or replace dev with production. Do not emulate replication with a series of resource commands.

Inspect compatibility first:

```sh
{{CAMOX_CMD}} env check
```

`env check` reports push and pull compatibility and identifies Block Definition or Layout divergences. Resolve every reported divergence before replication; incompatible replication fails with `FAILED_PRECONDITION` and the same reasons.

After explicit user authorization for the requested direction:

```sh
{{CAMOX_CMD}} env push --yes # replace production with dev
{{CAMOX_CMD}} env pull --yes # replace dev with production
```

Both operations replace every Page, Block, and file in the target Environment and cannot be undone. They require `--yes` or `-y`. Confirm the direction from the user's request; never infer push versus pull.
