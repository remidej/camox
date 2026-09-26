import { useId, type ReactNode } from "react";

export const ContentSidebarGroup = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-1">
      <h2 id={titleId} className="text-muted-foreground px-2 py-1.5 text-xs font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
};
