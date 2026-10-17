import { useSelector } from "@xstate/store-react";
import { useLayoutEffect } from "react";
import overlayStyles from "virtual:camox-overlay-css";

import { previewStore, selectIsCanvasShown } from "../previewStore";
import { useFrame } from "./Frame";

export const FieldOverlayStyles = () => {
  const { window } = useFrame();
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);
  useLayoutEffect(() => {
    if (!window) return;
    const root = window.document.documentElement;
    root.toggleAttribute("data-camox-canvas-shown", isCanvasShown);
    return () => {
      root.removeAttribute("data-camox-canvas-shown");
    };
  }, [window, isCanvasShown]);

  return <style>{overlayStyles}</style>;
};
