import { createBlock } from "camox/createBlock";
import { Play, SkipForward } from "lucide-react";
import { useRef, useState } from "react";

import { BlockContainer } from "@/components/BlockContainer";
import { Pill } from "@/components/Pill";

const youtubeDemo = createBlock({
  id: "youtube-demo",
  title: "YouTube Demo",
  description:
    "Use this block to embed a YouTube video with a title above it and a row of clickable chapters underneath. Each chapter has a title, short description, and timestamp; clicking a chapter seeks the embedded player to that moment. Good fit for product demo videos, walkthroughs, or tutorials where visitors should be able to jump straight to a specific section without leaving the page.",
  content: (field) => ({
    title: field.string({
      default: "Watch the demo",
      title: "Title",
    }),
    embed: field.embed({
      pattern: "https:\\/\\/(www\\.)?(youtube\\.com|youtu\\.be)\\/.+",
      default: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      title: "YouTube URL",
    }),
    facade: field.image({
      title: "Facade",
    }),
    chapters: field.repeater({
      content: (field) => ({
        timestamp: field.string({
          default: "0:00",
          title: "Timestamp (mm:ss or hh:mm:ss)",
          pattern: "^\\d{1,2}(:\\d{2}){1,2}$",
        }),
        title: field.string({
          default: "Getting started",
          title: "Chapter title",
        }),
        description: field.string({
          default: "A quick overview of the basics in under a minute.",
          title: "Chapter description",
        }),
      }),
      minItems: 1,
      maxItems: Infinity,
      title: "Chapters",
      toMarkdown: (c) => [`**${c.timestamp}** — ${c.title}: ${c.description}`],
    }),
  }),
  component: YoutubeDemoComponent,
  toMarkdown: (c) => [`# ${c.title}`, c.embed, c.chapters],
});

function parseTimestamp(text: string): number {
  const trimmed = text.trim();
  if (!/^\d{1,2}(:\d{2}){1,2}$/.test(trimmed)) return 0;
  const parts = trimmed.split(":").map((n) => Number.parseInt(n, 10));
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

function getYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    if (u.pathname.startsWith("/embed/")) {
      return u.pathname.slice("/embed/".length).split("/")[0] || null;
    }
    if (u.pathname.startsWith("/shorts/")) {
      return u.pathname.slice("/shorts/".length).split("/")[0] || null;
    }
    return null;
  } catch {
    return null;
  }
}

function YoutubeDemoComponent() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [startSeconds, setStartSeconds] = useState<number | null>(null);

  const playFrom = (seconds: number) => {
    if (startSeconds === null) {
      setStartSeconds(seconds);
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
      "*",
    );
    iframe.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: "playVideo", args: [] }),
      "*",
    );
  };

  return (
    <BlockContainer>
      <youtubeDemo.Field name="title">
        {(props) => <Pill {...props} className="mb-6" />}
      </youtubeDemo.Field>
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3 md:gap-8">
        <div className="bg-accent/30 border-accent relative overflow-hidden rounded-xl border md:col-span-2 md:col-start-2">
          {startSeconds === null ? (
            <div className="relative">
              <youtubeDemo.Image name="facade">
                {(props) => <img {...props} className="block aspect-video w-full object-cover" />}
              </youtubeDemo.Image>
              <button
                type="button"
                onClick={() => playFrom(0)}
                aria-label="Play video"
                className="group/play absolute inset-0 flex cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <span className="bg-primary flex size-20 items-center justify-center rounded-full shadow-2xl transition-transform group-hover/play:scale-105">
                  <Play className="text-primary-foreground size-10 translate-x-0.5 fill-current" />
                </span>
              </button>
            </div>
          ) : (
            <youtubeDemo.Embed name="embed">
              {(_props, { url }) => {
                const videoId = getYoutubeId(url);
                if (!videoId) return null;
                return (
                  <iframe
                    ref={iframeRef}
                    src={`https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&start=${startSeconds}&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&fs=1&disablekb=1&cc_load_policy=0`}
                    title="YouTube video player"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                    allowFullScreen
                    className="block aspect-video w-full border-0"
                  />
                );
              }}
            </youtubeDemo.Embed>
          )}
        </div>
        <div className="flex flex-col md:col-span-1 md:col-start-1 md:row-start-1 [&>:first-child_.connector-above]:bg-transparent [&>:last-child_.timeline-connector]:bg-transparent">
          <youtubeDemo.Repeater name="chapters">
            {(item) => {
              let timestampText = "0:00";
              const handleSeek = () => playFrom(parseTimestamp(timestampText));
              return (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={handleSeek}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleSeek();
                    }
                  }}
                  className="group/chapter relative cursor-pointer rounded-md pb-10 last:pb-0 focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  <div className="absolute top-0 bottom-0 left-3 z-10 flex w-2.5 flex-col items-center text-base">
                    <div
                      aria-hidden="true"
                      className="connector-above bg-muted-foreground/75 h-[calc(1rem+0.5lh-5px)] w-px shrink-0"
                    />
                    <div
                      aria-hidden="true"
                      className="border-muted-foreground/75 group-hover/chapter:bg-muted-foreground/75 size-2.5 shrink-0 rounded-full border-2 transition-colors group-hover/chapter:border-transparent"
                    />
                    <div
                      aria-hidden="true"
                      className="timeline-connector bg-muted-foreground/75 w-px flex-1"
                    />
                  </div>
                  <div className="group-hover/chapter:bg-accent/40 flex flex-col gap-1 rounded-md py-4 pr-3 pl-8 transition-colors">
                    <div className="flex items-center gap-2">
                      <item.Field name="title">
                        {(props) => (
                          <h3
                            {...props}
                            className="text-foreground text-base font-semibold tracking-tight"
                          />
                        )}
                      </item.Field>
                      <div className="border-muted-foreground/40 text-muted-foreground flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 opacity-0 transition-opacity group-hover/chapter:opacity-100">
                        <SkipForward aria-hidden="true" className="size-3.5 shrink-0" />
                        <item.Field name="timestamp">
                          {(props, { text }) => {
                            timestampText = text;
                            return (
                              <span
                                {...props}
                                className="text-xs leading-none font-medium tabular-nums"
                              />
                            );
                          }}
                        </item.Field>
                      </div>
                    </div>
                    <item.Field name="description">
                      {(props) => <p {...props} className="text-muted-foreground text-sm" />}
                    </item.Field>
                  </div>
                </div>
              );
            }}
          </youtubeDemo.Repeater>
        </div>
      </div>
    </BlockContainer>
  );
}

export { youtubeDemo as block };
