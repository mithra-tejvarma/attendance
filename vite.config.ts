import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
export default defineConfig({
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
