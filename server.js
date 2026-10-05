const express = require("express");
const multer = require("multer");
const { DatabaseSync } = require("node:sqlite");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const app = express(),
  root = __dirname,
  data = process.env.MEASURE_DATA_DIR || path.join(root, "data");
fs.mkdirSync(path.join(data, "uploads"), { recursive: true });
const db = new DatabaseSync(path.join(data, "measure.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS scores(id TEXT PRIMARY KEY,title TEXT NOT NULL,abc TEXT NOT NULL,bpm INTEGER NOT NULL,original TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)",
);
app.use(express.json({ limit: "1mb" }));
app.use("/vendor", express.static(path.join(root, "node_modules/abcjs/dist")));
app.use(express.static(path.join(root, "public")));
function valid(body) {
  return (
    typeof body.title === "string" &&
    body.title.trim().length > 0 &&
    body.title.length <= 200 &&
    typeof body.abc === "string" &&
    body.abc.length <= 500000 &&
    /^K:/m.test(body.abc) &&
    Number.isInteger(body.bpm) &&
    body.bpm >= 30 &&
    body.bpm <= 240
  );
}
app.get("/api/scores", (req, res) =>
  res.json(
    db
      .prepare(
        "SELECT id,title,bpm,created_at,updated_at FROM scores ORDER BY created_at DESC,id DESC",
      )
      .all(),
  ),
);
app.get("/api/scores/:id", (req, res) => {
  const row = db.prepare("SELECT * FROM scores WHERE id=?").get(req.params.id);
  row
    ? res.json(row)
    : res.status(404).json({ error: "악보를 찾을 수 없습니다." });
});
app.post("/api/scores", (req, res) => {
  if (!valid(req.body))
    return res
      .status(400)
      .json({ error: "제목, ABC 코드와 BPM(30–240)을 확인하세요." });
  const id = randomUUID(),
    now = new Date().toISOString();
  db.prepare("INSERT INTO scores VALUES(?,?,?,?,?,?,?)").run(
    id,
    req.body.title.trim(),
    req.body.abc,
    req.body.bpm,
    null,
    now,
    now,
  );
  res.status(201).json({ id });
});
app.put("/api/scores/:id", (req, res) => {
  if (!valid(req.body))
    return res
      .status(400)
      .json({ error: "제목, ABC 코드와 BPM을 확인하세요." });
  const r = db
    .prepare("UPDATE scores SET title=?,abc=?,bpm=?,updated_at=? WHERE id=?")
    .run(
      req.body.title.trim(),
      req.body.abc,
      req.body.bpm,
      new Date().toISOString(),
      req.params.id,
    );
  r.changes
    ? res.json({ ok: true })
    : res.status(404).json({ error: "악보를 찾을 수 없습니다." });
});
app.delete("/api/scores/:id", (req, res) => {
  const row = db
    .prepare("SELECT original FROM scores WHERE id=?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "악보를 찾을 수 없습니다." });
  db.prepare("DELETE FROM scores WHERE id=?").run(req.params.id);
  if (row.original)
    fs.rmSync(path.join(data, "uploads", row.original), { force: true });
  res.json({ ok: true });
});
app.get("/api/scores/:id/original", (req, res) => {
  const row = db
    .prepare("SELECT original FROM scores WHERE id=?")
    .get(req.params.id);
  if (!row?.original) return res.sendStatus(404);
  res.sendFile(path.join(data, "uploads", row.original));
});
const audiveris =
  process.env.AUDIVERIS_BIN ||
  path.join(root, "tools/audiveris/opt/audiveris/bin/Audiveris");
app.get("/api/status", (req, res) =>
  res.json({
    omr: fs.existsSync(audiveris),
    engine: "Audiveris 5.11.0",
    database: "SQLite",
  }),
);
const upload = multer({
  dest: path.join(data, "uploads"),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
let busy = false;
function run(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd: root,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out = (out + b).slice(-1000000)));
    child.stderr.on("data", (b) => (err = (err + b).slice(-16000)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          "악보 인식 시간이 초과되었습니다. 더 작은 파일로 다시 시도하세요.",
        ),
      );
    }, 240000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              command === "python3"
                ? err.trim().slice(0, 300)
                : "악보 처리에 실패했습니다. 선명한 인쇄 악보를 사용하거나 ABC 코드를 직접 입력하세요.",
            ),
          );
    });
  });
}
function findXml(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findXml(p));
    else if (/\.(mxl|musicxml)$/i.test(p)) found.push(p);
  }
  return found;
}
app.post("/api/import", upload.single("file"), async (req, res) => {
  let job, file;
  try {
    if (!req.file) return res.status(400).json({ error: "파일을 선택하세요." });
    file = req.file.path;
    const head = fs.readFileSync(file).subarray(0, 8);
    const ext =
      head.subarray(0, 4).toString() === "%PDF"
        ? ".pdf"
        : head[0] === 137 && head.subarray(1, 4).toString() === "PNG"
          ? ".png"
          : head[0] === 255 && head[1] === 216
            ? ".jpg"
            : null;
    if (!ext)
      return res.status(400).json({ error: "PNG, JPG, PDF만 지원합니다." });
    if (!fs.existsSync(audiveris))
      return res
        .status(503)
        .json({
          error:
            "Audiveris가 설치되지 않았습니다. ABC 직접 입력은 사용할 수 있습니다.",
        });
    if (busy)
      return res
        .status(429)
        .json({ error: "다른 악보를 처리 중입니다. 잠시 후 다시 시도하세요." });
    busy = true;
    job = fs.mkdtempSync(path.join(data, "omr-"));
    const input = path.join(job, "scan" + ext);
    fs.renameSync(file, input);
    file = null;
    await run(
      audiveris,
      ["-batch", "-transcribe", "-export", "-output", job, "--", input],
      {
        XDG_CONFIG_HOME: path.join(data, "config"),
        XDG_CACHE_HOME: path.join(data, "cache"),
      },
    );
    const outputs = findXml(job);
    if (outputs.length > 1)
      throw new Error(
        "여러 악곡이 발견되었습니다. 한 악곡씩 나누어 업로드하세요.",
      );
    const xml = outputs[0];
    if (!xml)
      throw new Error(
        "음표를 인식하지 못했습니다. 선명한 인쇄 악보로 다시 시도하세요.",
      );
    const abc = await run("python3", [
      path.join(root, "tools/musicxml_to_abc.py"),
      xml,
    ]);
    const id = randomUUID(),
      original = id + ext,
      title =
        req.file.originalname.replace(/\.[^.]+$/, "").slice(0, 200) ||
        "새 악보";
    fs.copyFileSync(input, path.join(data, "uploads", original));
    const now = new Date().toISOString();
    db.prepare("INSERT INTO scores VALUES(?,?,?,?,?,?,?)").run(
      id,
      title,
      abc,
      100,
      original,
      now,
      now,
    );
    res
      .status(201)
      .json({
        id,
        warning:
          "자동 인식 결과입니다. 음표·박자·반복 기호를 원본과 비교한 뒤 수정하세요.",
      });
  } catch (e) {
    res.status(422).json({ error: e.message });
  } finally {
    if (file) fs.rmSync(file, { force: true });
    if (job) {
      fs.rmSync(job, { recursive: true, force: true });
      busy = false;
    }
  }
});
app.use((err, req, res, next) =>
  res
    .status(400)
    .json({
      error:
        err.code === "LIMIT_FILE_SIZE"
          ? "파일은 20MB 이하로 선택하세요."
          : "요청을 처리하지 못했습니다.",
    }),
);
const server = app.listen(
  Number(process.env.PORT) || 3000,
  process.env.HOST || "127.0.0.1",
  (err) => {
    if (err) {
      console.error("Server startup failed:", err.code);
      process.exit(1);
    }
    console.log("Measure server started");
  },
);
process.on("SIGTERM", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
