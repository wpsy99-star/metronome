const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function convert(notes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "measure-xml-"));
  const file = path.join(dir, "score.xml");
  fs.writeFileSync(
    file,
    `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${notes}</measure></part></score-partwise>`,
  );
  const r = spawnSync("python3", ["tools/musicxml_to_abc.py", file], {
    encoding: "utf8",
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}
test("MusicXML chords, polyphony and rhythmic padding", () => {
  const r = convert(
    "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note><note><rest/><duration>4</duration><voice>1</voice></note><backup><duration>8</duration></backup><note><pitch><step>G</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice></note>",
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\[=C=E\] z \|/);
  assert.match(r.stdout, /=G,2 \|/);
  assert.match(r.stdout, /V:2/);
});
test("Unsupported grace notes fail rather than lose notes", () => {
  const r = convert(
    "<note><grace/><pitch><step>C</step><octave>4</octave></pitch></note>",
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /장식음/);
});
