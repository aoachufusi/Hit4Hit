import { chromium } from "playwright";

const url = process.argv[2] || "http://127.0.0.1:5174/";
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(url, { waitUntil: "networkidle", timeout: 15000 });
await page.waitForTimeout(1500);

const hasRoot = await page.locator("#root").innerText();
console.log("ROOT_TEXT:", hasRoot.slice(0, 200).replace(/\n/g, " | "));
console.log("ERRORS:", errors.length ? errors.join("\n") : "none");

await browser.close();
