import { createFileRoute, notFound } from '@tanstack/react-router';
import { api } from 'camox/_generated/api';
import { CamoxPreview, PageContent } from 'camox/CamoxPreview';

export const Route = createFileRoute('/_camox/$')({
  component: App,
  loader: async ({ context, location }) => {
    const page = await context.convexHttpClient.query(api.pages.getPage, {
      fullPath: location.pathname,
    });

    if (!page) {
      throw notFound();
    }

    return { page };
  },
});

function App() {
  const { page } = Route.useLoaderData();

  return (
    <CamoxPreview>
      <PageContent page={page} />
    </CamoxPreview>
  );
}
