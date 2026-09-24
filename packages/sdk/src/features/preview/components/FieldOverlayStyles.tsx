import { useLayoutEffect } from "react";
import overlayStyles from "virtual:camox-overlay-css";

import { observeOverlayHighlights } from "../overlayHighlights";
import { useFrame } from "./Frame";

export const FieldOverlayStyles = () => {
  const { window } = useFrame();
  useLayoutEffect(() => {
    if (!window) return;
    return observeOverlayHighlights(window.document);
  }, [window]);

  return <style>{overlayStyles}</style>;
};
