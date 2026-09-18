import { Alert, AlertDescription, AlertTitle } from "@camox/ui/alert";

import { useCamoxApp } from "../../provider/components/CamoxAppContext";

function DerivedPageInfoSidebar({ layoutId }: { layoutId: string }) {
  const camoxApp = useCamoxApp();
  const layout = camoxApp.getLayoutById(layoutId);
  const layoutName = layout?._internal.title ?? layoutId;
  const singleton = layout?._internal.kind === "singleton";

  return (
    <div className="flex-1 space-y-4 p-2 pt-4">
      <p className="text-base font-semibold">About this page</p>
      <Alert>
        <AlertTitle>{singleton ? "Singleton page" : "Derived page"}</AlertTitle>
        <AlertDescription>
          {singleton ? (
            <>
              This page and its URL are defined in code. Select a block in the preview to edit its
              content. The page cannot be deleted or moved in Studio.
            </>
          ) : (
            <>
              This page is generated using the{" "}
              <strong className="font-semibold italic">{layoutName}</strong> layout. Select a shared
              block in the preview to edit it.
            </>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}

export { DerivedPageInfoSidebar };
