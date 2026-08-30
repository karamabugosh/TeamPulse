/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'sans-serif',
        ],
      },
      fontSize: {
        'page-title': ['1.875rem', { lineHeight: '1.2', fontWeight: '600', letterSpacing: '-0.025em' }],
        'section-title': ['1.25rem', { lineHeight: '1.35', fontWeight: '600', letterSpacing: '-0.02em' }],
        'card-title': ['1rem', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '-0.01em' }],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          elevated: 'hsl(var(--surface-elevated))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          hover: '#9B7AFF',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        cyan: {
          brand: '#06B6D4',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          border: 'hsl(var(--sidebar-border))',
        },
        /* Module accent palette */
        module: {
          ai: 'hsl(var(--module-ai))',
          jira: 'hsl(var(--module-jira))',
          slack: 'hsl(var(--module-slack))',
          reports: 'hsl(var(--module-reports))',
          blockers: 'hsl(var(--module-blockers))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: '0.875rem',
        '2xl': '1rem',
        '3xl': '1.25rem',
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.4), 0 8px 24px -12px rgb(0 0 0 / 0.55)',
        'card-hover':
          '0 14px 40px -12px rgb(0 0 0 / 0.6), 0 0 0 1px rgb(255 255 255 / 0.05)',
        elevated:
          '0 24px 64px -16px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.06)',
        glow: '0 0 28px -6px hsl(263 70% 58% / 0.4)',
        'glow-sm': '0 0 18px -4px hsl(263 70% 58% / 0.32)',
        'glow-ai': '0 0 24px -6px hsl(263 70% 58% / 0.35)',
        'glow-jira':
          '0 0 28px -8px hsl(243 75% 59% / 0.4), 0 0 40px -16px hsl(217 91% 60% / 0.28)',
        'glow-slack': '0 0 24px -6px hsl(152 76% 42% / 0.3)',
        'glow-reports': '0 0 24px -6px hsl(24 95% 53% / 0.3)',
        'glow-blockers': '0 0 24px -6px hsl(0 72% 51% / 0.3)',
        inset: 'inset 0 1px 0 rgb(255 255 255 / 0.04)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.35s ease-out',
        'slide-up': 'slide-up 0.35s ease-out',
      },
      transitionDuration: {
        250: '250ms',
        300: '300ms',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
