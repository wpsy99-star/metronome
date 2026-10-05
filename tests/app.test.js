const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "measure-test-"));
let server, browser;
const base = "http://127.0.0.1:3012";
const abc = "X:1\nT:Test\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G A B c |]";
async function api(url, options = {}) {
  const r = await fetch(base + url, options);
  return { status: r.status, body: await r.json() };
}
before(async () => {
  server = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "3012", MEASURE_DATA_DIR: data },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (b) => {
      if (b.toString().includes("started")) resolve();
    });
    server.on("error", reject);
    server.on("exit", () => reject(new Error("server exited")));
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
});
after(async () => {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  fs.rmSync(data, { recursive: true, force: true });
});
test("SQLite CRUD, validation and original-file protection", async () => {
  assert.equal((await api("/api/scores")).body.length, 0);
  assert.equal(
    (
      await api("/api/scores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "", abc, bpm: 120 }),
      })
    ).status,
    400,
  );
  const r = await api("/api/scores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "test", abc, bpm: 120 }),
  });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal((await api("/api/scores/" + id)).body.abc, abc);
  assert.equal(
    (
      await api("/api/scores/" + id, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "updated", abc, bpm: 80 }),
      })
    ).status,
    200,
  );
  assert.equal((await api("/api/scores/" + id)).body.bpm, 80);
  assert.equal(
    (await api("/api/scores/" + id, { method: "DELETE" })).status,
    200,
  );
  assert.equal((await api("/api/scores/" + id)).status, 404);
});
test("Browser: ABC render/edit/save, recent five, full list, BPM, note seek and synchronized color", async () => {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForSelector("#notation .abcjs-note");
  assert.equal(await page.locator("#recent-scores .library").count(), 0);
  await page.locator("[data-tab=abc]").click();
  await page.locator("#abc").fill(abc);
  await page.locator("#title").fill("Browser score");
  await page.waitForTimeout(500);
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#save-status").textContent === "저장됨",
  );
  await page.reload();
  await page.waitForSelector("#notation .abcjs-note");
  assert.equal(await page.locator("#title").inputValue(), "Browser score");
  await page.locator("[data-tab=abc]").click();
  assert.equal(await page.locator("#abc").inputValue(), abc);
  await page.locator("[data-tab=score]").click();
  await page.locator("#bpm").fill("60");
  await page.locator("#bpm").dispatchEvent("change");
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#save-status").textContent === "저장됨",
  );
  await page
    .locator("#notation .abcjs-note")
    .nth(4)
    .locator("path")
    .first()
    .click();
  await page.waitForFunction(
    () => document.querySelector("#play").textContent === "Ⅱ",
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".playing-note").length > 0,
  );
  const state = await page.evaluate(() => ({
    position,
    playing,
    bpm: document.querySelector("#bpm").value,
    clock: audio.currentTime,
    startClock,
    synthDuration: synth.duration,
    timings: timings.map((t) => t.milliseconds),
  }));
  assert.equal(state.bpm, "60");
  assert(state.position >= 4000 && state.position < 6000);
  assert(state.playing);
  assert(
    Math.abs(state.position - (state.clock - state.startClock) * 1000) < 100,
  );
  await page.locator("#play").click();
  assert.equal(await page.locator("#play").textContent(), "▶");
  await page.locator("#reset").click();
  assert.equal(await page.locator(".playing-note").count(), 0);
  // Render a high resolution scan for a real OMR end-to-end test.
  await page.locator("[data-tab=abc]").click();
  await page
    .locator("#abc")
    .fill(
      "X:1\nT:Twinkle\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC C G G | A A G2 | F F E E | D D C2 |\nG G F F | E E D2 | G G F F | E E D2 |\nC C G G | A A G2 | F F E E | D D C2 |]",
    );
  await page.waitForTimeout(500);
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#save-status").textContent === "저장됨",
  );
  await page.locator("[data-tab=score]").click();
  await page
    .locator("#notation")
    .screenshot({ path: path.join(data, "scan.png") });
  for (let i = 0; i < 6; i++)
    await api("/api/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Score " + i, abc, bpm: 100 }),
    });
  await page.reload();
  await page.waitForSelector("#recent-scores .library");
  assert.equal(await page.locator("#recent-scores .library").count(), 5);
  await page.locator("#library-open").click();
  assert.equal(await page.locator("#all-scores > div").count(), 7);
  await page.locator("#search").fill("Browser");
  assert.equal(await page.locator("#all-scores > div").count(), 1);
  page.on("dialog", (d) => d.accept());
  await page.locator("#all-scores > div button").last().click();
  await page.waitForFunction(() =>
    document.querySelector("#all-scores").textContent.includes("검색 결과"),
  );
  assert.deepEqual(errors, []);
  await page.close();
});
test(
  "Scan to ABC via real Audiveris, persists original and playable notation",
  { timeout: 260000 },
  async () => {
    const scan = path.join(data, "scan.png");
    assert(fs.existsSync(scan));
    const form = new FormData();
    form.append(
      "file",
      new Blob([fs.readFileSync(scan)], { type: "image/png" }),
      "scan.png",
    );
    const r = await api("/api/import", { method: "POST", body: form });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const score = (await api("/api/scores/" + r.body.id)).body;
    assert.match(score.abc, /^K:/m);
    assert.match(score.abc, /[CDEFGAB]/);
    const original = await fetch(
      base + "/api/scores/" + r.body.id + "/original",
    );
    assert.equal(original.status, 200);
    const page = await browser.newPage();
    await page.goto(base);
    await page.waitForSelector("#notation .abcjs-note");
    await page.locator("#play").click();
    await page.waitForFunction(
      () => document.querySelector("#play").textContent === "Ⅱ",
    );
    assert.equal(
      await page.locator("#notation .abcjs-note").count(),
      42,
      score.abc,
    );
    await page.close();
  },
);
test("Compound meter playback uses quarter-note BPM consistently", async () => {
  const page = await browser.newPage();
  await page.goto(base);
  await page.waitForSelector("#notation .abcjs-note");
  await page.locator("[data-tab=abc]").click();
  await page
    .locator("#abc")
    .fill("X:1\nT:Compound\nM:6/8\nL:1/8\nK:C\nC D E F G A |]");
  await page.locator("#bpm").fill("60");
  await page.locator("#bpm").dispatchEvent("change");
  await page.locator("[data-tab=score]").click();
  await page.locator("#play").click();
  await page.waitForFunction(
    () => document.querySelector("#play").textContent === "Ⅱ",
  );
  const state = await page.evaluate(() => ({
    end: timings.at(-1).milliseconds,
    duration: synth.duration,
  }));
  assert.equal(state.end, 3000);
  assert(Math.abs(state.duration - 3) < 0.5);
  await page.close();
});
