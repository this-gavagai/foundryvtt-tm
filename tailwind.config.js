/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      screens: {
        '2xs': '320px',
        xs: '375px'
      }
    }
  },
  plugins: [require('@headlessui/tailwindcss')]
}
