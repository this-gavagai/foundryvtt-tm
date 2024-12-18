/** @type {import('tailwindcss').Config} */
import tailwindcss from '@headlessui/tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        xs: '360px',
        pwa: { raw: '(display-mode: standalone)' }
      },
      dropShadow: {
        glow: '0 0 4px rgba(150, 150, 255, 0.85)'
      },
      animation: {
        rollin: 'shown 300ms ease-in-out'
      },
      keyframes: {
        shown: {
          '0%': {
            opacity: 0,
            transform: 'rotateX(-90deg)',
            'transform-origin': 'top center',
            height: 0
          },
          '100%': { opacity: 1, transform: 'none', height: '28px' }
        }
      }
    }
  },
  plugins: [
    tailwindcss,
    function ({ addVariant }) {
      addVariant('initial', 'html :where(&)')
    }
  ]
}
