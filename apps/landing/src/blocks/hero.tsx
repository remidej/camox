import { PulsingBorder } from "@paper-design/shaders-react";
import { createBlock } from "camox/createBlock";
import { useEffect, useRef, useState } from "react";

import { blockSideBorder } from "@/components/BlockContainer";
import { TerminalCard } from "@/components/TerminalCard";
import { cn } from "@/lib/utils";

const hero = createBlock({
  id: "hero",
  title: "Hero",
  description:
    "Use this block as the main landing section at the top of a page. It should capture attention immediately with a clear value proposition.",
  content: (field) => ({
    title: field.string({
      default: "Welcome to Camox",
      title: "Title",
    }),
    description: field.string({
      default: "Build something amazing with Camox.",
      maxLength: 280,
      title: "Description",
    }),
    command: field.string({
      default: "npx create-camox@latest my-site",
      title: "Command",
    }),
  }),
  component: HeroComponent,
  toMarkdown: (c) => [`# ${c.title}`, c.description, `\`\`\`bash\n${c.command}\n\`\`\``],
});

function HeroComponent() {
  const sectionRef = useRef<HTMLElement>(null);
  // Pause the WebGL shader when the hero is off-screen so it stops eating GPU
  // while the user scrolls the rest of the page.
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setIsVisible(entry.isIntersecting), {
      rootMargin: "100px",
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <section
        ref={sectionRef}
        className="bg-background dark border-border relative flex flex-col items-center justify-center overflow-hidden border-b"
      >
        <PulsingBorder
          colors={["#047857", "#065f46", "#064e3b", "#3b0764", "#4c1d95"]}
          colorBack="#09090b"
          roundness={0}
          thickness={1}
          softness={1}
          intensity={0.1}
          bloom={0.2}
          spots={4}
          spotSize={0.25}
          pulse={0}
          smoke={0.32}
          smokeSize={0.5}
          speed={isVisible ? 0.15 : 0}
          minPixelRatio={1}
          scale={1.1}
          marginLeft={0}
          marginRight={0}
          marginTop={0}
          marginBottom={0}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
        <div className="relative container pt-32 pb-24 md:pt-48 md:pb-32">
          <div className="mx-auto max-w-3xl text-center">
            <hero.Field name="title">
              {(props) => (
                <h1
                  {...props}
                  className="text-foreground mb-6 text-4xl leading-tight font-medium tracking-tight text-balance sm:text-5xl md:text-6xl"
                />
              )}
            </hero.Field>
            <hero.Field name="description">
              {(props) => <p {...props} className="mb-10 text-xl opacity-75" />}
            </hero.Field>
          </div>
        </div>
      </section>
      <div className="bg-background">
        <div className={cn("container h-12 px-4", blockSideBorder)}>
          <div className="relative z-10 mx-auto max-w-xl -translate-y-1/2">
            <TerminalCard>
              <hero.Field name="command">
                {(props) => (
                  <code
                    {...props}
                    className="text-foreground block text-base font-medium whitespace-nowrap"
                  />
                )}
              </hero.Field>
            </TerminalCard>
          </div>
        </div>
      </div>
    </>
  );
}

export { hero as block };
