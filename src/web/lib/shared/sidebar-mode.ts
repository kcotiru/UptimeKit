/** How the nav rail behaves. */
export type SidebarMode = 'hover' | 'expanded' | 'collapsed';

export const SIDEBAR_MODES: SidebarMode[] = ['hover', 'expanded', 'collapsed'];

export const SIDEBAR_MODE_COOKIE = 'uk_sidebar';

export const DEFAULT_SIDEBAR_MODE: SidebarMode = 'hover';

/**
 * Narrows an untrusted cookie value to a mode.
 *
 * The preference rides in a cookie rather than localStorage so the server can
 * read it and render the correct width on the first pass. Read from
 * localStorage after mount instead and the server would always emit the
 * default, disagreeing with the client — a hydration mismatch, and a visible
 * flash of the wrong rail for anyone who picked a non-default mode.
 */
export function parseSidebarMode(value: string | undefined): SidebarMode {
  return SIDEBAR_MODES.includes(value as SidebarMode)
    ? (value as SidebarMode)
    : DEFAULT_SIDEBAR_MODE;
}
