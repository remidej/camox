# Comments

## Goal

Let people point at their website and give agents actionable feedback, without manually describing where something lives or how to find it.

The core loop is: browse → point → comment → ask an agent to apply feedback → review the result.

Comments should also support human collaboration as teams adopt Camox, without requiring a full collaboration suite at launch.

## Targets and context

Comments attach to blocks and fields. Their identity comes from the object, not a position on the screen. Page-level comments are deferred.

Threads exist within an environment. Comments can only be created on draft content, not live content.

Each thread preserves an immutable creation snapshot, its originating page, and its target identity. An agent retrieving a comment should have enough context to identify the target, understand the feedback, and determine whether it still applies. This includes the relevant page and environment, the surrounding object context, and what the target looked like when the comment was posted compared with its current state.

Feedback can require content changes or code changes. Pointing at an object should support both kinds of intent.

## Preview UI

- A comment button in the preview toolbar activates a dedicated comment cursor. The toolbar does not render when viewing live content, so comment creation is available only on drafts.
- The cursor lets the user target a Camox object and write feedback in context.
- While edit mode is on, comments appear on the preview as collapsed comment bubbles, similar to Figma.
- Clicking a bubble expands its conversation.
- Writing and viewing comments happens only in the preview for now. Sidebar comment interfaces are deferred.

Overlapping bubbles are offset, and an in-preview comments menu provides access to every thread, including targets not currently visible. Resolved comments are hidden by default and can be shown with a filter.

## Conversations

Use threads from the beginning, while calling them “comments” in the UI.

Each thread has one target, an initial message, flat chronological replies, and a shared resolution state. A preview bubble represents a thread rather than an individual reply.

Replies are useful even before team collaboration: an agent can explain its changes, and a human can clarify feedback or challenge the result without losing the original context.

Keep the first version minimal. Nested replies, mentions, notifications, reactions, assignments, and subscriptions are not required.

## Agent handoff

A **Send comments to agent** button in the left sidebar opens an agent comment handoff modal.

The modal is a prompt builder, not an automatic agent integration. It explains that the user needs to copy the prompt and give it to their agent to address the comments.

- An optional textbox lets the user add global context or instructions, similar to the overall comment on a pull request review.
- Handoff is scoped to the current page within its environment, including only open threads. The prompt captures explicit thread IDs so later comments do not silently expand its scope.
- The generated prompt asks the agent to use the Camox skill to retrieve and address that page's comments, with enough scope information to identify the relevant project, environment, page, and comments.
- A **Copy prompt** CTA copies the handoff prompt, including the user's global context, ready to paste into their agent conversation.

Copying the prompt does not start agent work or change comment statuses. The modal clearly identifies the page and environment included in the handoff.

## Applying comments with agents

Agents retrieve and act on comments through the CLI. Guidance for applying comments belongs in its own reference file under the existing umbrella Camox skill, rather than a separate skill.

When asked to apply comments, the agent should:

1. Establish the requested scope, such as a page, environment, or specific comments.
2. Read the feedback, conversation history, target, and relevant context.
3. Check whether the target is obsolete or meaningfully different from when the feedback was posted.
4. Apply feedback that is still relevant, using the existing Camox guidance for content and code changes.
5. Verify the result, explain what changed, and resolve the thread when it believes the request has been satisfied.

Freshness is a judgment about meaning, not simply whether a timestamp or value changed. Feedback may remain valid after edits, or become obsolete because of broader design changes.

If the request is already satisfied, the agent can explain that and resolve it. If the target is missing, the intent is unclear, or feedback conflicts, it should seek clarification rather than guess or silently close the conversation. Applying comments does not authorize publishing unless the human requests it.

## Resolution and reopening

Use a simple open/resolved lifecycle. There is no mandatory human approval stage before resolution: the agent should automatically resolve a thread when it believes it has completed the work.

Resolution preserves the conversation and target context; it does not delete the comment. The agent should leave a reply describing what it did and any verification limits. Resolved threads remain accessible for review.

Humans and agents can reopen threads. If a human challenges an agent’s assessment, the agent should reopen the original thread and continue there, preserving the previous attempt rather than creating a disconnected comment.

## Scope and implementation choices

Prioritize the complete human-to-agent feedback loop over a full Figma-style collaboration system. Automatic agent execution, live collaboration, guest access, and advanced team features can come later.

Initial implementation:

- Comments are available on persisted Camox pages in the desktop editing experience, including tablet/mobile viewport previews. Derived routes without a Camox page record are not yet supported.
- Field targeting uses block ID, optional stable repeater item ID, and field name. Clicking targets the field; Alt-clicking targets its containing block.
- Creation snapshots preserve draft block content/settings, repeater items, the block definition, originating page details, and surrounding block identities. Screenshots and viewport capture are deferred.
- Shared-object threads remain scoped to their originating page. The conversation warns that edits may affect other uses; ambiguous one-use versus all-uses feedback requires clarification.
- Missing targets retain their conversations and immutable snapshots, without silently retargeting replacement objects. Conversations expose creation and current draft context for comparison.
- All project organization members can read, create, reply, resolve, and reopen. Message editing/deletion is not included. Authenticated identity and client source are preserved; CLI replies are labeled as coming via the CLI, not a separately authenticated agent identity.
- Status changes append an explanation atomically with the change. Comments are not published, checkpointed, or replicated between environments. Deleting a target preserves its comments; deliberately deleting the entire project removes them.
- The CLI exposes `comments list`, `get`, `reply`, `resolve`, and `reopen`, with an explicit `--environment` option for handoffs. Agent guidance lives in `packages/sdk/skills/camox/references/comments.md`.

Database setup requires migration `apps/api/migrations/0022_open_gamora.sql` before using the feature.
