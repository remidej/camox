import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/_camox/studio/assets')({
  component: RouteComponent,
});

function RouteComponent() {
  return <div>Assets</div>;
}
