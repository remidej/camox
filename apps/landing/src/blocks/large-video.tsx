import { createBlock } from "camox/createBlock";

import { BlockContainer } from "@/components/BlockContainer";
import { Pill } from "@/components/Pill";

const largeVideo = createBlock({
  id: "large-video",
  title: "Large Video",
  description:
    "Use this block to showcase a container-wide video with a small pill label above it. Good fit for product demos, walkthroughs, or any section where a single video should take center stage.",
  content: (field) => ({
    pill: field.string({
      default: "Watch the demo",
      title: "Pill label",
    }),
    video: field.file({
      accept: ["video/mp4", "video/webm", "video/quicktime"],
      title: "Video",
    }),
  }),
  settings: (setting) => ({
    autoplay: setting.boolean({
      default: false,
      title: "Autoplay",
    }),
    hideControls: setting.boolean({
      default: false,
      title: "Hide controls",
    }),
  }),
  component: LargeVideoComponent,
  toMarkdown: (c) => [c.pill, c.video],
});

function LargeVideoComponent() {
  const autoplay = largeVideo.useSetting("autoplay");
  const hideControls = largeVideo.useSetting("hideControls");
  return (
    <BlockContainer>
      <largeVideo.Field name="pill">
        {(props) => <Pill {...props} className="mb-6" />}
      </largeVideo.Field>
      <div className="bg-accent/30 border-accent overflow-hidden rounded-xl border">
        <largeVideo.File name="video">
          {(_props, { url }) => (
            <video
              src={url}
              controls={!hideControls}
              autoPlay={autoplay}
              muted={autoplay}
              loop={autoplay}
              playsInline
              className="h-full w-full"
            />
          )}
        </largeVideo.File>
      </div>
    </BlockContainer>
  );
}

export { largeVideo as block };
