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
  controls: boolean;
  showCaptions: boolean;
  rel: boolean;
  fullscreen: boolean;
}

function getYouTubeEmbedUrl(url: string, params: YouTubeParams): string {
  const videoId = extractVideoId(url);
  if (!videoId) return url;

  const searchParams = new URLSearchParams();

  if (params.autoplay) searchParams.set("autoplay", "1");
  if (params.mute) searchParams.set("mute", "1");
  if (!params.controls) searchParams.set("controls", "0");
  if (params.showCaptions) searchParams.set("cc_load_policy", "1");
  if (!params.rel) searchParams.set("rel", "0");
  if (!params.fullscreen) searchParams.set("fs", "0");
  searchParams.set("disablekb", "1");

  const query = searchParams.toString();
  return `https://www.youtube.com/embed/${videoId}${query ? `?${query}` : ""}`;
}

function YouTubeVideoComponent() {
  const fullWidth = youtubeVideo.useSetting("fullWidth");
  const theme = youtubeVideo.useSetting("theme");
  const autoplay = youtubeVideo.useSetting("autoplay");
  const mute = youtubeVideo.useSetting("mute");
  const controls = youtubeVideo.useSetting("controls");
  const showCaptions = youtubeVideo.useSetting("showCaptions");
  const rel = youtubeVideo.useSetting("rel");
  const fullscreen = youtubeVideo.useSetting("fullscreen");

  const params: YouTubeParams = {
    autoplay,
    mute,
    controls,
    showCaptions,
    rel,
    fullscreen,
  };

  return (
    <section className={cn(theme === "dark" ? "dark" : "light")}>
      <div className={cn("bg-background", !fullWidth && "py-12")}>
        <div className={cn(!fullWidth && "container mx-auto px-4")}>
          <youtubeVideo.Embed name="url">
            {(_props, { url }) => (
              <div
                className={cn(
                  "relative w-full",
                  !fullWidth && "overflow-hidden rounded-lg shadow-lg",
                )}
                style={{ paddingBottom: "56.25%" }}
              >
                <iframe
                  src={getYouTubeEmbedUrl(url, params)}
                  title="YouTube video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen={fullscreen}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    border: 0,
                  }}
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
