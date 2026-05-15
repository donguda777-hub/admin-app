/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        neon: {
          gold: "#FFD600",
          amber: "#fbbf24",
        },
      },
      boxShadow: {
        "neon-gold":
          "0 0 12px rgba(255, 214, 0, 0.45), 0 0 28px rgba(255, 180, 0, 0.2)",
        "neon-gold-lg":
          "0 0 20px rgba(255, 214, 0, 0.55), 0 0 48px rgba(255, 170, 0, 0.25)",
      },
    },
  },
  plugins: [],
};
