# The agent sees a draft through a look token

The agent's `look` tool screenshots a draft's pages and blocks in Browser Run's Chromium, so it can check what it designed and improve it within the turn ([Letting the agent see the code it changed](https://github.com/remidej/camox/issues/702)). The browser needs to read the draft's content. Until now, the only way in was a member's session (ADR 0011), and a Thread holds no session, only the editor's user ID. So the API signs a look token for each `look` call: read-only, for one project and one draft, valid for a couple of minutes. It's the only credential the lightweight document `look` loads accepts, and the SDK forwards it as it forwards a session when it reads the draft's content. It's the second way to read a draft without a session, after a publishing draft's.

## Considered Options

- **A real session for the run's editor, handed to the browser.** It needs no new trust path, but a session that can do anything the editor can would then live in a remote browser and its recordings, outlasting the call.
- **Route every request the browser makes through the API**, with Playwright's request interception, so nothing new is public. The revision still has to read the draft's content without a session, so this needs a session-free credential anyway, plus a round trip through the API for every asset.
- **Render without draft content**, only what code ships, such as a Block Definition's default content. Artifacts and placed blocks are content, and seeing them is half of why the agent looks.

## Consequences

- The lightweight document is public, but it answers only to a valid token. It has no studio, no live updates and no editing overlays. The draft's previewed revision serves it, or Live's code for a draft with no code changes.
- A token can only read, and only its own draft. Anything that would write, or read another draft or Live's private data, refuses it.
- The browser carries the token as a cookie for the website's host only, never in a URL or a header sent to every origin, so fonts and other third-party requests never see it.
- Live's code must forward the token, so `look` only works on drafts with no code changes once the SDK that forwards it has been released to Live. An Upgrade does that for every project.
