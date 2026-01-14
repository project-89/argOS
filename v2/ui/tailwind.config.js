/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Custom ArgOS color palette
        argos: {
          bg: {
            primary: '#0a0a0f',
            secondary: '#12121a',
            tertiary: '#1a1a24',
            elevated: '#22222e',
          },
          border: {
            DEFAULT: '#2a2a3a',
            light: '#3a3a4a',
          },
          // God AI - Gold/Amber
          god: {
            DEFAULT: '#f59e0b',
            light: '#fbbf24',
            dark: '#d97706',
            glow: 'rgba(245, 158, 11, 0.3)',
          },
          // Spirits - Purple/Violet
          spirit: {
            DEFAULT: '#8b5cf6',
            light: '#a78bfa',
            dark: '#7c3aed',
            glow: 'rgba(139, 92, 246, 0.3)',
          },
          // Agents - Green/Emerald
          agent: {
            DEFAULT: '#10b981',
            light: '#34d399',
            dark: '#059669',
            glow: 'rgba(16, 185, 129, 0.3)',
          },
          // Systems - Blue/Cyan
          system: {
            DEFAULT: '#06b6d4',
            light: '#22d3ee',
            dark: '#0891b2',
            glow: 'rgba(6, 182, 212, 0.3)',
          },
          // World - Slate/Gray
          world: {
            DEFAULT: '#64748b',
            light: '#94a3b8',
            dark: '#475569',
          },
          // Status colors
          status: {
            success: '#22c55e',
            warning: '#eab308',
            error: '#ef4444',
            info: '#3b82f6',
          },
          // Text colors
          text: {
            primary: '#f1f5f9',
            secondary: '#94a3b8',
            muted: '#64748b',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        glow: {
          '0%': { opacity: 0.5 },
          '100%': { opacity: 1 },
        },
      },
      boxShadow: {
        'glow-god': '0 0 20px rgba(245, 158, 11, 0.3)',
        'glow-spirit': '0 0 20px rgba(139, 92, 246, 0.3)',
        'glow-agent': '0 0 20px rgba(16, 185, 129, 0.3)',
        'glow-system': '0 0 20px rgba(6, 182, 212, 0.3)',
      },
    },
  },
  plugins: [],
}
