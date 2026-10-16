import { PanelHeader } from "@camox/ui/panel";

import { PagePicker } from "./PagePicker";

export type PreviewedPage = {
  id: string;
  metaTitle: string | null;
  pathSegment: string;
  fullPath: string;
};

export const PageNavigatorHeader = () => (
  <PanelHeader className="flex flex-col gap-2 p-2">
    <div className="flex w-full">
      <PagePicker />
    </div>
  </PanelHeader>
);
