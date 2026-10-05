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
          abc: document
            .querySelector("#abc")
            .value.replace(/^T:.*$/m, "T:Item " + i),
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
  await page.locator("input[type=file]").setInputFiles({
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

test("Supabase adapter CRUD with public key; failed writes stay unsaved without local fallback", async () => {
  const page = await browser.newPage();
  let rows = [],
    failure = false;
  const methods = [];
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: 'window.MEASURE_CONFIG={supabaseUrl:"https://example.supabase.co",supabaseKey:"sb_publishable_test"};',
    }),
  );
  await page.route(
    "https://example.supabase.co/rest/v1/measure_scores**",
    async (route) => {
      const request = route.request(),
        method = request.method();
      methods.push(method);
      assert.equal(request.headers().apikey, "sb_publishable_test");
      assert.equal(request.headers().authorization, undefined);
      if (failure && method === "PATCH")
        return route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({ code: "42501" }),
        });
      const id = new URL(request.url()).searchParams
        .get("id")
        ?.replace(/^eq\./, "");
      let result;
      if (method === "GET")
        result = id ? rows.filter((r) => r.id === id) : rows;
      if (method === "POST") {
        const r = {
          ...request.postDataJSON(),
          id: "8cab7796-98af-49e3-a911-6c8745f2102b",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        rows.push(r);
        result = [r];
      }
      if (method === "PATCH") {
        rows = rows.map((r) =>
          r.id === id ? { ...r, ...request.postDataJSON() } : r,
        );
        result = rows.filter((r) => r.id === id);
      }
      if (method === "DELETE") {
        result = rows.filter((r) => r.id === id);
        rows = rows.filter((r) => r.id !== id);
      }
      await route.fulfill({
        status: method === "POST" ? 201 : 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    },
  );
  await page.goto("http://127.0.0.1:3012");
  await page.waitForSelector(".abcjs-note");
  assert.match(await page.locator("#storage-mode").textContent(), /Supabase/);
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#save-status").textContent === "저장됨",
  );
  assert.equal(rows.length, 1);
  await page.reload();
  await page.waitForSelector(".abcjs-note");
  assert.equal(await page.locator("#title").inputValue(), rows[0].title);
  await page.locator("#title").fill("Cloud update");
  await page.locator("#save").click();
  await page.waitForFunction(
    () => document.querySelector("#save-status").textContent === "저장됨",
  );
  assert.equal(rows[0].title, "Cloud update");
  failure = true;
  await page.locator("#title").fill("Unsaved");
  await page.locator("#save").click();
  await page.waitForFunction(() =>
    document.querySelector(".toast").textContent.includes("RLS"),
  );
  assert.equal(await page.locator("#save").isDisabled(), false);
  assert.equal(rows[0].title, "Cloud update");
  assert.equal(
    await page.evaluate(() => localStorage.getItem(storageKey)),
    null,
  );
  failure = false;
  page.on("dialog", (d) => d.accept());
  await page.locator("#delete").click();
  await page.waitForFunction(() =>
    document.querySelector("#all-scores").textContent.includes("ABC"),
  );
  assert.equal(rows.length, 0);
  assert(
    methods.includes("POST") &&
      methods.includes("PATCH") &&
      methods.includes("DELETE"),
  );
  await page.close();
});
test("Build refuses secret Supabase keys", () => {
  const result = spawn(process.execPath, ["scripts/build.js"], {
    env: {
      ...process.env,
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_do_not_expose",
    },
    stdio: "pipe",
  });
  return new Promise((resolve, reject) => {
    let error = "";
    result.stderr.on("data", (b) => (error += b));
    result.on("exit", (code) => {
      try {
        assert.equal(code, 1);
        assert.match(error, /service_role\/secret/);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
  });
});

test("ABC T title drives editor, saved library and reopened legacy scores", async () => {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:3012");
  await page.waitForSelector(".abcjs-note");
  page.on("dialog", (d) => d.accept());
  await page.locator("#new-abc").click();
  await page
    .locator("#abc")
    .fill("X:1\nT:달빛 연습\nT:부제\nM:4/4\nL:1/4\nK:C\nC D E F |]");
  await page.waitForFunction(() => !document.querySelector("#save").disabled);
  assert.equal(await page.locator("#title").inputValue(), "달빛 연습");
  await page.locator("#save").click();
  await page.reload();
  await page.waitForSelector(".abcjs-note");
  assert.equal(await page.locator("#title").inputValue(), "달빛 연습");
  assert.match(await page.locator("#recent-scores").textContent(), /달빛 연습/);
  await page.locator("#title").fill("수정한 제목");
  assert.match(await page.locator("#abc").inputValue(), /^T:수정한 제목$/m);
  assert.match(await page.locator("#abc").inputValue(), /^T:부제$/m);
  await page.locator("#save").click();
  await page.reload();
  await page.waitForSelector(".abcjs-note");
  assert.equal(await page.locator("#title").inputValue(), "수정한 제목");
  await page.evaluate(() => {
    const rows = readScores();
    rows[0].title = "새 악보";
    localStorage.setItem(storageKey, JSON.stringify(rows));
  });
  await page.reload();
  await page.waitForSelector(".abcjs-note");
  assert.equal(await page.locator("#title").inputValue(), "수정한 제목");
  assert.match(
    await page.locator("#recent-scores").textContent(),
    /수정한 제목/,
  );
  assert.equal(await page.locator("#save").isDisabled(), false);
  await page.locator("#save").click();
  assert.equal(await page.evaluate(() => readScores()[0].title), "수정한 제목");
  await page.close();
});
