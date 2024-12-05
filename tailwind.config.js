/** @type {import('tailwindcss').Config} */
import tailwindcss from '@headlessui/tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        xs: '360px'
      }
    }
  },
  plugins: [tailwindcss]
}
