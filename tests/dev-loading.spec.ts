import { test, expect } from "@playwright/test";
import { createServer, type Plugin, type ViteDevServer } from "vite";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fixtureDashboard } from "./fixtures";

// Reproduce Windows-style local file lookup while retaining Vite's extension
// priority. A .ts module must not shadow a .tsx component just by filename case.
function caseInsensitiveLocalImports(): Plugin {
  const extensions = [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json"];
  return {
    name: "test-case-insensitive-local-imports",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer || !source.startsWith(".") || extname(source)) return;
      const base = resolve(dirname(importer.split("?")[0]), source);
      let entries: string[];
      try {
        entries = await readdir(dirname(base));
      } catch {
        return;
      }
      for (const extension of extensions) {
        const wanted = (base.split(/[\\/]/).at(-1)! + extension).toLowerCase();
        const filename = entries.find(
          (entry) => entry.toLowerCase() === wanted,
        );
        if (filename) return join(dirname(base), filename);
      }
    },
  };
}

let server: ViteDevServer;
let cache: string;
let url: string;
test.beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), "attendance-vite-dev-"));
  server = await createServer({
    root: process.cwd(),
    cacheDir: cache,
    plugins: [caseInsensitiveLocalImports()],
    server: { host: "127.0.0.1", port: 0, strictPort: true },
    clearScreen: false,
    logLevel: "error",
  });
  await server.listen();
  url = server.resolvedUrls!.local[0];
});
test.afterAll(async () => {
  await server?.close();
  if (cache) await rm(cache, { recursive: true, force: true });
});

test("Vite development loads login and subject history with case-insensitive filenames", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("vl-tour-v1", "done"));
  await page.route("**/api/**", (route) =>
    route.fulfill({ json: fixtureDashboard() }),
  );
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
  await expect(
    page.getByRole("heading", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await page.getByLabel("CampX email or login ID").fill("fixture@example.test");
  await page.getByLabel("Password", { exact: true }).fill("test-only");
  await page.getByRole("button", { name: "Open my dashboard" }).click();
  await page
    .getByRole("button", { name: "Subjects", exact: true })
    .first()
    .click();
  await expect(page.locator(".subject-history").first()).toBeVisible();
  await expect(
    page.locator(".history-five").first().locator(".history-box"),
  ).toHaveCount(5);
  await page.locator(".history-toggle").first().click();
  await expect(page.locator(".history-expanded").first()).toBeVisible();
  expect(errors).toEqual([]);
  await page.close();
});
