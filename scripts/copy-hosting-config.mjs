import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";

await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");

const serverDirectory = path.resolve("dist/server");
const workerEntryPath = path.join(serverDirectory, "index.js");
const vinextEntryPath = path.join(serverDirectory, "app.js");
const serverChunksDirectory = path.join(serverDirectory, "_next/static");
const ssrEntryPath = path.join(serverDirectory, "ssr/index.js");

// vinext currently emits a bare async function as its default Worker export.
// Cloudflare's current runtime treats that export as a WorkerEntrypoint class,
// so the Worker fails before the first request. Preserve vinext's function in
// app.js and expose the object-style fetch handler that Workers expects.
await rename(workerEntryPath, vinextEntryPath);

async function rewriteJavaScriptFiles(directory, rewrite) {
  const entries = await readdir(directory, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        await rewriteJavaScriptFiles(entryPath, rewrite);
        return;
      }

      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        return;
      }

      const source = await readFile(entryPath, "utf8");
      const output = rewrite(source);

      if (output !== source) {
        await writeFile(entryPath, output);
      }
    }),
  );
}

// Server chunks import named helpers from the original root entry. Point those
// imports at app.js, while leaving SSR-local ../../index.js imports untouched.
await rewriteJavaScriptFiles(serverChunksDirectory, (source) =>
  source.replaceAll("../../index.js", "../../app.js"),
);

let ssrSource = await readFile(ssrEntryPath, "utf8");
const createRequireImport = ssrSource.match(
  /import\{createRequire as ([A-Za-z_$][\w$]*)\}from"node:module";/,
);
const reactDomImport = ssrSource.match(
  /import\*as ([A-Za-z_$][\w$]*)\s*from"react-dom";/,
);

if (!createRequireImport || !reactDomImport) {
  throw new Error("Could not locate vinext SSR compatibility imports.");
}

const createRequireAlias = createRequireImport[1];
const reactDomAlias = reactDomImport[1];
const requireInitializer = new RegExp(
  `([A-Za-z_$][\\w$]*)=${createRequireAlias}\\(import\\.meta\\.url\\);`,
);
const requireMatch = ssrSource.match(requireInitializer);

if (!requireMatch) {
  throw new Error("Could not locate vinext's createRequire initializer.");
}

// Workerd does not provide import.meta.url at this bundled call site. The only
// generated require is for react-dom, which is already statically imported.
ssrSource = ssrSource.replace(
  requireInitializer,
  `${requireMatch[1]}=()=>${reactDomAlias};`,
);
ssrSource = ssrSource.replaceAll(
  "import(`../index.js`)",
  "import(`../app.js`)",
);
await writeFile(ssrEntryPath, ssrSource);

await writeFile(
  workerEntryPath,
  `import handleRequest from "./app.js";

export default {
  fetch(request, environment, context) {
    return handleRequest(request, environment, context);
  },
};
`,
);

// Sites uploads Worker modules directly, so package imports such as
// react/jsx-runtime must be bundled into the entry file before the archive is
// saved. A dry-run uses Wrangler's production bundler without publishing.
const workerBundleDirectory = path.resolve(".sites-worker-bundle");
const wranglerExecutable = path.resolve(
  "node_modules/.bin",
  process.platform === "win32" ? "wrangler.cmd" : "wrangler",
);

await rm(workerBundleDirectory, { force: true, recursive: true });
execFileSync(
  wranglerExecutable,
  [
    "deploy",
    workerEntryPath,
    "--dry-run",
    "--outdir",
    workerBundleDirectory,
    "--compatibility-date",
    "2026-07-01",
    "--compatibility-flags",
    "nodejs_compat",
    "--assets",
    path.resolve("dist/client"),
  ],
  {
    shell: process.platform === "win32",
    stdio: "inherit",
  },
);
await copyFile(
  path.join(workerBundleDirectory, "index.js"),
  workerEntryPath,
);
await rm(workerBundleDirectory, { force: true, recursive: true });
