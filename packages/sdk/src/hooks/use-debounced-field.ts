import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Local state for a field that autosaves to a server value, debouncing the
 * save and refusing to overwrite the user's in-progress edit when the server
 * response lands.
 *
 * Without focus tracking, a fast typist can lose characters: their first
 * keystroke triggers a debounced save → the mutation roundtrips → react-query
 * pushes the (now stale) server value back through props → the input is reset
 * to the just-saved value, dropping whatever the user typed in the meantime.
 * While `isFocused` is true we ignore `serverValue` changes; when the user
 * leaves the input we resync.
 */
export function useDebouncedField<T>(serverValue: T, onSave: (value: T) => void, delay = 500) {
  const [value, setLocal] = useState<T>(serverValue);
  const [isFocused, setIsFocused] = useState(false);

  // Keep onSave in a ref so callers don't need to memoise it (lets
  // LinkFieldEditor compose `{ ...linkValueRef.current, text: v }` inline).
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef<{ value: T } | null>(null);

  // Sync from server only when the user isn't actively editing.
  useEffect(() => {
    if (!isFocused) setLocal(serverValue);
  }, [serverValue, isFocused]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      const { value: v } = pendingRef.current;
      pendingRef.current = null;
      saveRef.current(v);
    }
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
  }, []);

  const setValue = useCallback(
    (v: T) => {
      setLocal(v);
      pendingRef.current = { value: v };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        const p = pendingRef.current;
        pendingRef.current = null;
        if (p) saveRef.current(p.value);
      }, delay);
    },
    [delay],
  );

  const onFocus = useCallback(() => setIsFocused(true), []);
  const onBlur = useCallback(() => {
    setIsFocused(false);
    flush();
  }, [flush]);

  // Flush any pending save on unmount so closing a dialog mid-edit doesn't
  // silently drop the user's change.
  useEffect(() => () => flush(), [flush]);

  return { value, setValue, isFocused, onFocus, onBlur, flush, cancel };
}
