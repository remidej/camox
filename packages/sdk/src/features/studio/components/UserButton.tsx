import { Avatar, AvatarFallback, AvatarImage } from "@camox/ui/avatar";
import { Button } from "@camox/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { useConvexAuth } from "convex/react";
import { LogOut, Monitor, Moon, Settings, Sun, User } from "lucide-react";
import { useContext } from "react";

import { AuthContext } from "@/lib/auth";

import { useTheme } from "../useTheme";

export const UserButton = () => {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { setTheme } = useTheme();

  if (!isAuthenticated || isLoading) {
    return (
      <Button variant="outline" size="icon">
        <User className="h-4 w-4" />
      </Button>
    );
  }

  return <AuthenticatedUserButton setTheme={setTheme} />;
};

function AuthenticatedUserButton({
  setTheme,
}: {
  setTheme: (theme: "light" | "dark" | "system") => void;
}) {
  const authCtx = useContext(AuthContext);
  const { data: session } = (authCtx!.authClient as any).useSession();
  const managementUrl = authCtx!.managementUrl;

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
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <User className="text-muted-foreground h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72" align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-3">
            <Avatar size="lg">
              {userImage && <AvatarImage src={userImage} alt={userName} />}
              <AvatarFallback>{userInitials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-0.5">
              <p className="text-sm leading-none font-medium">{userName}</p>
              <p className="text-muted-foreground text-sm">{userEmail}</p>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => window.open(`${managementUrl}/dashboard/profile`, "_blank")}
        >
          <Settings className="h-4 w-4" />
          <span>Manage account</span>
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2">
            <Sun className="text-muted-foreground h-4 w-4 dark:hidden" />
            <Moon className="text-muted-foreground hidden h-4 w-4 dark:block" />
            <span>Theme</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => setTheme("light")}>
              <Sun className="h-4 w-4" />
              <span>Light</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("dark")}>
              <Moon className="h-4 w-4" />
              <span>Dark</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTheme("system")}>
              <Monitor className="h-4 w-4" />
              <span>System</span>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onClick={() => (authCtx!.authClient as any).signOut()}>
          <LogOut className="h-4 w-4" />
          <span>Sign out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
