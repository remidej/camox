import { Button } from "@camox/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@camox/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@camox/ui/dropdown-menu";
import { Input } from "@camox/ui/input";
import { Label } from "@camox/ui/label";
import { Toaster } from "@camox/ui/toaster";
import { UserButton } from "@daveyplate/better-auth-ui";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { CheckIcon, ChevronRight, ChevronsUpDownIcon, Loader2, PlusIcon } from "lucide-react";
import { Suspense, useState } from "react";
import slugify from "slugify";

import { CreateProjectGuide } from "@/components/CreateProjectGuide";
import { authClient } from "@/lib/auth-client";
import { organizationQueries, projectQueries } from "@/lib/queries";

export const Route = createFileRoute("/_app/_dashboard")({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: DashboardLayout,
});

function OrganizationPicker() {
  const navigate = useNavigate();
  const { orgSlug } = useParams({ strict: false });

  const { data: organizations } = useQuery(organizationQueries.list());

  const activeOrg = organizations?.find((org) => org.slug === orgSlug);

  const handleSetActive = (newOrgSlug: string) => {
    void navigate({ to: "/$orgSlug", params: { orgSlug: newOrgSlug } });
  };

  const [createOpen, setCreateOpen] = useState(false);

  if (!activeOrg) return null;

  return (
    <>
      <ChevronRight className="text-muted-foreground/50 h-4 w-4" />
      <div className="flex">
        <Button
          variant="ghost"
          size="sm"
          className="max-w-64 truncate"
          nativeButton={false}
          render={<Link to="/$orgSlug" params={{ orgSlug: activeOrg.slug }} />}
        >
          {activeOrg.name}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="px-2" />}>
            <ChevronsUpDownIcon className="text-muted-foreground h-3.5 w-3.5" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-56">
            {organizations && organizations.length > 0 && (
              <>
                <DropdownMenuGroup>
                  {organizations.map((org) => (
                    <DropdownMenuItem
                      key={org.id}
                      onClick={() => handleSetActive(org.slug)}
                      className="flex items-center justify-between"
                    >
                      {org.name}
                      {org.slug === orgSlug && <CheckIcon className="h-4 w-4 shrink-0" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <CreateOrganizationDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CreateOrganizationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();

  const form = useForm({
    defaultValues: { name: "", slug: "" },
    onSubmit: async ({ value }) => {
      await authClient.organization.create({ name: value.name, slug: value.slug });
      onOpenChange(false);
      form.reset();
      await navigate({ to: "/$orgSlug", params: { orgSlug: value.slug } });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          form.reset();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
          <DialogDescription>
            Add a new organization to collaborate with other members.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            void form.handleSubmit();
          }}
          className="grid gap-4 py-2"
        >
          <form.Field
            name="name"
            validators={{
              onSubmit: ({ value }) => {
                if (!value.trim()) return "Name is required";
                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    if (!form.getFieldMeta("slug")?.isDirty) {
                      form.setFieldValue(
                        "slug",
                        slugify(e.target.value, { lower: true, strict: true }),
                        {
                          dontUpdateMeta: true,
                        },
                      );
                    }
                  }}
                  placeholder="Acme Inc."
                  aria-invalid={!!field.state.meta.errors.length}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-xs">{field.state.meta.errors[0]}</p>
                )}
              </div>
            )}
          </form.Field>

          <form.Field
            name="slug"
            validators={{
              onSubmit: ({ value }) => {
                if (!value.trim()) return "Slug is required";
                if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
                  return "Slug must be lowercase alphanumeric with hyphens";
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor="org-slug">Slug</Label>
                <Input
                  id="org-slug"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="acme-inc"
                  aria-invalid={!!field.state.meta.errors.length}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-xs">{field.state.meta.errors[0]}</p>
                )}
              </div>
            )}
          </form.Field>

          <DialogFooter>
            <form.Subscribe selector={(state) => [state.isSubmitting, state.canSubmit]}>
              {([isSubmitting, canSubmit]) => (
                <Button type="submit" disabled={isSubmitting || !canSubmit}>
                  {isSubmitting ? "Creating\u2026" : "Create"}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectPicker() {
  const navigate = useNavigate();
  const { orgSlug, projectSlug } = useParams({ strict: false });
  const [createOpen, setCreateOpen] = useState(false);

  const { data: organizations } = useQuery(organizationQueries.list());
  const activeOrg = organizations?.find((org) => org.slug === orgSlug);

  const { data: projects } = useQuery({
    ...projectQueries.list(activeOrg?.id ?? ""),
    enabled: !!activeOrg,
  });

  if (!orgSlug || !projectSlug) return null;

  const activeProject = projects?.find((p) => p.slug === projectSlug);

  if (!activeProject) return null;

  return (
    <>
      <ChevronRight className="text-muted-foreground/50 h-4 w-4" />
      <div className="flex">
        <Button
          variant="ghost"
          size="sm"
          className="max-w-64 truncate"
          nativeButton={false}
          render={
            <Link
              to="/$orgSlug/$projectSlug"
              params={{ orgSlug, projectSlug: activeProject.slug }}
            />
          }
        >
          {activeProject.name}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="px-2" />}>
            <ChevronsUpDownIcon className="text-muted-foreground h-3.5 w-3.5" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" className="w-56">
            {projects?.map((project) => (
              <DropdownMenuItem
                key={project.id}
                className="flex items-center justify-between"
                onClick={() =>
                  navigate({
                    to: "/$orgSlug/$projectSlug",
                    params: { orgSlug, projectSlug: project.slug },
                    replace: true,
                  })
                }
              >
                {project.name}
                {project.slug === projectSlug && <CheckIcon className="h-4 w-4 shrink-0" />}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setCreateOpen(true)}>
              <PlusIcon />
              Create project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <CreateProjectGuide />
        </DialogContent>
      </Dialog>
    </>
  );
}

function DashboardNavbar() {
  const { orgSlug } = useParams({ strict: false }) as { orgSlug?: string };

  return (
    <header className="border-b">
      <div className="flex h-14 items-center gap-2 px-6">
        <Link to={orgSlug ? "/$orgSlug" : "/"} params={orgSlug ? { orgSlug } : {}} className="pr-4">
          <img src="/logo-shape.svg" alt="camox logo" className="h-8 py-1" />
        </Link>
        <OrganizationPicker />
        <ProjectPicker />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            nativeButton={false}
            render={<a href="https://camox.dev" />}
          >
            camox.dev
          </Button>
          <UserButton variant="outline" size="icon" />
        </div>
      </div>
    </header>
  );
}

function DashboardLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <Toaster />
      <DashboardNavbar />
      <main className="flex flex-1 flex-col overflow-auto">
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
