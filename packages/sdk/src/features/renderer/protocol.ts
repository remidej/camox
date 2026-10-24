import type { InvalidationMessage, QueryKey } from "@camox/api-contract/query-keys";

import { version } from "../../../package.json";
import type { ContentEdit } from "../../core/editing/contentEdits";
import type { RepeatableItemSeed } from "../../core/editing/createEditableBlock";
import type { LocaleView } from "../../lib/locale-path";
import type { ViewLocale } from "../../lib/view-locale-context";
import type { EditingOwner } from "../preview/previewStore";

/**
 * The renderer frame's protocol (ADR 0023): how the studio and the renderer frame, a hidden
 * frame of the Website Section running the shown draft's code, talk across their documents.
 *
 * - The renderer renders the pages, into slots of the visible frames the studio gives it. The
 *   studio keeps everything else: its sidebars, overlays, Canvas, and every store's truth.
 * - Each side delivers the other plain-data messages, one at a time and in order, never inside
 *   the sender's call: an error thrown handling one stays on the receiving side.
 * - Both documents share the site's origin. Two kinds of value cross as same-origin handles
 *   rather than data: the slot a frame renders into, and an element the renderer asks the studio
 *   to reveal. Everything else could be cloned.
 *
 * Connecting: the studio sets a {@link StudioHandle} on the renderer frame's element, under
 * {@link STUDIO_HANDLE_KEY}, before the frame loads. The renderer document finds it on its
 * `frameElement`, connects, and says `hello`. The studio answers `welcome`, then sends every
 * store's state and every frame, and keeps them current from then on.
 *
 * Versions: `hello` and `welcome` each carry the SDK version their side was built with, and only
 * sides of the same version go on: there is no compatibility layer. On a mismatch, the studio
 * sends nothing more, and its frames say they're updating, until a revision built with its
 * version loads another renderer. So `hello` and `welcome` keep their shape across versions.
 *
 * The caches (the riskiest piece of the split): each document keeps its own query cache, and the
 * renderer only ever fills its own, through its own reads (`/_camox/data`, `/_camox/routes`, and
 * the API). One renderer shows one draft; moving to another loads another renderer document, with
 * a cache of its own, except for a draft the studio's first content write starts, which the
 * renderer enters as the studio does (`draftStarted`). The studio keeps it current with three
 * messages, each applied with the same studio cache code the studio runs:
 * - `invalidate`: a project room invalidation that reaches the renderer's draft (Live's, or its
 *   own), as the studio's cache received it. The renderer's cache refetches the same keys.
 * - `write`: a value the studio wrote to a read in the renderer's draft: an optimistic change, its
 *   rollback, or a write's answer. The renderer takes it only for reads it holds.
 * - `outdated`: reads the studio marked outdated, as its writes settle. The renderer refetches
 *   those it holds, its own way.
 * Keys match across documents because both build them from the same reads catalog; the SDK
 * version check is what guarantees it.
 *
 * Editing in place: the renderer's block components never write content. Each edit they make
 * crosses as an `edit`, which the studio writes once, with its own draft-scoped mutations (a
 * write on Live starts a draft, which the renderer then enters), and answers `edited`. What the
 * write changes in the studio's cache reaches the renderer as `write` and `outdated`.
 *
 * Definition code: the studio's document runs none of the site's code. What only a definition's
 * functions know, the studio asks the renderer, which runs the shown draft's code: an `ask` with
 * a {@link RendererQuestion}, answered `answer`, by the renderer connected at the time. A question
 * still unanswered when another renderer connects is asked of it. Block thumbnails are rendered
 * by the renderer, into a slot of the thumbnail's frame (`thumbnail`), as pages are.
 */

/** Bumped when the messages change shape. A renderer of another protocol doesn't connect. */
export const RENDERER_PROTOCOL = 1;

/** The SDK version this side of the protocol was built with. Both sides must share it. */
export const SDK_VERSION: string = version;

/** The property of the renderer frame's element that holds the studio's {@link StudioHandle}. */
export const STUDIO_HANDLE_KEY = "__camoxStudio";

/** The runtime route that serves the renderer document. */
export const RENDERER_DOCUMENT_PATH = "/_camox/renderer";

/** What one side calls to deliver the other a message. */
export type Inbox<Message> = (message: Message) => void;

/** What the studio leaves on the renderer frame's element, for the renderer to connect with. */
export interface StudioHandle {
  /** Connects the renderer, which receives through `renderer`. Returns the studio's inbox. */
  connect(renderer: Inbox<StudioMessage>): Inbox<RendererMessage>;
}

/**
 * One visible frame the renderer fills. Its slot, an element of the frame's document, is where
 * the page renders; the rest says which page, and how it is edited there.
 */
export interface RendererFrameTarget {
  /** The page's path, as the runtime reads it at `/_camox/data`. */
  pathname: string;
  /** Where the page renders: its links and the location it reads resolve against it. */
  href: string;
  /** The derived layout whose page this is, if any. */
  derivedLayoutId?: string;
  /** The Page or Layout the frame edits. */
  owner: EditingOwner | null;
  /** The locale the frame shows. */
  locale: ViewLocale | null;
  /** Whether the frame offers editing in place: the Preview, or the selected Canvas Page. */
  editable: boolean;
  /** Whether its artifacts run. */
  artifactsRun: boolean;
  /** What its artifacts are told of the studio, when the frame overrides it. */
  artifactStudio: { editing: boolean; canvas: boolean } | null;
  /** A resting Canvas frame keeps its content and state, hidden, with its effects stopped. */
  resting: boolean;
  /** Set on the Canvas: the workspace the frame shows in. */
  canvas: { workspaceKey: string } | null;
}

