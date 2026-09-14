import { createContext } from "react";

// The standalone/TanStack integrations still own their chrome. The unified
// runtime places it above route content so it survives route/layout changes.
export const SharedChromeContext = createContext(false);
