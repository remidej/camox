import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@camox/ui/alert-dialog";
import { Toaster } from "@camox/ui/toaster";
import * as React from "react";
import studioCssUrl from "virtual:camox-studio-css";

import { useSignInRedirect } from "../../lib/auth";
import { PreviewPanel } from "../preview/components/PreviewPanel";
import { EDIT_MODE_SHORTCUT } from "../preview/previewConstants";
import { useApplyTheme } from "../studio/useTheme";
import { actionsStore, type Action } from "./actionsStore";
import { useAdminShortcuts } from "./useAdminShortcuts";

export function LocalhostPreviewProvider({ children }: { children: React.ReactNode }) {
  const signInRedirect = useSignInRedirect();
  const { resolvedTheme } = useApplyTheme();
  const [isSignInDialogOpen, setIsSignInDialogOpen] = React.useState(false);
  useAdminShortcuts();

  React.useEffect(() => {
    const actions = [
      {
        id: "sign-in-to-edit",
        label: "Sign in to edit",
        aliases: ["Enter edit mode", "Edit mode"],
        groupLabel: "Preview",
        checkIfAvailable: () => true,
        execute: () => setIsSignInDialogOpen(true),
        shortcut: EDIT_MODE_SHORTCUT,
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

  return (
    <>
      <link rel="stylesheet" href={studioCssUrl} data-camox-studio />
      <Toaster theme={resolvedTheme} position="bottom-right" offset={{ bottom: "1rem" }} />
      <div className="bg-background flex h-screen flex-col overflow-hidden">
        <PreviewPanel
          toolbarProps={{
            onEditModeChange: (checked) => {
              if (checked) setIsSignInDialogOpen(true);
            },
          }}
        >
          {children}
        </PreviewPanel>
      </div>
      <AlertDialog open={isSignInDialogOpen} onOpenChange={setIsSignInDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign in to edit</AlertDialogTitle>
            <AlertDialogDescription>
              You need to sign in before you can enable edit mode.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline" size="default">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={signInRedirect}>Sign in</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
