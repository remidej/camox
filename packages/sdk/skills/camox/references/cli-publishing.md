# Publishing with the Camox CLI

Read [cli-common.md](cli-common.md) first for `{{CAMOX_CMD}}`, help verification, and the dev-first workflow.

Every command works in the current developer's development draft. Its changes reach Live, the public site, only when the draft is published. Agents in parallel worktrees share their developer's development draft, so publishing or deleting it covers all of their changes.

Don't publish or delete unless the user asks you to.

```sh
{{CAMOX_CMD}} status                   # whether the development draft exists, and how many changes it holds
{{CAMOX_CMD}} publish                  # what publishing would do, with a token
{{CAMOX_CMD}} publish --confirm TOKEN  # publish the whole draft to Live
{{CAMOX_CMD}} delete --yes            # empty the development draft; Live is untouched
```

`publish` lists, in order:

- **Blockers**: problems to fix in the draft before it can be published, such as an empty required reference or a page without a meta title. Definitions that differ from Live's are blockers too: local code changed a block, layout, or collection, and only a release can ship it to Live. Don't try to fix those through content; tell the user a release is needed.
- **Conflicts**: content Live changed or deleted since the draft changed it, with who published it and when. Publishing overwrites Live's version.
- **Lost changes**: changes publishing drops because what they belong to is gone.
- **Warnings**: the same problems already on Live. They don't block.
- **Changes**: everything the draft creates, changes, or deletes.

Show the user the list, especially conflicts and lost changes, and get their confirmation before passing the token to `publish --confirm`. If Live changed since the list was printed, nothing is published: the command prints the new list with a new token and fails with `CONFLICTS_CHANGED`. Review the new list with the user before confirming again.

After publishing, the development draft stays open and empty. `delete` empties it without publishing and can't be undone; it requires `--yes` when not run in a terminal.
