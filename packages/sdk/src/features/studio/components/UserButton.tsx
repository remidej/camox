import { Avatar, AvatarFallback, AvatarImage } from "@camox/ui/avatar";
import { Button } from "@camox/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { useSelector } from "@xstate/store-react";
import { Check, EyeOff, LogOut, Monitor, Moon, Settings, Sun, User } from "lucide-react";

import { useLocation, useNavigate } from "@/features/navigation/navigation";
import { useAuthContext, useAuthState } from "@/lib/auth";

import { previewStore } from "../../preview/previewStore";
import { STUDIO_BASE_PATH } from "../routes";
import { useApplyTheme } from "../useTheme";

export const UserButton = () => {
  const { isAuthenticated, isLoading } = useAuthState();
  const { theme, setTheme } = useApplyTheme();

  if (!isAuthenticated || isLoading) {
    return (
      <Button variant="outline" size="icon">
        <User className="h-4 w-4" />
      </Button>
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
  const isEditMode = useSelector(previewStore, (state) => state.context.isEditMode);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isPreviewPage =
    pathname !== STUDIO_BASE_PATH && !pathname.startsWith(`${STUDIO_BASE_PATH}/`);

  const hideCamoxUi = () => {
    previewStore.send({ type: "hideToolbar" });
    if (isPreviewPage) return;
    void navigate({ to: "/" });
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
      <DropdownMenuTrigger render={<Button variant="outline" size="icon" />}>
        <User className="text-muted-foreground" />
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
        <DropdownMenuItem disabled={isPreviewPage && isEditMode} onClick={hideCamoxUi}>
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
