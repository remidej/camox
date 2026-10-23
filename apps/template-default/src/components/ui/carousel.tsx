import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRef, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * A native carousel: the slides sit in a row that scrolls sideways and snaps to each slide
 * (CSS scroll snap). Visitors swipe or scroll it, and the keyboard reaches it with Tab and moves
 * it with the arrow keys. Every slide is in the page's markup. The previous and next buttons are
 * the only JS: they scroll by one slide. Without scroll snap, the row still scrolls.
 */

type CarouselProps = ComponentProps<"div"> & {
  /** Accessible name of the carousel, such as "Gallery". */
  label: string;
  /** Accessible names of the previous and next buttons. */
  previousLabel?: string;
  nextLabel?: string;
};

function Carousel({
  label,
  previousLabel = "Previous slide",
  nextLabel = "Next slide",
  className,
  children,
  ...props
}: CarouselProps) {
  const scroller = useRef<HTMLDivElement>(null);

  function scrollBySlide(direction: 1 | -1) {
    const element = scroller.current;
    if (!element) return;
    // In a right-to-left page, the next slide is to the left.
    const inline = element.matches(":dir(rtl)") ? -direction : direction;
    element.scrollBy({ left: inline * element.clientWidth });
  }

  return (
    <div
      data-slot="carousel"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      className={cn("flex flex-col gap-4", className)}
      {...props}
    >
      <div
        ref={scroller}
        // Lets keyboard users reach the row and scroll it with the arrow keys.
        tabIndex={0}
        className="rounded-card flex snap-x snap-mandatory [scrollbar-width:thin] gap-4 overflow-x-auto overscroll-x-contain motion-safe:scroll-smooth"
      >
        {children}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={previousLabel}
          className="px-2"
          onClick={() => scrollBySlide(-1)}
        >
          <ChevronLeftIcon className="rtl:rotate-180" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label={nextLabel}
          className="px-2"
          onClick={() => scrollBySlide(1)}
        >
          <ChevronRightIcon className="rtl:rotate-180" />
        </Button>
      </div>
    </div>
  );
}

/** One slide. It takes the carousel's full width; pass a `basis-*` class to show more at once. */
function CarouselSlide({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="carousel-slide"
      role="group"
      aria-roledescription="slide"
      className={cn("shrink-0 basis-full snap-start", className)}
      {...props}
    />
  );
}

export { Carousel, CarouselSlide };
