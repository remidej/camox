import { createBlock } from "camox/createBlock";

import { cn } from "@/lib/utils";

const youtubeVideo = createBlock({
  id: "youtube-video",
  title: "YouTube Video",
  description:
    "Embeds a YouTube video. Use this block to display a single YouTube video on a page. Don't try to guess the URL, use a web search tool to find a specific video URL instead.",
  content: (field) => ({
    url: field.embed({
      pattern:
        "https:\\/\\/(www\\.)?(youtube\\.com\\/(watch\\?v=|embed\\/|shorts\\/)|youtu\\.be\\/).+",
      default: "https://www.youtube.com/watch?v=-W_nFlIAWFM",
      title: "YouTube URL",
    }),
  }),
  settings: (setting) => ({
    fullWidth: setting.boolean({
      default: false,
      title: "Full Width",
    }),
    theme: setting.enum({
      options: {
        light: "Light",
        dark: "Dark",
      },
      default: "light",
      title: "Theme",
    }),
    autoplay: setting.boolean({
      default: false,
      title: "Autoplay",
    }),
    mute: setting.boolean({
      default: false,
      title: "Mute",
    }),
    loop: setting.boolean({
      default: false,
      title: "Loop",
    }),
    controls: setting.boolean({
      default: true,
      title: "Controls",
    }),
    showCaptions: setting.boolean({
      default: false,
      title: "Show Captions",
    }),
    rel: setting.boolean({
      default: false,
      title: "Related Videos",
    }),
    fullscreen: setting.boolean({
      default: true,
      title: "Fullscreen",
    }),
    progressBarColor: setting.enum({
      options: {
        red: "Red",
        white: "White",
      },
      default: "red",
      title: "Progress Bar Color",
    }),
    keyboard: setting.boolean({
      default: true,
      title: "Keyboard Controls",
    }),
  }),
  component: YouTubeVideoComponent,
  toMarkdown: (c) => [c.url],
});

function extractVideoId(url: string): string | null {
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (shortMatch) return shortMatch[1];

  const shortsMatch = url.match(/youtube\.com\/shorts\/([^?&]+)/);
  if (shortsMatch) return shortsMatch[1];

  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) return watchMatch[1];

  const embedMatch = url.match(/youtube\.com\/embed\/([^?&]+)/);
  if (embedMatch) return embedMatch[1];

  return null;
}

interface YouTubeParams {
  autoplay: boolean;
  mute: boolean;
  loop: boolean;
  controls: boolean;
  showCaptions: boolean;
  rel: boolean;
  fullscreen: boolean;
  progressBarColor: string;
  keyboard: boolean;
}

function getYouTubeEmbedUrl(url: string, params: YouTubeParams): string {
  const videoId = extractVideoId(url);
  if (!videoId) return url;

  const searchParams = new URLSearchParams();

  if (params.autoplay) searchParams.set("autoplay", "1");
  if (params.mute) searchParams.set("mute", "1");
  if (params.loop) {
    searchParams.set("loop", "1");
    searchParams.set("playlist", videoId);
  }
  if (!params.controls) searchParams.set("controls", "0");
  if (params.showCaptions) searchParams.set("cc_load_policy", "1");
  if (!params.rel) searchParams.set("rel", "0");
  if (!params.fullscreen) searchParams.set("fs", "0");
  if (params.progressBarColor !== "red") searchParams.set("color", params.progressBarColor);
  if (!params.keyboard) searchParams.set("disablekb", "1");

  const query = searchParams.toString();
  return `https://www.youtube.com/embed/${videoId}${query ? `?${query}` : ""}`;
}

function YouTubeVideoComponent() {
  const fullWidth = youtubeVideo.useSetting("fullWidth");
  const theme = youtubeVideo.useSetting("theme");
  const autoplay = youtubeVideo.useSetting("autoplay");
  const mute = youtubeVideo.useSetting("mute");
  const loop = youtubeVideo.useSetting("loop");
  const controls = youtubeVideo.useSetting("controls");
  const showCaptions = youtubeVideo.useSetting("showCaptions");
  const rel = youtubeVideo.useSetting("rel");
  const fullscreen = youtubeVideo.useSetting("fullscreen");
  const progressBarColor = youtubeVideo.useSetting("progressBarColor");
  const keyboard = youtubeVideo.useSetting("keyboard");

  const params: YouTubeParams = {
    autoplay,
    mute,
    loop,
    controls,
    showCaptions,
    rel,
    fullscreen,
    progressBarColor,
    keyboard,
  };

  return (
    <section className={cn(theme === "dark" ? "dark" : "light")}>
      <div className={cn("bg-background", !fullWidth && "py-12")}>
        <div className={cn(!fullWidth && "container mx-auto px-4")}>
          <youtubeVideo.Embed name="url">
            {(_props, { url }) => (
              <div
                className={cn(
                  "relative w-full aspect-video",
                  !fullWidth && "rounded-lg overflow-hidden shadow-lg",
                )}
              >
                <iframe
                  src={getYouTubeEmbedUrl(url, params)}
                  title="YouTube video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen={fullscreen}
                  className="absolute inset-0 h-full w-full"
                />
              </div>
            )}
          </youtubeVideo.Embed>
        </div>
      </div>
    </section>
  );
}

export { youtubeVideo as block };
