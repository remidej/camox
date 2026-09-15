# Comments

## Goal

Let people point at their website and give agents actionable feedback, without manually describing where something lives or how to find it.

The core loop is: browse → point → comment → ask an agent to apply feedback → review the result.

Comments should also support human collaboration as teams adopt Camox, without requiring a full collaboration suite at launch.

## Targets and context

Comments attach to specific Camox objects: pages, blocks, fields, and files. Their identity comes from the object, not a position on the screen.

An agent retrieving a comment should have enough context to identify the target, understand the feedback, and determine whether it still applies. This includes the relevant page and environment, the surrounding object context, and what the target looked like when the comment was posted compared with its current state.

Feedback can require content changes or code changes. Pointing at an object should support both kinds of intent.

## Preview UI

- A comment button in the preview toolbar activates a dedicated comment cursor.
- The cursor lets the user target a Camox object and write feedback in context.
- While edit mode is on, comments appear on the preview as collapsed comment bubbles, similar to Figma.
- Clicking a bubble expands its conversation.
- Comments also appear in the right sidebar when the relevant object is selected.

The exact sidebar aggregation rules, treatment of overlapping bubbles, and placement of page-level comments remain to be designed.

## Conversations

Use threads from the beginning, while calling them “comments” in the UI.

Each thread has one target, an initial message, flat chronological replies, and a shared resolution state. A preview bubble represents a thread rather than an individual reply.

Replies are useful even before team collaboration: an agent can explain its changes, and a human can clarify feedback or challenge the result without losing the original context.

Keep the first version minimal. Nested replies, mentions, notifications, reactions, assignments, and subscriptions are not required.

## Agent handoff

A **Send comments to agent** button in the left sidebar opens an agent comment handoff modal.

The modal is a prompt builder, not an automatic agent integration. It explains that the user needs to copy the prompt and give it to their agent to address the comments.

- An optional textbox lets the user add global context or instructions, similar to the overall comment on a pull request review.
- The generated prompt asks the agent to use the Camox skill to retrieve and address the comments, with enough scope information to identify the relevant project, environment, and comments.
- A **Copy prompt** CTA copies the handoff prompt, including the user's global context, ready to paste into their agent conversation.

Copying the prompt does not start agent work or change comment statuses. The exact default scope of the handoff remains to be decided and should be clear to the user in the modal.

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

## Scope and open questions

Prioritize the complete human-to-agent feedback loop over a full Figma-style collaboration system. Automatic agent execution, live collaboration, guest access, and advanced team features can come later.

Details still to settle:

- Whether all target types ship together, particularly file-level comments versus comments on individual uses of a file.
- How the sidebar includes comments on descendant objects.
- How shared objects communicate whether feedback concerns one use or all uses.
- How missing targets and differences between viewed versions are presented to humans.
- Whether visual evidence, such as screenshots and viewport dimensions, is included initially or added later.
