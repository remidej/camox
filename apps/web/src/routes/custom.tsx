import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/custom')({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <div>
      This is a custom route defined by the user in their routes folder.
    </div>
  );
}
