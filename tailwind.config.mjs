/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deliberately muted, slightly "stone"-tinted dark UI so the waveform
        // and the record button are the only saturated things on screen.
        ink: {
          950: '#0b0d0e',
          900: '#131617',
          800: '#1b1f21',
          700: '#262b2e',
          600: '#363d41',
          500: '#4b5459',
          400: '#6b767c',
          300: '#98a3a8',
          200: '#c3ccd0',
          100: '#e6ebed'
        },
        grass: {
          500: '#5b8f3f',
          400: '#6fa84c',
          300: '#8ac267'
        },
        redstone: {
          600: '#b8352f',
          500: '#d8453d',
          400: '#e86a63'
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
