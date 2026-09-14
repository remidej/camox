import { createContext } from "react";

// Site-owned HTML/CSS only. Never construct a preview by inheriting the studio
// document's stylesheet list or its html/body theme classes.
export const PreviewDocumentContext = createContext<string | undefined>(undefined);
