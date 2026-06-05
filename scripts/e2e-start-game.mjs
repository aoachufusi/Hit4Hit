import { chromium } from "playwright";
import { readFileSync } from "fs";

const url = process.argv[2] || "http://localhost:5175/";
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
    })
);
const dbUrl = env.VITE_FIREBASE_DATABASE_URL;
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("pageerror", (e) => errors.push(`PAGE: ${e.message}\n${e.stack}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`CONSOLE: ${m.text()}`);
});

await page.goto(url, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Create a Game/i }).click();
await page.fill('input[placeholder="Host name"]', "HostTest");
await page.getByRole("button", { name: /CREATE/i }).click();
await page.waitForTimeout(2000);

const code = await page.locator(".hd").filter({ hasText: /^[A-Z0-9]{6}$/ }).first().innerText();
console.log("CODE:", code);

const playingPatch = {
  phase: "playing",
  player1: "HostTest",
  player2: "Player2",
  artist1: "Drake",
  artist2: "Kanye",
  hostName: "HostTest",
  members: { 0: "HostTest", 1: "Player2", 2: "Judge1" },
  judges: { 0: "Judge1" },
  scores: { 0: 0, 1: 0 },
  roundHistory: {},
  rounds: 5,
  currentRound: 1,
  p1Ready: false,
  p2Ready: false,
  updatedAt: Date.now(),
};

const res = await fetch(`${dbUrl}/games/${code}.json`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(playingPatch),
});
console.log("FIREBASE_PATCH:", res.status, await res.text());

await page.waitForTimeout(2500);
const text = await page.locator("#root").innerText();
console.log("AFTER_PLAYING:", text.slice(0, 500).replace(/\n/g, " | "));
console.log("ERRORS:", errors.length ? errors.join("\n---\n") : "none");

await browser.close();
