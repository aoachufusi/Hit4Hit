import { chromium } from "playwright";
import { readFileSync } from "fs";

const url = process.argv[2] || "http://localhost:5175/";
const env = Object.fromEntries(
  readFileSync("web/.env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    })
);
const dbUrl = env.VITE_FIREBASE_DATABASE_URL;
const errors = [];

async function run(asName, label) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(`${label} PAGE: ${e.message}`));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Join with Code/i }).click();
  await page.fill('input[placeholder="What should we call you?"]', asName);
  await page.fill('input[placeholder="e.g. HX7K2R"]', globalThis.GAME_CODE);
  await page.getByRole("button", { name: /JOIN LOBBY/i }).click();
  await page.waitForTimeout(2000);

  const text = await page.locator("#root").innerText();
  console.log(`${label}_SCREEN:`, text.slice(0, 200).replace(/\n/g, " | "));
  await browser.close();
}

// Create game as host in first browser
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(`HOST PAGE: ${e.message}\n${e.stack}`));
await page.goto(url, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Create a Game/i }).click();
await page.fill('input[placeholder="Host name"]', "HostTest");
await page.getByRole("button", { name: /CREATE/i }).click();
await page.waitForTimeout(2000);
globalThis.GAME_CODE = await page.locator(".hd").filter({ hasText: /^[A-Z0-9]{6}$/ }).first().innerText();

// Setup lobby via REST
await fetch(`${dbUrl}/games/${globalThis.GAME_CODE}.json`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    player1: "HostTest",
    player2: "Player2",
    artist1: "Drake",
    artist2: "Kanye",
    judges: { 0: "Judge1" },
    members: { 0: "HostTest", 1: "Player2", 2: "Judge1" },
  }),
});
await page.waitForTimeout(1500);

// Click start
await page.getByRole("button", { name: /START THE BATTLE/i }).click();
await page.waitForTimeout(2500);
let text = await page.locator("#root").innerText();
console.log("HOST_AFTER_START:", text.slice(0, 400).replace(/\n/g, " | "));
await browser.close();

await run("Judge1", "JUDGE");
await run("Player2", "P2");

console.log("ERRORS:", errors.length ? errors.join("\n---\n") : "none");
