import * as React from "react";
import { ClerkProvider, useClerk } from "@clerk/clerk-react";
import { actionsStore } from "../actionsStore";
import { shadcn } from "@clerk/themes";

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider = ({ children }: AuthProviderProps) => {
  return (
    <ClerkProvider
      publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}
      afterSignOutUrl="/"
      appearance={{ baseTheme: shadcn }}
    >
      {children}
    </ClerkProvider>
  );
};

export function useAuthActions() {
  const { openSignIn, signOut, openUserProfile } = useClerk();

  React.useEffect(() => {
    // Register authentication actions
    actionsStore.send({
      type: "registerManyActions",
      actions: [
        {
          id: "manage-account",
          label: "Manage account",
          groupLabel: "Studio",
          checkIfAvailable: () => true,
          execute: () => openUserProfile(),
          icon: "User",
        },
        {
          id: "log-out",
          label: "Log out",
          groupLabel: "Studio",
          checkIfAvailable: () => true,
          execute: () => signOut(),
          icon: "LogOut",
        },
      ],
    });

    return () => {
      actionsStore.send({
        type: "unregisterManyActions",
        ids: ["manage-account", "log-out"],
      });
    };
  }, [openSignIn, signOut, openUserProfile]);
}
