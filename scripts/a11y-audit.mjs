// Phase 8 regression/a11y sweep. Serves the repo over plain HTTP (file://
// breaks axe's own CSS introspection via CORS, producing false-positive
// color-contrast findings) and runs axe-core (WCAG 2A/2AA) against every
// rebrand-touched page in both themes.
import { chromium } from "playwright";
import { createServer } from "http";
import { readFile } from "fs/promises";
import path from "path";
import fs from "fs";

const base = path.resolve(new URL(".", import.meta.url).pathname, "..");
const port = 8934;
const pages = ["index.html", "pricing.html", "live-demo.html", "app.html", "konto.html", "korkortet.html", "förbättring.html", "larare.html", "admin.html", "provia-hp.html"];
const axeSource = fs.readFileSync(path.join(base, "node_modules/axe-core/axe.min.js"), "utf8");

const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const filePath = path.join(base, decodeURIComponent(req.url.split("?")[0]));
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise(r => server.listen(port, r));

const browser = await chromium.launch();
let violationCount = 0;

for (const file of pages) {
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const consoleErrors = [];
    page.on("pageerror", e => consoleErrors.push("pageerror: " + e.message));
    page.on("console", msg => { if (msg.type() === "error") consoleErrors.push("console: " + msg.text()); });
    if (theme === "light") await page.addInitScript(() => localStorage.setItem("proviaai_theme", "light"));
    await page.goto(`http://localhost:${port}/${file}`);
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const accept = [...document.querySelectorAll("button")].find(b => /acceptera alla/i.test(b.textContent || ""));
      if (accept) accept.click();
    }).catch(() => {});
    await page.waitForTimeout(200);
    await page.evaluate(axeSource);
    const result = await page.evaluate(async () => {
      const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map(n => n.target.join(" ")) }));
    });
    console.log(`${file} [${theme}] — console errors: ${consoleErrors.length}, axe violations: ${result.length}`);
    consoleErrors.forEach(e => console.log("  " + e));
    result.forEach(v => { violationCount++; console.log(`  [${v.impact}] ${v.id} (${v.nodes} nodes): ${v.help} | e.g. ${v.targets.join(" ; ")}`); });
    await page.close();
  }
}
await browser.close();
server.close();
console.log(`\nTotal violations: ${violationCount}`);
process.exit(violationCount > 0 ? 1 : 0);
