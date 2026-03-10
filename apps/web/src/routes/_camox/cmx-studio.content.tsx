import { createFileRoute } from '@tanstack/react-router';
import { CamoxContent } from 'camox/CamoxContent';

export const Route = createFileRoute('/_camox/cmx-studio/content')({
  component: RouteComponent,
});

function RouteComponent() {
  return <CamoxContent />;
}
