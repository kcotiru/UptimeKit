import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const config = require('../tailwind.config.js');

const colors = config.theme.extend.colors;

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('design tokens', () => {
  const bg = colors.background;

  it('uses the design system surface colour', () => {
    expect(bg).toBe('#1c1c1c');
    expect(colors.surface.DEFAULT).toBe('#2a2a2a');
  });

  // The card must be legible by fill AND by border, per docs/design-system.md.
  it('separates the card from the page by more than a hairline', () => {
    expect(contrast(colors.surface.DEFAULT, bg)).toBeGreaterThan(1.15);
    expect(contrast(colors.surface.border, bg)).toBeGreaterThan(1.5);
  });

  it.each([
    ['body text', 'slate', '100'],
    ['tertiary text', 'slate', '300'],
    ['secondary text', 'slate', '400'],
    ['secondary text', 'slate', '500'],
    ['secondary text', 'slate', '600'],
    ['link text', 'brand', '400'],
  ])('%s (%s-%s) clears AA on the page', (_label, family, shade) => {
    expect(contrast(colors[family][shade], bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['up', 'degraded', 'down'])('status %s clears AA on the page', (name) => {
    expect(contrast(colors.status[name], bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('clears AA for every text token on a card, not just the page', () => {
    const card = colors.surface.DEFAULT;
    for (const shade of ['100', '300', '400']) {
      expect(contrast(colors.slate[shade], card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // brand-600 is a fill. Its label is white, never on-surface.
  it('carries a white label on the primary fill', () => {
    expect(contrast('#ffffff', colors.brand['600'])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the primary out of the text palette', () => {
    expect(contrast(colors.brand['600'], bg)).toBeLessThan(4.5);
  });

  // The one surface where coloured text meets a coloured ground.
  it('keeps text legible on the alarm fill', () => {
    const alarm = colors.surface.alarm;
    expect(contrast(colors.status.down, alarm)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.slate['100'], alarm)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colors.slate['400'], alarm)).toBeGreaterThanOrEqual(4.5);
  });
});
