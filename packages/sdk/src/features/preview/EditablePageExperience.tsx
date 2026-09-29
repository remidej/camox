import type { QueryClient } from "@tanstack/react-query";

import type { CamoxApp } from "../../core/createApp";
import { CompleteBlockEditingRuntimeProvider } from "../../core/editing/CompleteBlockEditingRuntime";
import { CamoxContent } from "../content/CamoxContent";
import { AuthenticatedCamoxProvider } from "../provider/AuthenticatedCamoxProvider";
import type { PageRenderInput } from "../runtime/runtime";
import { CamoxStudio } from "../studio/CamoxStudio";
import { CamoxPreview } from "./CamoxPreview";
import { EditablePageContent } from "./EditablePageContent";

export function EditablePageExperience({
  camoxApp: _camoxApp,
  input,
  queryClient: _queryClient,
}: {
  camoxApp: CamoxApp;
  input: PageRenderInput;
  queryClient: QueryClient;
}) {
  return (
    <AuthenticatedCamoxProvider>
      <CompleteBlockEditingRuntimeProvider>
        {input.routeKind ? (
          <CamoxStudio>
            {input.routeKind === "studio-content" ? (
              <CamoxContent />
            ) : (
              <div className="text-muted-foreground p-6 text-sm">Studio page not found</div>
            )}
          </CamoxStudio>
        ) : (
          <CamoxPreview
            derived={input.derived}
            source={input.source}
            runtimeBasePath={input.runtimeBasePath}
          >
            <EditablePageContent />
          </CamoxPreview>
        )}
      </CompleteBlockEditingRuntimeProvider>
    </AuthenticatedCamoxProvider>
  );
}
