/**
 * Neo-Brutalism design tokens for Lockbox.
 * Thick black borders + hard offset shadows + loud color blocks, no soft edges.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#000000",
        paper: "#FFFDF7",
        neo: {
          yellow: "#FFE600",
          pink: "#FF4FD8",
          blue: "#3D5AFE",
          cyan: "#00E5FF",
          green: "#00FF85",
          orange: "#FF7A00",
          red: "#FF3B3B",
          purple: "#B026FF",
        },
      },
      fontFamily: {
        display: [
          '"Arial Black"',
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        brutal: "4px 4px 0px 0px #000000",
        "brutal-sm": "2px 2px 0px 0px #000000",
        "brutal-lg": "8px 8px 0px 0px #000000",
        "brutal-xl": "12px 12px 0px 0px #000000",
        "brutal-white": "4px 4px 0px 0px #FFFFFF",
      },
      transitionProperty: {
        brutal: "transform, box-shadow",
      },
      keyframes: {
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-8px)" },
          "40%": { transform: "translateX(8px)" },
          "60%": { transform: "translateX(-6px)" },
          "80%": { transform: "translateX(6px)" },
        },
      },
      animation: {
        shake: "shake 400ms ease-in-out",
      },
    },
  },
  plugins: [
    function ({ addComponents, theme }) {
      const border = `4px solid ${theme("colors.ink")}`;
      addComponents({
        ".neo-border": {
          border,
        },
        ".neo-card": {
          border,
          boxShadow: theme("boxShadow.brutal"),
          backgroundColor: theme("colors.paper"),
        },
        ".neo-panel": {
          border,
          boxShadow: theme("boxShadow.brutal-lg"),
          backgroundColor: theme("colors.paper"),
        },
        ".neo-btn": {
          border,
          boxShadow: theme("boxShadow.brutal"),
          backgroundColor: theme("colors.paper"),
          fontWeight: "800",
          textTransform: "uppercase",
          letterSpacing: "0.02em",
          transitionProperty: theme("transitionProperty.brutal"),
          transitionDuration: "100ms",
          transitionTimingFunction: "ease-out",
          cursor: "pointer",
        },
        ".neo-btn:hover": {
          transform: "translate(2px, 2px)",
          boxShadow: theme("boxShadow.brutal-sm"),
        },
        ".neo-btn:active": {
          transform: "translate(4px, 4px)",
          boxShadow: "none",
        },
        ".neo-btn:disabled": {
          opacity: "0.5",
          cursor: "not-allowed",
          transform: "none",
        },
        ".neo-input": {
          border,
          backgroundColor: theme("colors.paper"),
          fontWeight: "700",
          outline: "none",
        },
        ".neo-input:focus": {
          boxShadow: theme("boxShadow.brutal-sm"),
        },
      });
    },
  ],
};
