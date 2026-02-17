import { createFileRoute } from '@tanstack/react-router';
import { CamoxPlayground } from 'camox/CamoxPlayground';

export const Route = createFileRoute('/_camox/studio/playground')({
  component: RouteComponent,
});

function RouteComponent() {
  return <CamoxPlayground />;
}
