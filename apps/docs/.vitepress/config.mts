import { defineConfig } from "vitepress";

export default defineConfig({
  lang: "en-US",
  title: "Starter Kitty",
  description: "Common app components that are safe-by-default.",
  markdown: { attrs: { disable: true } },
  themeConfig: {
    search: {
      provider: "local",
    },

    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      { text: "API", link: "/api" },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/opengovsg/starter-kitty" },
    ],
  },
});
