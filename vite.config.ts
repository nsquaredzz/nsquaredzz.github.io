import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

// every generated blog page (see scripts/build-posts.mjs) is its own html entry
// stats/ is the private visitor dashboard (it shows nothing without the admin token)
const input: Record<string, string> = { main: "index.html", stats: "stats/index.html" };
const blog = path.resolve(__dirname, "blog");
if (fs.existsSync(blog)) {
  input["blog"] = "blog/index.html";
  for (const d of fs.readdirSync(blog, { withFileTypes: true }))
    if (d.isDirectory()) input[`blog-${d.name}`] = `blog/${d.name}/index.html`;
}

export default defineConfig({
  build: {
    target: "es2022",
    rollupOptions: { input },
  },
});
