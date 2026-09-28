import { useSelector } from "@xstate/store-react";
import { useLayoutEffect } from "react";
import overlayStyles from "virtual:camox-overlay-css";

import { previewStore, selectIsEditMode } from "../previewStore";
import { useFrame } from "./Frame";

export const FieldOverlayStyles = () => {
  const { window } = useFrame();
  const isEditMode = useSelector(previewStore, selectIsEditMode);
  useLayoutEffect(() => {
    if (!window) return;
    const root = window.document.documentElement;
    root.toggleAttribute("data-camox-edit-mode", isEditMode);
    return () => {
      root.removeAttribute("data-camox-edit-mode");
    };
  }, [window, isEditMode]);

  return <style>{overlayStyles}</style>;
};
