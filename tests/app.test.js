const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");
let server, browser;
const abc =
  "X:1\nT:Imported\nM:4/4\nL:1/4\nQ:1/4=120\nK:C\nC D E F | G A B c |]";
before(async () => {
  server = spawn(process.execPath, ["scripts/serve.js"], {
    env: { ...process.env, PORT: "3012" },
    stdio: "pipe",
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (b) => {
      if (b.toString().includes("started")) resolve();
    });
    server.on("error", reject);
    server.on("exit", () => reject(Error("server exited")));
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
  });
});
after(async () => {
  await browser?.close();
  const done = new Promise((r) => server.once("exit", r));
  server.kill("SIGTERM");
  await done;
});
test("Static browser app: edit/save/reload, note seek and audio, recent five, list/search/delete", async () => {
  const page = await browser.newPage();
  const errors = [],
    apiRequests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/")) apiRequests.push(r.url());
  });
  await page.goto("http://127.0.0.1:3012");
  await page.waitForSelector(".abcjs-note");
  assert.equal(await page.locator("[data-tab=scan]").count(), 0);
  await page.locator("[data-tab=abc]").click();
  await page.locator("#abc").fill(abc);
  await page.locator("#title").fill("Saved test");
  await page.waitForTimeout(450);
  await page.locator("#save").click();
  await page.reload();
  await page.waitForSelector(".abcjs-note");
  assert.equal(await page.locator("#title").inputValue(), "Saved test");
  await page.locator("#bpm").fill("60");
  await page.locator("#bpm").dispatchEvent("change");
  await page.locator("#save").click();
  await page.locator(".abcjs-note").nth(4).locator("path").first().click();
  await page.waitForFunction(
    () => document.querySelector("#play").textContent === "Ⅱ",
  );
  await page.waitForFunction(() => document.querySelector(".playing-note"));
  const state = await page.evaluate(() => ({
    position,
    audible: synth.audioBuffers.some((b) =>
      b.getChannelData(0).some((v) => Math.abs(v) > 0.001),
    ),
  }));
  assert(state.position >= 4000 && state.position < 6000);
  assert(state.audible);
  await page.locator("#reset").click();
  await page.evaluate(async () => {
    for (let i = 0; i < 6; i++)
      await scoreStore("/api/scores", {
        method: "POST",
        body: JSON.stringify({
          title: "Item " + i,
          abc: document.querySelector("#abc").value,
          bpm: 100,
        }),
      });
    await refresh();
  });
  assert.equal(await page.locator("#recent-scores .library").count(), 5);
  await page.locator("#library-open").click();
  assert.equal(await page.locator("#all-scores > div").count(), 7);
  await page.locator("#search").fill("Saved test");
  assert.equal(await page.locator("#all-scores > div").count(), 1);
  page.on("dialog", (d) => d.accept());
  await page.locator("#all-scores > div button").last().click();
  await page.waitForFunction(() =>
    document.querySelector("#all-scores").textContent.includes("검색 결과"),
  );
  await page.reload();
  await page.waitForSelector(".abcjs-note");
  assert.equal(await page.evaluate(() => readScores().length), 6);
  assert.deepEqual(apiRequests, []);
  assert.deepEqual(errors, []);
  await page.close();
});
test("ABC file import, manual save and export", async () => {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3012");
  await page.waitForSelector(".abcjs-note");
  page.on("dialog", (d) => d.accept());
  await page.locator("#upload").click();
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "sample.abc",
      mimeType: "text/plain",
      buffer: Buffer.from(abc),
    });
  await page.locator("#convert").click();
  await page.waitForFunction(
    () => document.querySelector("#title").value === "Imported",
  );
  assert.equal(await page.locator("#title").inputValue(), "Imported");
  assert.equal(await page.locator(".abcjs-note").count(), 8);
  assert.equal(await page.locator("#bpm").inputValue(), "120");
  assert.equal(await page.evaluate(() => readScores().length), 0);
  await page.locator("#save").click();
  assert.equal(await page.evaluate(() => readScores().length), 1);
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "Imported.abc");
  await page.close();
});
test("Quota failure preserves unsaved ABC and does not report success", async () => {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3012");
  await page.waitForSelector(".abcjs-note");
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException("Full", "QuotaExceededError");
    };
  });
  await page.locator("#save").click();
  assert.match(await page.locator(".toast").textContent(), /저장 공간/);
  assert.equal(await page.locator("#save").isDisabled(), false);
  assert.equal(await page.evaluate(() => current), null);
  await page.close();
});
test("6/8 audio and highlighting preserve quarter-note BPM", async () => {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3012");
  await page.waitForSelector(".abcjs-note");
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
