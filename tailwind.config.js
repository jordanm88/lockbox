export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // CSS-variable-backed, not static hex, so every `text-ink`/`bg-paper`
        // utility everywhere in the app — these are the two dominant tokens
        // the whole neo-brutalist design is built from — automatically
        // follows the `:root` vs. `.dark` values defined in index.css,
        // without touching a single component. The plugin below does the
        // same for the shared `.neo-*` classes' border/shadow colors.
        ink: "var(--color-ink)",
        paper: "var(--color-paper)",
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
      // `--shadow-tint` is a dark navy in light mode (a shadow needs to be
      // *darker* than the surface it's under) but flips to black in dark
      // mode via index.css — a navy-tinted shadow at these opacities is
      // essentially invisible against a dark surface, which would make
      // every neo-panel/neo-card/neo-btn read as flat and undefined instead
      // of the "brutal" raised-block look the whole design is built around.
      boxShadow: {
        brutal: "0 8px 20px var(--shadow-tint, rgba(15, 23, 42, 0.12))",
        "brutal-sm": "0 4px 12px var(--shadow-tint, rgba(15, 23, 42, 0.12))",
        "brutal-lg": "0 14px 28px var(--shadow-tint-lg, rgba(15, 23, 42, 0.14))",
        "brutal-xl": "0 22px 44px var(--shadow-tint-xl, rgba(15, 23, 42, 0.16))",
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
      const border = `1px solid var(--color-border)`;
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
