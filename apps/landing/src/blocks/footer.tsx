import { createBlock } from "camox/createBlock";
import { Link } from "camox/navigation";
import { useId } from "react";

import { blockSideBorder } from "@/components/BlockContainer";
import { Container } from "@/components/ui/container";
import { Section } from "@/components/ui/section";
import { cn } from "@/lib/utils";

const footer = createBlock({
  id: "footer",
  title: "Footer",
  layoutOnly: true,
  synced: true,
  description:
    "A footer at the bottom of a page with the logo, a copyright notice, and navigation links under a mountain ridgeline.",
  content: (field) => ({
    logo: field.image({
      title: "Logo",
    }),
    links: field.repeater({
      content: (field) => ({
        link: field.link({
          default: { text: "Footer link", href: "#", newTab: false },
          title: "Link",
        }),
      }),
      minItems: 2,
      maxItems: 12,
      title: "Links",
      toTitle: ({ content }) => content.link,
      toMarkdown: (c) => [c.link],
    }),
  }),
  component: FooterComponent,
  toTitle: () => "Footer",
  toMarkdown: (c) => [c.logo, c.links],
});

/** A range across the middle of the container, on a baseline (y=104) that runs to both ends. */
const ridge =
  "M0 104 H330 C331.3 104 335.3 104 338 103.9 C340.7 103.9 343.3 103.8 346 103.6 C348.7 103.4 351.3 103.2 354 102.8 C356.7 102.5 359.3 102.1 362 101.5 C364.7 100.9 367.3 100.2 370 99.3 C372.7 98.5 375.3 97.4 378 96.3 C380.7 95.1 383.3 93.7 386 92.3 C388.7 90.8 391.3 89 394 87.8 C396.7 86.5 399.3 85 402 84.5 C404.7 84 407.3 84.5 410 84.8 C412.7 85.1 415.3 85.7 418 86.3 C420.7 86.9 423.3 87.8 426 88.3 C428.7 88.8 431.3 89.3 434 89.3 C436.7 89.3 439.3 88.9 442 88.3 C444.7 87.7 447.3 86.8 450 85.8 C452.7 84.8 455.3 83.7 458 82.5 C460.7 81.4 463.3 80.1 466 78.8 C468.7 77.5 471.3 76.2 474 74.8 C476.7 73.4 479.3 72 482 70.5 C484.7 69.1 487.3 67.6 490 66.3 C492.7 64.9 495.3 63.4 498 62.4 C500.7 61.3 503.3 59.9 506 60.2 C508.7 60.5 511.3 62.5 514 63.9 C516.7 65.4 519.3 67.1 522 68.7 C524.7 70.3 527.3 72.1 530 73.7 C532.7 75.3 535.3 76.9 538 78.3 C540.7 79.8 543.3 81.3 546 82.4 C548.7 83.5 551.3 84.6 554 85 C556.7 85.3 559.3 85.1 562 84.6 C564.7 84 567.3 82.7 570 81.6 C572.7 80.4 575.3 79 578 77.6 C580.7 76.2 583.3 74.6 586 73.2 C588.7 71.8 591.3 70.1 594 69 C596.7 67.9 599.3 67 602 66.8 C604.7 66.6 607.3 67.6 610 67.7 C612.7 67.8 615.3 67.8 618 67.4 C620.7 67 623.3 66.3 626 65.3 C628.7 64.4 631.3 63.2 634 61.9 C636.7 60.6 639.3 59.2 642 57.7 C644.7 56.3 647.3 54.7 650 53.1 C652.7 51.6 655.3 49.9 658 48.3 C660.7 46.6 663.3 45 666 43.3 C668.7 41.6 671.3 39.9 674 38.2 C676.7 36.6 679.3 34.9 682 33.2 C684.7 31.6 687.3 30 690 28.5 C692.7 27 695.3 25.4 698 24.4 C700.7 23.3 703.3 21.9 706 22.2 C708.7 22.5 711.3 24.6 714 26.2 C716.7 27.7 719.3 29.7 722 31.5 C724.7 33.4 727.3 35.4 730 37.4 C732.7 39.4 735.3 41.4 738 43.4 C740.7 45.4 743.3 47.4 746 49.3 C748.7 51.2 751.3 53.1 754 54.9 C756.7 56.7 759.3 58.5 762 59.9 C764.7 61.3 767.3 62.7 770 63.4 C772.7 64.1 775.3 64.4 778 64.1 C780.7 63.8 783.3 62.7 786 61.5 C788.7 60.3 791.3 58.5 794 57.1 C796.7 55.7 799.3 53.4 802 52.8 C804.7 52.3 807.3 52.8 810 53.7 C812.7 54.6 815.3 56.5 818 58.1 C820.7 59.6 823.3 61.4 826 62.9 C828.7 64.4 831.3 66.1 834 67.3 C836.7 68.5 839.3 69.7 842 70.1 C844.7 70.5 847.3 70.4 850 69.8 C852.7 69.2 855.3 67.9 858 66.6 C860.7 65.3 863.3 63.6 866 61.9 C868.7 60.3 871.3 58.5 874 56.7 C876.7 54.9 879.3 53 882 51.2 C884.7 49.3 887.3 47.5 890 45.8 C892.7 44 895.3 42.1 898 40.9 C900.7 39.6 903.3 38.1 906 38.2 C908.7 38.2 911.3 40 914 41.1 C916.7 42.3 919.3 43.7 922 45.1 C924.7 46.5 927.3 48 930 49.5 C932.7 51 935.3 52.5 938 54.1 C940.7 55.6 943.3 57.1 946 58.6 C948.7 60.1 951.3 61.5 954 63 C956.7 64.4 959.3 65.8 962 67.2 C964.7 68.5 967.3 69.8 970 71.1 C972.7 72.3 975.3 73.5 978 74.6 C980.7 75.7 983.3 76.8 986 77.6 C988.7 78.4 991.3 79.1 994 79.4 C996.7 79.8 999.3 79.7 1002 79.5 C1004.7 79.2 1007.3 78.5 1010 77.9 C1012.7 77.4 1015.3 76 1018 76 C1020.7 76.1 1023.3 76.9 1026 78 C1028.7 79 1031.3 81 1034 82.6 C1036.7 84.2 1039.3 86 1042 87.6 C1044.7 89.2 1047.3 90.8 1050 92.3 C1052.7 93.7 1055.3 95 1058 96.1 C1060.7 97.3 1063.3 98.2 1066 99.1 C1068.7 99.9 1071.3 100.6 1074 101.2 C1076.7 101.8 1079.3 102.2 1082 102.6 C1084.7 102.9 1087.3 103.2 1090 103.4 C1092.7 103.6 1095.3 103.7 1098 103.8 C1100.7 103.9 1104.7 104 1106 104 H1440";

