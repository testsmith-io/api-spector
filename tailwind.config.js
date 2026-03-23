/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Surface palette — CSS vars swapped by theme toggle
        surface: {
          50:  'var(--surface-50)',
          100: 'var(--surface-100)',
          200: 'var(--surface-200)',
          400: 'var(--surface-400)',
          500: 'var(--surface-500)',
          700: 'var(--surface-700)',
          800: 'var(--surface-800)',
          900: 'var(--surface-900)',
          950: 'var(--surface-950)',
        },
        text: {
          DEFAULT: 'var(--text-primary)',
          muted:   'var(--text-muted)',
        },
        // Remap blue → Testsmith blue (#205d96)
        blue: {
          400: 'var(--ts-blue-400)',
          500: 'var(--ts-blue-500)',
          600: 'var(--ts-blue-600)',
          700: 'var(--ts-blue-700)',
        },
        // Remap emerald → Testsmith green (#9fc93c)
        emerald: {
          400: 'var(--ts-green-400)',
          800: 'var(--ts-green-800)',
          900: 'var(--ts-green-900)',
        },
      },
    },
  },
  plugins: [],
}
