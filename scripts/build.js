const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "dist");
if (fs.existsSync(path.join(root, ".env.local")))
  process.loadEnvFile(path.join(root, ".env.local"));
const url = process.env.SUPABASE_URL || "";
const key = process.env.SUPABASE_PUBLISHABLE_KEY || "";
if (!!url !== !!key)
  throw new Error("SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 함께 설정하세요.");
if (url) {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("Supabase HTTPS 프로젝트 URL을 입력하세요.");
  let role;
  try {
    role = JSON.parse(
      Buffer.from(key.split(".")[1] || "", "base64url").toString(),
    ).role;
  } catch {}
  if (key.startsWith("sb_secret_") || role === "service_role")
    throw new Error(
      "공개 웹 앱에는 service_role/secret 키를 사용할 수 없습니다.",
    );
  if (!key.startsWith("sb_publishable_") && role !== "anon")
    throw new Error("publishable key 또는 legacy anon key를 사용하세요.");
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true });
fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
for (const name of ["abcjs-basic-min.js", "abcjs-basic-min.js.LICENSE"])
  fs.copyFileSync(
    path.join(root, "node_modules/abcjs/dist", name),
    path.join(out, "vendor", name),
  );
console.log("Static build ready: dist");

fs.writeFileSync(
  path.join(out, "config.js"),
  "window.MEASURE_CONFIG = " +
    JSON.stringify({ supabaseUrl: url.replace(/\/$/, ""), supabaseKey: key }) +
    ";\n",
);
