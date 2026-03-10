import { ImageIcon } from "lucide-react";

export const ContentSidebar = () => {
  return (
    <div className="w-[220px] flex flex-col border-r-2 p-2">
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium bg-accent text-accent-foreground"
        >
          <ImageIcon className="h-4 w-4" />
          Assets
        </button>
    </div>
  );
};
