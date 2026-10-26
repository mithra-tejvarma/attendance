import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(`${directory}/${entry.name}`)
      : [`${directory}/${entry.name}`],
  );
}
const buildId = createHash("sha256");
for (const file of [
  "index.html",
  "package-lock.json",
  "vite.config.ts",
  ...sourceFiles("src"),
  ...sourceFiles("public"),
].sort())
  buildId.update(file).update(readFileSync(file));
export default defineConfig({
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId.digest("hex").slice(0, 20)),
  },
  plugins: [
    react(),
    {
      name: "version-service-worker",
      writeBundle(_options, bundle) {
        const version = createHash("sha256")
          .update(Object.keys(bundle).sort().join("|"))
          .update(readFileSync("dist/index.html"))
          .update(readFileSync("public/sw.js"))
          .update(readFileSync("public/manifest.webmanifest"))
          .update(readFileSync("public/icon-512.png"))
          .digest("hex")
          .slice(0, 12);
        writeFileSync(
          "dist/sw.js",
          readFileSync("public/sw.js", "utf8").replace(
            "attendance-shell-v1",
            `attendance-shell-${version}`,
          ),
        );
      },
    },
  ],
});
