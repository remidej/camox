import type * as React from "react";

/** One part of the Settings Section: what it sets, beside the form that sets it. */
export function SettingsPart({
  title,
  description,
  children,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = `camox-settings-${title.toLowerCase().replaceAll(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="grid gap-4 md:grid-cols-3 md:gap-8">
      <div>
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      <div className="md:col-span-2">{children}</div>
    </section>
  );
}
