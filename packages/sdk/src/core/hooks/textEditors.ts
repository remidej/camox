import * as React from "react";

/**
 * Whether the surrounding frame's text fields mount their editors. Canvas
 * frames other than the selected one render their text as the site does,
 * which keeps hundreds of editors from starting as the camera reaches them.
 */
export const TextEditorsContext = React.createContext(true);
