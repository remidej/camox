import { createFileRoute } from '@tanstack/react-router';
import { CamoxPlayground } from 'camox/CamoxPlayground';

export const Route = createFileRoute('/_camox/cmx-studio/blocks')({
  component: RouteComponent,
});

function RouteComponent() {
  return <CamoxPlayground />;
}
