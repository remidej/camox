import { useEffect } from "react";

import { actionsStore, type Action } from "../provider/actionsStore";
import { previewStore } from "./previewStore";

/** Preview commands stay available while switching between the site and Canvas. */
export function usePreviewViewportActions() {
  useEffect(() => {
    const actions = [
      {
        id: "cycle-viewport-mode",
        label: "Cycle viewport mode",
        aliases: ["Responsive preview", "Viewport preview", "Device preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "cycleViewportMode" }),
        shortcut: { key: "m" },
      },
      {
        id: "set-viewport-full",
        label: "Set full viewport",
        aliases: ["Full preview", "Desktop preview", "Full width preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "setViewportMode", mode: "full" }),
      },
      {
        id: "set-viewport-tablet",
        label: "Set tablet viewport",
        aliases: ["Tablet preview", "Responsive preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "setViewportMode", mode: "tablet" }),
      },
      {
        id: "set-viewport-mobile",
        label: "Set mobile viewport",
        aliases: ["Mobile preview", "Phone preview", "Responsive preview"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => previewStore.send({ type: "setViewportMode", mode: "mobile" }),
      },
    ] satisfies Action[];

    actionsStore.send({ type: "registerManyActions", actions });
    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: actions.map((action) => action.id),
      });
    };
  }, []);
}
