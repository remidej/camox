/** Native and sidebar hover use the same overlay attributes in every editing mode. */
export function useOverlayState(hovered: boolean, focused = false) {
  return {
    "data-camox-hovered": hovered || undefined,
    "data-camox-focused": focused || undefined,
  };
}
