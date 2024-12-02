/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/client/**/*.{js,ts,jsx,tsx}"],
  safelist: [
    "text-blue-400",
    "text-green-400",
    "text-purple-400",
    "text-yellow-400",
    "text-cyan-400",
    "text-pink-400",
    "text-orange-400",
    "text-teal-400",
    "text-gray-400",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Consolas", "Monaco", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
