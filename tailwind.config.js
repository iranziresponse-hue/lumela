module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#101114",
        powerOn: "#15a46f",
        powerOff: "#d83838",
        sun: "#f7c948"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"]
      },
      boxShadow: {
        panel: "0 1px 2px rgba(16, 17, 20, 0.06), 0 20px 40px -12px rgba(16, 17, 20, 0.14)",
        lift: "0 1px 2px rgba(16, 17, 20, 0.08), 0 30px 60px -16px rgba(16, 17, 20, 0.22)"
      }
    }
  },
  plugins: []
};
