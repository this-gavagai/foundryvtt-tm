/** @type {import('tailwindcss').Config} */
import tailwindcss from '@headlessui/tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        '2xs': '320px',
        xs: '375px'
      }
    }
  },
  plugins: [tailwindcss]
}
