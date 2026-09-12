/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // Inter is injected by next/font in app/layout.tsx as --font-inter.
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // DevFocus Dark — docs/design-system.md.
      //
      // The system names these surface / on-surface / primary / secondary /
      // error. The Tailwind names below are the ones already used throughout
      // this app, retinted in place: `background` is the page, `surface` is a
      // card. Retinting rather than renaming means the whole app re-skins
      // without touching a component.
      //
      // Ratios are against `background` and are enforced by tests/tokens.test.ts.
      colors: {
        background: '#0b1326',
        surface: {
          DEFAULT: '#172340', // card / input fill
          hover: '#1f2e52',
          border: '#2a3a5c',  // system: outline
        },
        // system: primary. 500/600 are FILLS — 3.84:1, never text.
        // 400 is the text-safe tint at 7.5:1.
        brand: {
          400: '#7ca3fe',
          500: '#2665fd',
          600: '#2665fd',
          700: '#1b4fd8',
        },
        // Neutral text ramp. system: on-surface, dimmed.
        slate: {
          50: '#eaf0ff',
          100: '#dae2fd',
          200: '#dae2fd',
          300: '#a8b2cf',
          400: '#8f9bbd',
          500: '#8f9bbd',
          600: '#8f9bbd',
          700: '#2a3a5c',
          800: '#172340',
        },
        // Status lands on the status WORD and nowhere else.
        status: {
          up: '#8f9bbd',       // colourless on purpose: healthy is not an event
          degraded: '#ffd285',
          down: '#ffb4ab',
          unknown: '#8f9bbd',
        },
        // Green is not in this palette. A transient success affordance
        // ("Copied", "Delivered (200)") takes the primary tint; steady-state
        // health stays neutral.
        emerald: { 400: '#7ca3fe', 500: '#7ca3fe' },
        amber: { 400: '#ffd285', 500: '#ffd285' },
        red: { 400: '#ffb4ab', 500: '#ffb4ab' },
      },
    },
  },
  plugins: [],
};
