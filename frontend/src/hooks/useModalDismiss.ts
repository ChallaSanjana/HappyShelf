import { useEffect } from 'react';

/**
 * Closes a modal on Escape and stops the page behind it from scrolling.
 *
 * None of the modals handled Escape, so a keyboard user who opened one had
 * no way out except tabbing to the close button — and the page underneath
 * kept scrolling behind the overlay.
 */
export function useModalDismiss(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);
}
