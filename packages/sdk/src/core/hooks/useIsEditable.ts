import { useSelector } from "@xstate/store/react";
import { useClerk } from "@clerk/clerk-react";
import { previewStore } from "@/features/preview/previewStore";

export function useIsEditable(mode: "site" | "peek" | "playground") {
  const { isSignedIn } = useClerk();
  const isPresentationMode = useSelector(
    previewStore,
    (state) => state.context.isPresentationMode,
  );
  const isContentLocked = useSelector(
    previewStore,
    (state) => state.context.isContentLocked,
  );
  return (
    isSignedIn && mode === "site" && !isPresentationMode && !isContentLocked
  );
}
