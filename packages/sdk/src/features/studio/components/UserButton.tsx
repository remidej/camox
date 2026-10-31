import { Avatar, AvatarFallback, AvatarImage } from "@camox/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { useSelector } from "@xstate/store-react";
import { Check, Command, EyeOff, LogOut, Monitor, Moon, Settings, Sun, User } from "lucide-react";

import { useNavigate } from "@/features/navigation/navigation";
import { useAuthContext, useAuthState } from "@/lib/auth";
import { useLocalePath, useLocalizedPath } from "@/lib/view-locale";

import { PlatformLabel } from "../../../components/PlatformLabel";
import { previewStore, selectIsCanvasShown } from "../../preview/previewStore";
import { STUDIO_BASE_PATH } from "../routes";
import { studioStore } from "../studioStore";
import { useApplyTheme } from "../useTheme";

export const UserButton = () => {
  const { isAuthenticated, isLoading } = useAuthState();
  const { theme, setTheme } = useApplyTheme();

  if (!isAuthenticated || isLoading) {
    return (
      <Avatar>
        <AvatarFallback>
          <User className="size-4" />
        </AvatarFallback>
      </Avatar>
    );
  }

  return <AuthenticatedUserButton theme={theme} setTheme={setTheme} />;
};

function AuthenticatedUserButton({
  theme,
  setTheme,
}: {
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
}) {
  const authCtx = useAuthContext();
  const { data: session } = authCtx.authClient.useSession();
  const authenticationUrl = authCtx.authenticationUrl;
  const isCanvasShown = useSelector(previewStore, selectIsCanvasShown);
  const pathname = useLocalePath();
  const localized = useLocalizedPath();
  const navigate = useNavigate();
  const isPreviewPage =
    pathname !== STUDIO_BASE_PATH && !pathname.startsWith(`${STUDIO_BASE_PATH}/`);

  const hideCamoxUi = () => {
    previewStore.send({ type: "hideToolbar" });
    if (isPreviewPage) return;
    void navigate({ to: localized("/") });
  };

  const userName = session?.user?.name || "User";
  const userEmail = session?.user?.email;
  const userImage = session?.user?.image;
  const userInitials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="focus-visible:ring-ring/50 rounded-full outline-none focus-visible:ring-3"
      >
        <Avatar>
          {userImage && <AvatarImage src={userImage} alt={userName} />}
          <AvatarFallback>{userInitials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <div className="flex items-center gap-3">
              <Avatar size="lg">
                {userImage && <AvatarImage src={userImage} alt={userName} />}
                <AvatarFallback>{userInitials}</AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-0.5">
                <p className="text-foreground text-sm leading-none font-medium">{userName}</p>
                <p className="text-muted-foreground text-sm">{userEmail}</p>
              </div>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => window.open(`${authenticationUrl}/profile`, "_blank")}>
          <Settings />
          <span>Manage account</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Sun className="dark:hidden" />
            <Moon className="hidden dark:block" />
            <span>Theme</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-36">
            <DropdownMenuItem
              onClick={() => setTheme("light")}
              className="flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <Sun className="h-4 w-4" />
                <span>Light</span>
              </span>
              {theme === "light" && <Check className="h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("dark")}
              className="flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <Moon className="h-4 w-4" />
                <span>Dark</span>
              </span>
              {theme === "dark" && <Check className="h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => setTheme("system")}
              className="flex items-center justify-between"
            >
              <span className="flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                <span>System</span>
              </span>
              {theme === "system" && <Check className="h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => studioStore.send({ type: "openCommandPalette" })}>
          <Command />
          <span>Command palette</span>
          <DropdownMenuShortcut>
            <PlatformLabel mac="⌘ K" other="Ctrl K" />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isPreviewPage && isCanvasShown} onClick={hideCamoxUi}>
          <EyeOff />
          <span>Hide Camox UI</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void authCtx.authClient.signOut()}>
          <LogOut />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
