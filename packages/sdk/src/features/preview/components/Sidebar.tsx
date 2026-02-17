import { PageTree } from "./PageTree";
import { PanelHeader } from "@/components/ui/panel";
import { PagePicker } from "./PagePicker";
import { PublicationStateSelect } from "./PublicationStateSelect";

export const Sidebar = () => {
  return (
    <>
      <PanelHeader className="px-2 py-2 flex flew-row gap-2">
        <PagePicker />
        <PublicationStateSelect />
      </PanelHeader>
      <PageTree />
    </>
  );
};