/** The page a curated layout's `toTitle` titles. */
export interface TitledPage {
  fullPath: string;
  nickname: string;
  metaTitle?: string | null;
  metaDescription?: string | null;
  firstPublishedAt?: number | null;
  publishedAt?: number | null;
}

/** What the studio asks of the renderer: anything only the draft's definition code knows. */
export type RendererQuestion =
  /** What a new block of `blockType` starts with. */
  | { type: "initialBundle"; blockType: string }
  /** The title the curated layout `layoutId` gives `page`, in `locale`. */
  | {
      type: "pageTitle";
      layoutId: string;
      page: TitledPage;
      projectName: string;
      locale: LocaleView;
    };

/** A new block's content, settings and repeatable items, as its definition builds them. */
export interface InitialBundle {
  content: Record<string, unknown>;
  settings: Record<string, unknown>;
  repeatableItems: RepeatableItemSeed[];
}

/** What the renderer answers each question with: `null` when the draft's code doesn't know it. */
export interface RendererAnswers {
  initialBundle: InitialBundle | null;
  pageTitle: string | null;
}

/** The answer to `Question`. */
export type RendererAnswer<Question extends RendererQuestion> = RendererAnswers[Question["type"]];

/** The stores whose state the studio owns, and the renderer mirrors. */
export type MirroredStore = "preview" | "canvas";

/** The stores whose events the renderer forwards to the studio, which applies them. */
export type ForwardedStore = "preview" | "referencePickerFocus";

/** An event of one of the studio's stores. */
export type StoreEvent = { type: string; [key: string]: unknown };

/** What the studio tells the renderer. */
export type StudioMessage =
  | { type: "welcome"; protocol: number; sdkVersion: string }
  | {
      type: "frame";
      frameId: string;
      /** A same-origin handle: the element of a visible frame's document the page renders in. */
      slot: HTMLElement;
      target: RendererFrameTarget;
    }
  | { type: "frameEnd"; frameId: string }
  | { type: "store"; store: MirroredStore; context: unknown }
  /**
   * The studio moved to another draft without reloading the renderer: only a draft its first
   * content write started, which starts from what Live showed.
   */
  | { type: "draftStarted"; draftId: string }
  | { type: "invalidate"; message: InvalidationMessage; projectId: number }
  /** The studio wrote a read, optimistically or not. Without `value`, the read is forgotten. */
  | { type: "write"; queryKey: QueryKey; value?: unknown }
  /** The studio marked reads outdated, as its writes settle. */
  | { type: "outdated"; queryKeys: QueryKey[] }
  /** The edit the renderer sent under `editId` was written, or with `error`, couldn't be. */
  | { type: "edited"; editId: number; error?: string }
  /** A question for the draft's code. The renderer answers `answer`, with the same `askId`. */
  | { type: "ask"; askId: number; question: RendererQuestion }
  /**
   * Has the renderer render a thumbnail of a `blockType` block into `slot`, a same-origin handle
   * in the thumbnail's frame, until `thumbnailEnd`.
   */
  | { type: "thumbnail"; thumbnailId: string; slot: HTMLElement; blockType: string }
  | { type: "thumbnailEnd"; thumbnailId: string };

/** What the renderer tells the studio. */
export type RendererMessage =
  | { type: "hello"; protocol: number; sdkVersion: string }
  | { type: "storeEvent"; store: ForwardedStore; event: StoreEvent }
  /** The frame's page committed, and after each change it settled again. */
  | { type: "rendered"; frameId: string }
  /** The frame's page threw while rendering, and shows that it failed. */
  | { type: "error"; frameId: string; message: string }
  /** The page navigated. The studio follows it, unless the frame never navigates. */
  | { type: "navigate"; frameId: string; to: string }
  /** A block wants into view. `element` is a same-origin handle inside the frame's slot. */
  | { type: "reveal"; frameId: string; element: Element; immediate: boolean }
  /** An edit made in place, for the studio to write. The studio answers `edited`. */
  | { type: "edit"; editId: number; edit: ContentEdit }
  /** The answer to the studio's question `askId`, or with `error`, why there is none. */
  | { type: "answer"; askId: number; value?: unknown; error?: string };

/**
 * An inbox that handles each message later, in order, apart from the call that delivered it: the
 * sender never runs the receiver's code, and never sees its errors. `onError` hears them.
 */
export function deferredInbox<Message>(
  handle: (message: Message) => void,
  onError: (error: unknown) => void = (error) =>
    console.error("Camox: the renderer frame's protocol failed to handle a message.", error),
): Inbox<Message> {
  const queue: Message[] = [];
  let scheduled = false;
  const drain = () => {
    scheduled = false;
    for (const message of queue.splice(0)) {
      try {
        handle(message);
      } catch (error) {
        onError(error);
      }
    }
  };
  return (message) => {
    queue.push(message);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(drain);
  };
}
