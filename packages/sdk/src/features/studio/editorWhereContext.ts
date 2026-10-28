import type { EditorWhere } from "@camox/api-contract/threads";
import * as React from "react";

/**
 * Where the editor is in the Website Section: the Page they look at, or the Canvas with no page
 * selected. Undefined elsewhere in the Studio. Their messages to the agent carry it as a hint.
 */
export const EditorWhereContext = React.createContext<EditorWhere | undefined>(undefined);
