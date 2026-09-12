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
      // DevFocus Dark, revised. The original navy ground (#0b1326) strained the
      // eyes, so the ground moves to a neutral Supabase-family dark. Ratios are
      // against `background` unless noted and are enforced by tests/tokens.test.ts.
      colors: {
        background: '#1c1c1c',
        surface: {
          DEFAULT: '#2a2a2a', // card / input fill, 1.19 step off the ground
          hover: '#323232',
          border: '#3e3e3e',
          // The alarm surface. A down row is a dark red block rather than a pale
          // outline; bright red text sits on it at 4.81:1.
          alarm: '#4a1d20',
        },
        // 500/600 are FILLS — 3.54:1, never text. 400 is the text-safe tint.
        brand: {
          400: '#7ca3fe', // 6.92:1
          500: '#2665fd',
          600: '#2665fd', // white label on it: 4.81:1
          700: '#1b4fd8',
        },
        slate: {
          50: '#ffffff',
          100: '#ededed', // body, 14.56:1
          200: '#ededed',
          300: '#b4b4b4', // 8.22:1
          400: '#a0a0a0', // secondary, 6.52:1
          500: '#a0a0a0',
          600: '#a0a0a0',
          700: '#3e3e3e', // borders
          800: '#2a2a2a', // chips
        },
        // `up` is colourless on purpose: healthy is not an event.
        status: {
          up: '#a0a0a0',
          degraded: '#ffd285', // 12.02:1
          down: '#ff6166',     // 5.81:1 — replaces the pale #ffb4ab
          unknown: '#a0a0a0',
        },
        // Green is not in this palette; transient success takes the primary tint.
        amber: { 400: '#ffd285', 500: '#ffd285' },
        red: { 400: '#ff6166', 500: '#ff6166' },
      },
    },
  },
  plugins: [],
};
