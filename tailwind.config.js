// Tokens come from the Claude Design export in design/PULSE-2.6.dc.html.
// Keep in sync with src/ui/theme.ts, which exposes the same values to non-className APIs (SVG, navigation).
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        ink: '#151515',
        page: '#F7F7F9',
        card: '#FFFFFF',
        gray: {
          1: '#86868B',
          2: '#6E6E73',
          3: '#3A3A3C',
          4: '#A1A1A6',
          5: '#C7C7CC',
        },
        hairline: '#F2F2F4',
        line: { DEFAULT: '#EEEEF0', input: '#E5E5EA', track: '#E3E3E8', disabled: '#D5D5DA' },
        fill: { seg: '#EBEBEE', pill: '#EFEFF2', input: '#FAFAFB' },
        coral: { DEFAULT: '#ED625E', text: '#C8433F', tint: '#FDECEB', deep: '#9B3532', line: '#F3CFCD' },
        amber: { DEFAULT: '#F4B860', text: '#9A6210', tint: '#FDF3E2', deep: '#7A4E0B' },
        green: { DEFAULT: '#27A878', text: '#1E7F5B', tint: '#E6F5EE' },
        indigo: { DEFAULT: '#46508A', tint: '#E9EBF6', line: '#E1E3F2' },
      },
      borderRadius: { card: '22px', feature: '24px', hero: '28px', sheet: '32px', input: '13px', tile: '11px' },
    },
  },
  plugins: [],
};
