import { toast } from "@camox/ui/toaster";
import { useState } from "react";

import { siteUrl } from "@/components/ProjectSetup";
import type { Project } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

/**
 * Opens a project's website in a new tab with the studio signed in: the API hands the website a
 * one-time token, which it exchanges for a session of its own.
 */
export function useOpenWebsite() {
  const [opening, setOpening] = useState(false);

  const open = async (project: Pick<Project, "slug">) => {
    // Opened before awaiting the token, so the browser counts it as the click's and doesn't block
    // it. Cut from this tab, so the website's scripts can't navigate the dashboard.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    setOpening(true);
    try {
      const { data } = await authClient.$fetch<{ url: string }>("/cross-domain/studio-authorize", {
        method: "POST",
        body: { callback: siteUrl(project) },
      });
      if (!data?.url) throw new Error("The API didn't sign the studio in");
      if (tab) tab.location.href = data.url;
      else window.location.assign(data.url);
    } catch (error) {
      tab?.close();
      console.error("Failed to open the studio:", error);
      toast.error("Could not open the studio");
    } finally {
      setOpening(false);
    }
  };

  return { open, opening };
}
