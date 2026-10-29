// What Camox tells Connected Agents about working with it (ADR 0030): business context is
// theirs to bring, and they say what to change and why, never how. Written for a marketer's AI,
// with no internal Camox concepts. Expected to be tuned once real requests show where Connected
// Agents skimp.

/** The server's instructions' paragraphs on how to work with Camox, for every member. */
export const WORKING_WITH_CAMOX = `Camox runs this member's website. Camox's agent does the work on it: it writes the content, the code and the styles, and checks the result. It knows the website, but nothing about the business behind it beyond what's already published. **That knowledge is yours to bring.**

Before you start a draft, gather what the change depends on from everything you can reach: product docs, specs, the member's notes, their codebase. Put it in your message: the facts and claims to make, who it's for, what sets it apart, links to sources, and URLs of images to use. Camox's agent writes only from what you give it and what's already on the site. Given too little, it can only produce slop. If something it needs isn't in your reach, ask the member rather than leave Camox to guess.

Say what to change and why, never how to build it. After each turn, give the member the studio link: they review and publish there.`;

/** The description of the `message` that starts a draft or continues one. */
export const MESSAGE_DESCRIPTION =
  "The request, and all the context it depends on that Camox can't know: product facts and claims, audience, sources, image URLs. You're the only source of business knowledge Camox has, so be thorough. Leave out what doesn't apply.";
