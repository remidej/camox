import { Type, createBlock } from "camox/createBlock";
import { cn } from "@/lib/utils";

const youtubeVideo = createBlock({
  id: "youtube-video",
  title: "YouTube Video",
  description:
    "Embeds a YouTube video. Use this block to display a single YouTube video on a page.",
  content: {
    url: Type.Embed({
      pattern:
        "https:\\/\\/(www\\.)?(youtube\\.com\\/(watch\\?v=|embed\\/|shorts\\/)|youtu\\.be\\/).+",
      default: "https://www.youtube.com/watch?v=A3PDXmYoF5U",
      title: "YouTube URL",
    }),
  },
  settings: {
    fullWidth: Type.Boolean({
      default: false,
      title: "Full Width",
    }),
    theme: Type.Enum({
      options: {
        light: "Light",
        dark: "Dark",
      },
      default: "light",
      title: "Theme",
    }),
  },
  component: YouTubeVideoComponent,
});

function getYouTubeEmbedUrl(url: string): string {
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/);
  if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;

  const shortsMatch = url.match(/youtube\.com\/shorts\/([^?&]+)/);
  if (shortsMatch) return `https://www.youtube.com/embed/${shortsMatch[1]}`;

  const watchMatch = url.match(/[?&]v=([^&]+)/);
  if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;

  const embedMatch = url.match(/youtube\.com\/embed\/([^?&]+)/);
  if (embedMatch) return `https://www.youtube.com/embed/${embedMatch[1]}`;

  return url;
}

function YouTubeVideoComponent() {
  const fullWidth = youtubeVideo.useSetting("fullWidth");
  const theme = youtubeVideo.useSetting("theme");

  return (
    <section className={cn(theme === "dark" ? "dark" : "light")}>
      <div className={cn("bg-background", !fullWidth && "py-12")}>
        <div className={cn(!fullWidth && "container mx-auto px-4")}>
          <youtubeVideo.Embed name="url">
            {(url) => (
              <div
                className={cn(
                  "relative w-full aspect-video",
                  !fullWidth && "rounded-lg overflow-hidden shadow-lg",
                )}
              >
                <iframe
                  src={getYouTubeEmbedUrl(url)}
                  title="YouTube video"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
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
