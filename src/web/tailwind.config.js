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
      // DevFocus Dark on a black ground. Ratios are against `background`
      // unless noted and are enforced by tests/tokens.test.ts.
      colors: {
        background: '#121212',
        surface: {
          DEFAULT: '#242424', // card / input fill, 1.21 step off the ground
          hover: '#2e2e2e',
          border: '#383838', // 1.60:1 vs background, clears the hairline guard
          // The alarm surface: a down row is a dark red block, not a pale
          // outline. Bright red text sits on it at 5.34:1.
          alarm: '#401518',
        },
        // 500/600 are FILLS — 2.98:1 on the ground, never text. 400 is the
        // text-safe tint at 9.40:1.
        brand: {
          400: '#a5b4fc',
          500: '#4f46e5',
          600: '#4f46e5', // white label on it: 6.29:1
          700: '#4338ca',
        },
        slate: {
          50: '#ffffff',
          100: '#ededed', // body, 16.0:1
          200: '#ededed',
          300: '#b4b4b4', // 9.04:1
          400: '#a1a1a1', // secondary, 7.25:1
          500: '#a1a1a1',
          600: '#a1a1a1',
          700: '#383838', // borders
          800: '#242424', // chips
        },
        // `up` is colourless on purpose: healthy is not an event.
        status: {
          up: '#a1a1a1',
          degraded: '#ffd285', // 13.2:1
          down: '#ff6166',     // 6.4:1
          unknown: '#a1a1a1',
        },
        amber: { 400: '#ffd285', 500: '#ffd285' },
        red: { 400: '#ff6166', 500: '#ff6166' },
      },
    },
  },
  plugins: [],
};
