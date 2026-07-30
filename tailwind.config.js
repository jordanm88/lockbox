export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        paper: "#f8fafc",
        neo: {
          yellow: "#f59e0b",
          pink: "#db2777",
          blue: "#2563eb",
          cyan: "#0ea5e9",
          green: "#059669",
          orange: "#ea580c",
          red: "#dc2626",
          purple: "#7c3aed",
        },
      },
      fontFamily: {
        display: ['"Manrope"', '"Segoe UI"', '"Helvetica Neue"', "Arial", "sans-serif"],
      },
      boxShadow: {
        brutal: "0 8px 20px rgba(15, 23, 42, 0.12)",
        "brutal-sm": "0 4px 12px rgba(15, 23, 42, 0.12)",
        "brutal-lg": "0 14px 28px rgba(15, 23, 42, 0.14)",
        "brutal-xl": "0 22px 44px rgba(15, 23, 42, 0.16)",
        "brutal-white": "0 8px 20px rgba(255, 255, 255, 0.18)",
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
      const border = `1px solid rgba(15, 23, 42, 0.14)`;
      addComponents({
        ".neo-border": {
          border,
          borderRadius: "12px",
        },
        ".neo-card": {
          border,
          boxShadow: theme("boxShadow.brutal"),
          backgroundColor: theme("colors.paper"),
          borderRadius: "16px",
        },
        ".neo-panel": {
          border,
          boxShadow: theme("boxShadow.brutal-lg"),
          backgroundColor: theme("colors.paper"),
          borderRadius: "20px",
        },
        ".neo-btn": {
          border,
          boxShadow: theme("boxShadow.brutal-sm"),
          backgroundColor: theme("colors.paper"),
          fontWeight: "600",
          borderRadius: "12px",
          transitionProperty: theme("transitionProperty.brutal"),
          transitionDuration: "140ms",
          transitionTimingFunction: "ease-out",
          cursor: "pointer",
        },
        ".neo-btn:hover": {
          transform: "translateY(-1px)",
          boxShadow: theme("boxShadow.brutal"),
        },
        ".neo-btn:active": {
          transform: "translateY(0)",
          boxShadow: theme("boxShadow.brutal-sm"),
        },
        ".neo-btn:disabled": {
          opacity: "0.5",
          cursor: "not-allowed",
          transform: "none",
        },
        ".neo-input": {
          border,
          borderRadius: "12px",
          backgroundColor: theme("colors.paper"),
          fontWeight: "500",
          outline: "none",
        },
        ".neo-input:focus": {
          boxShadow: `0 0 0 3px rgba(37, 99, 235, 0.22)`,
          borderColor: theme("colors.neo.blue"),
        },
      });
    },
  ],
};
