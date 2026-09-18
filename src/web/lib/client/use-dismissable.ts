'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Closes a popup on an outside press or Escape, and hands focus back to its
 * trigger when Escape closes it.
 *
 * Shared by the account menu and the sidebar-mode menu. A menu that only
 * closes via its own trigger stays open behind whatever the user does next,
 * and two hand-rolled copies of this logic would drift the moment one of them
 * gains a fix the other does not.
 */
export function useDismissable(
  open: boolean,
  close: () => void,
  refs: { menu: RefObject<HTMLElement>; trigger: RefObject<HTMLElement> }
): void {
  const { menu, trigger } = refs;

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      trigger.current?.focus();
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close, menu, trigger]);
}
