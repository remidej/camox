# Artifact Agents write artifact sources, in conversations of their own

Artifacts are where threads spend most: each change rewrote the whole source in the agent's output, its screenshots followed, and all of it stayed in the thread's transcript, read again on every later turn of a thread that can run for hours. Most of a thread with an artifact is tweaking it. So each artifact field, in each locale, gets an Artifact Agent: a Pi conversation of its own in the thread's Durable Object, beside the thread's root conversation, which outlives every request and remembers them all. The thread's agent hands it each change with `artifact`, and gets back a short answer, never the source. The Artifact Agent sees the source as the file `/artifact.html`, beside the website's code, and changes it with Pi's own `edit`, so a tweak costs the lines it changes, not the whole page. Editors still see one thread with one agent.

## Considered Options

- **A subagent per request.** It keeps sources out of the thread too, but every tweak starts over: it reads the source and the skill again, and doesn't know what earlier requests settled.
- **Forking the thread's conversation.** A fork carries the whole transcript into the Artifact Agent, and gets a prompt cache of its own anyway.
- **Sending the editor's messages straight to the Artifact Agent**, while they have the artifact selected. It saves the thread's agent a call per tweak, but that agent would then miss the exchange, and a message about something else would reach the wrong agent.
- **A tool editing artifact fields by text replacement.** Simpler than a file, but models already know `edit`, and its matching is Pi's.

## Consequences

- The thread's agent never reads a source: block and item reads show each as its title, and a write handing that placeholder back is refused. It places artifacts (definitions, blocks, Artifact Data) and leaves their sources to their Artifact Agents.
- `artifact` can end the turn on the Artifact Agent's answer, which editors and Connected Agents read as the agent's, with no call of the thread's agent to repeat it. It does only when the model asks, the call is its round's only one, and the turn changed no code, whose end builds and lints.
- An Artifact Agent works as the member whose run asked, in the thread's draft and its artifact's locale: its writes are content writes, checked and stored as editors' are, and the studio follows them. It writes its artifact's source alone, and only reads the code.
- Its instructions are the same for every artifact, so its cached prompt keeps across requests; which artifact it works on comes with each request. It runs on the thread's model.
- While it works, the studio shows its activity as the agent's. Stopping the run stops it. Its conversation ends with the thread.
