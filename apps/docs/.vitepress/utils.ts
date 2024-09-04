import fs from "node:fs";
import path from "node:path";

export const scanDir = (dir: string) => {
  let res = fs
    .readdirSync(path.resolve(__dirname, `../${dir}`))
    .filter((item) => !item.startsWith(".")) as string[];
  if (res) {
    const arr = [];
    for (let item of res) {
      const parts = item.split(".");

      let currItem = arr;
      let currentPath = "";
      while (parts.length > 2) {
        const part = parts.shift();
        currentPath += (currentPath === "" ? "" : ".") + part;
        const found = currItem.find((item) => item.text === part);
        if (found) {
          currItem = found.items;
        } else {
          const newItem = {
            text: part,
            items: [],
            link: path.join(dir, currentPath),
          };
          currItem.push(newItem);
          currItem = newItem.items;
        }
      }
      const found = currItem.find((item) => item.text === parts[0]);
      if (!found)
        currItem.push({
          text: parts[0],
          items: [],
          link: path.join(dir, item),
        });
    }
    return arr;
  } else {
    console.warn("No files found in the directory");
    return [];
  }
};
