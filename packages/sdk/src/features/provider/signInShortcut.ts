import { useHotkey } from "@tanstack/react-hotkeys";

import { useSignInRedirect } from "../../lib/auth";
import { TOGGLE_CANVAS_SHORTCUT } from "../preview/previewConstants";

/** Marks the URL a sign-in returns to, so the Studio opens on the Canvas there. */
const SHOW_CANVAS_PARAM = "camox-show-canvas";

function showCanvasCallbackHref() {
  const url = new URL(window.location.href);
  url.searchParams.set(SHOW_CANVAS_PARAM, "");
  return url.href;
}

/**
 * While signed out, the shortcut that shows the Canvas signs in instead, then shows the Canvas
 * on the page it was pressed on. Fields keep it, since sites often submit forms with it.
 */
export function useSignInShortcut(enabled: boolean) {
  const signIn = useSignInRedirect(showCanvasCallbackHref);

  useHotkey(
    TOGGLE_CANVAS_SHORTCUT,
    (event) => {
      // The site handled it.
      if (event.defaultPrevented) return;
      event.preventDefault();
      signIn();
    },
    { enabled, ignoreInputs: true, preventDefault: false, stopPropagation: false },
  );
}

/** Whether a sign-in from the shortcut led here. Removes the mark, so it shows the Canvas once. */
export function takeShowCanvasRequest() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHOW_CANVAS_PARAM)) return false;
  url.searchParams.delete(SHOW_CANVAS_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return true;
}
