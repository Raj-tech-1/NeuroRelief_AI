/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#FFF0F6',
          100: '#FDDDE6',
          200: '#FBB6CE',
          300: '#F687B3',
          400: '#ED64A6',
          500: '#D53F8C',
          600: '#B83280',
          700: '#97266D',
          800: '#702459',
          900: '#521B41',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
