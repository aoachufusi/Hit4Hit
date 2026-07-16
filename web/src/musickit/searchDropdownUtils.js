import { useCallback, useRef } from "react";

/** Keep dropdown open long enough for iOS touch to register on a result row. */
export function useSearchDropdown() {
  const blurTimerRef = useRef(null);

  const openDropdown = useCallback(() => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null;
    }, 350);
  }, []);

  const closeDropdown = useCallback((setOpen) => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setOpen(false);
  }, []);

  const handleInputBlur = useCallback((setOpen) => {
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
    blurTimerRef.current = setTimeout(() => {
      setOpen(false);
      blurTimerRef.current = null;
    }, 350);
  }, []);

  /**
   * iOS Safari blurs the input before click/mouseup on dropdown rows.
   * preventDefault on pointerdown keeps focus so the pick handler runs.
   */
  const pickFromDropdown = useCallback((e, onPick) => {
    e.preventDefault();
    e.stopPropagation();
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    onPick();
  }, []);

  return { openDropdown, scheduleClose, closeDropdown, handleInputBlur, pickFromDropdown };
}

export const SEARCH_INPUT_IOS_STYLE = {
  fontSize: 16,
  WebkitAppearance: "none",
};

export const SEARCH_RESULT_BUTTON_STYLE = {
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
  cursor: "pointer",
};
