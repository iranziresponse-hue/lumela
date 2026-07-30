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
      boxShadow: {
        panel: "0 16px 45px rgba(16, 17, 20, 0.16)"
      }
    }
  },
  plugins: []
};
