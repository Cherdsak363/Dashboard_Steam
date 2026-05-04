/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html",
  ],
  theme: {
    extend: {
      colors: {
        steam: {
          blue: '#1b2838',
          lightBlue: '#66c0f4',
          darkBlue: '#171a21',
          gray: '#2a475e',
          text: '#c7d5e0',
        }
      },
      boxShadow: {
        'glow': '0 0 15px rgba(102, 192, 244, 0.4)',
      }
    },
  },
  plugins: [],
}