/**
 * A nod to the chamois in the logo: the footer's top border, drawn as a
 * mountain ridgeline across the container, with a faint brand-colour glow in
 * the sky behind it, like the hour before sunrise. It keeps the proportions it
 * has in the full-width (1280px) container on every screen: narrower screens
 * render it wider than the container (`--ridge-span`) and crop the flat
 * baseline, so the range itself spans the container on mobile. The stroke stays
 * 1px in the line colour.
 */
function Ridgeline() {
  const id = useId();

  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 overflow-hidden">
      <svg
        viewBox="0 0 1440 112"
        preserveAspectRatio="none"
        className="relative left-1/2 aspect-[1280/112] w-(--ridge-span) max-w-none -translate-x-1/2"
      >
        <defs>
          <radialGradient
            id={`${id}-glow`}
            cx="0.5"
            cy="1"
            r="1"
            gradientTransform="translate(0.5 1) scale(0.55 1) translate(-0.5 -1)"
          >
            <stop offset="0" stopColor="var(--brand)" stopOpacity={0.22} />
            <stop offset="0.5" stopColor="var(--brand)" stopOpacity={0.08} />
            <stop offset="1" stopColor="var(--brand)" stopOpacity={0} />
          </radialGradient>
          <clipPath id={`${id}-sky`}>
            <path d={`${ridge} V0 H0 Z`} />
          </clipPath>
        </defs>
        <rect width={1440} height={104} fill={`url(#${id}-glow)`} clipPath={`url(#${id}-sky)`} />
        <path
          d={ridge}
          fill="none"
          stroke="var(--line)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

// Read when the module loads: React components must not read the clock while rendering.
const currentYear = new Date().getFullYear();

function FooterComponent() {
  return (
    // The ridgeline is the separator, so the footer overlaps and hides the bottom
    // border of the block above (2px rather than 1px to survive fractional offsets).
    <Section as="footer" scheme="dark" className="relative -mt-0.5 py-0">
      <Container
        className={cn(
          // The content clears the ridgeline (as tall as `--ridge-span` × 112/1280 of
          // the container's width) by 2rem. From xl the container stops growing.
          "relative pt-[calc(var(--ridge-span)*112/1280+2rem)] pb-10 [--ridge-span:185%] sm:pb-12 md:[--ridge-span:140%] lg:[--ridge-span:100%] xl:pt-36",
          blockSideBorder,
        )}
      >
        <Ridgeline />
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-4">
            <Link to="/" className="w-fit">
              <footer.Image name="logo">
                {(props) => <img {...props} className="h-6 w-auto" />}
              </footer.Image>
            </Link>
            <div className="text-ink-muted text-sm">&copy; {currentYear}</div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:justify-end">
            <footer.Repeater name="links">
              {(linkItem) => (
                <linkItem.Link name="link">
                  {(props) => (
                    <Link
                      {...props}
                      className="text-ink-muted hover:text-ink text-sm transition-colors"
                    />
                  )}
                </linkItem.Link>
              )}
            </footer.Repeater>
          </div>
        </div>
      </Container>
    </Section>
  );
}

export { footer as block };
