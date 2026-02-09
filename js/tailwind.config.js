/* ============================================================
   Tailwind Config
   Colors reference CSS custom properties from styles/main.css
   (the single source of truth). No hex values duplicated here.
   ============================================================ */

tailwind.config = {
  theme: {
    extend: {
      fontFamily: {
        sans:    ['apertura', 'Apertura', 'system-ui', '-apple-system', 'sans-serif'],
        heading: ['Poppins', 'apertura', 'system-ui', 'sans-serif'],
      },
      colors: {
        sn: {
          violet:    'var(--sn-violet)',
          cyan:      'var(--sn-cyan)',
          magenta:   'var(--sn-magenta)',
          navy:      'var(--sn-navy)',
          light:     'var(--sn-light)',
          midviolet: 'var(--sn-midviolet)',
        }
      },
      borderRadius: {
        pill: '100px',
      },
      animation: {
        'fade-in':    'fadeIn 0.6s ease-out both',
        'scale-in':   'scaleIn 0.4s cubic-bezier(0.175,0.885,0.32,1.275) both',
        'pulse-glow': 'pulseGlow 1.5s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%':   { opacity: '0', transform: 'scale(0.7)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(var(--sn-cyan-rgb),0.3)' },
          '50%':      { boxShadow: '0 0 40px rgba(var(--sn-cyan-rgb),0.7)' },
        },
      },
    }
  }
};
