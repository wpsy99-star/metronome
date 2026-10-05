const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, ".."),
  out = path.join(root, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), out, { recursive: true });
fs.mkdirSync(path.join(out, "vendor"), { recursive: true });
for (const name of ["abcjs-basic-min.js", "abcjs-basic-min.js.LICENSE"])
  fs.copyFileSync(
    path.join(root, "node_modules/abcjs/dist", name),
    path.join(out, "vendor", name),
  );
console.log("Static build ready: dist");
