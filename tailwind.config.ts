import type { Config } from "tailwindcss";

// Tailwind v3, not v4: v4's output needs Safari 16.4+, and MOP Radar supports iOS 15.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        sheet: "0 -4px 16px rgba(15, 23, 42, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
