import { createFileRoute, notFound } from '@tanstack/react-router';

export const Route = createFileRoute('/_camox/studio/$')({
  component: RouteComponent,
  beforeLoad: () => {
    throw notFound();
  },
});

function RouteComponent() {
  return <div>Studio splat route</div>;
}
