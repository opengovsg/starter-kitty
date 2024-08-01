import { defineConfig } from "vitepress";
import { scanDir } from "./utils";

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
      { text: "Packages", link: "/packages" },
      { text: "API", link: "/api" },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/opengovsg/starter-kitty" },
    ],

    docFooter: {
      prev: false,
      next: false,
    },

    sidebar: {
      "/packages/": scanDir("packages"),
      "/api/": scanDir("api"),
    },
  },
  ignoreDeadLinks: [
    // ignore all localhost links
    /^https?:\/\/localhost/,
  ],
});
