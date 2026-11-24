/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#07080B',
        surface: '#0E1016',
        surfaceHover: '#161A23',
        primary: {
          DEFAULT: '#7C6CFF',
          hover: '#6B5AF2',
          glow: '#B7ADFF',
          deep: '#241F44',
        },
        accent: {
          cyan: '#22D3EE',
          emerald: '#34D399',
          rose: '#FB7185',
          amber: '#FBBF24',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Instrument Serif"', 'Georgia', 'Cambria', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 30px 60px -40px rgba(0,0,0,0.95)',
        lift: '0 24px 48px -28px rgba(0,0,0,0.9)',
        glow: '0 18px 44px -18px rgba(124,108,255,0.7)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'none' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.45', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.35s ease-out both',
        'scale-in': 'scale-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        breathe: 'breathe 7s ease-in-out infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 14s linear infinite',
      },
    },
  },
  plugins: [],
}
