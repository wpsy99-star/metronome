"use strict";
const $ = (s) => document.querySelector(s);
let scores = [],
  current = null,
  baseline = "",
  visual = null,
  synth = null,
  audio = null,
  timings = [],
  playing = false,
  position = 0,
  startClock = 0,
  raf = 0,
  generation = 0,
  editTimer,
  loading = false,
  metronomeNodes = [],
  renderValid = false;
const example = $("#abc").value;
let toastTimer;
function toast(t) {
  $(".toast").textContent = t;
  $(".toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($(".toast").style.display = "none"), 5000);
}
async function api(url, options = {}) {
  const r = await fetch(url, options);
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || "요청에 실패했습니다.");
  return body;
}
function payload() {
  return {
    title: $("#title").value.trim(),
    abc: $("#abc").value,
    bpm: Number($("#bpm").value),
  };
}
function dirty() {
  return JSON.stringify(payload()) !== baseline;
}
function checkLeave() {
  return !dirty() || confirm("저장하지 않은 변경사항이 있습니다. 이동할까요?");
}
function updateDirty() {
  $("#save").disabled = !dirty() || !renderValid;
  $("#save-status").textContent = dirty() ? "저장하지 않은 변경사항" : "저장됨";
  $("#delete").disabled = !current;
}
function clearHighlight() {
  document
    .querySelectorAll(".playing-note")
    .forEach((n) => n.classList.remove("playing-note"));
}
function stop(reset = false) {
  if (playing && audio)
    position = Math.max(0, (audio.currentTime - startClock) * 1000);
  playing = false;
  cancelAnimationFrame(raf);
  if (synth) {
    try {
      synth.stop();
    } catch {}
  }
  metronomeNodes.forEach((n) => {
    try {
      n.stop();
    } catch {}
  });
  metronomeNodes = [];
  $("#play").textContent = "▶";
  if (reset) {
    position = 0;
    clearHighlight();
    $("#progress-bar").style.width = "0%";
  }
}
function invalidate() {
  generation++;
  stop();
  synth = null;
  loading = false;
}
function abcWithTempo() {
  const abc = $("#abc").value;
  const q = "Q:1/4=" + Number($("#bpm").value);
  return /^Q:/m.test(abc)
    ? abc.replace(/^Q:.*$/m, q)
    : abc.replace(/^K:/m, q + "\nK:");
}
function render() {
  invalidate();
  position = 0;
  renderValid = false;
  try {
    const tune = ABCJS.renderAbc("notation", abcWithTempo(), {
      responsive: "resize",
      add_classes: true,
      selectTypes: ["note"],
      clickListener: (abcelem) => {
        if (abcelem.el_type !== "note") return;
        playFrom(abcelem.startChar).catch((e) => toast(e.message));
      },
    })[0];
    visual = tune;
    const warnings = tune?.warnings || [];
    renderValid =
      !!tune && tune.lines.some((l) => l.staff) && /^K:/m.test($("#abc").value);
    $("#abc-errors").textContent = warnings.length
      ? "ABC 확인: " +
        warnings.map((w) => w.replace(/<[^>]*>/g, "")).join(" / ")
      : renderValid
        ? ""
        : "유효한 ABC 악보를 입력하세요. K: 조성이 필요합니다.";
    $("#play").disabled = !renderValid;
    $("#player-title").textContent = $("#title").value;
    $("#breadcrumb").textContent = "내 악보 / " + $("#title").value;
  } catch (e) {
    $("#abc-errors").textContent = "ABC 코드 오류: " + e.message;
    $("#play").disabled = true;
  }
  updateDirty();
}
async function prepare() {
  if (synth) return;
  if (!renderValid) throw new Error("먼저 유효한 ABC 악보를 입력하세요.");
  if (!ABCJS.synth.supportsAudio())
    throw new Error("이 브라우저는 오디오 재생을 지원하지 않습니다.");
  audio = audio || new AudioContext();
  await audio.resume();
  const token = generation;
  const buffer = new ABCJS.synth.CreateSynth();
  const sequence = visual.setUpAudio({});
  if (
    sequence.tracks.some((track) =>
      track.some(
        (e) => e.pitch !== undefined && (e.pitch < 21 || e.pitch > 108),
      ),
    )
  )
    throw new Error("피아노 재생 범위는 A0–C8입니다. ABC 음높이를 확인하세요.");
  sequence.tracks.forEach((track) =>
    track.forEach((e) => {
      if (e.cmd === "program") e.instrument = 0;
      if (e.instrument !== undefined) e.instrument = 0;
    }),
  );
  const meter = visual.getMeterFraction();
  await buffer.init({
    audioContext: audio,
    sequence,
    millisecondsPerMeasure: 240000 / Number($("#bpm").value),
    options: { soundFontUrl: "/soundfonts/", soundFontVolumeMultiplier: 1 },
  });
  await buffer.prime();
  if (token !== generation)
    throw new Error("악보가 변경되었습니다. 다시 재생하세요.");
  synth = buffer;
  timings = visual.setTiming(undefined, 0);
}
function metronome(offset, total) {
  if (!$("#metronome").checked) return;
  const beat = 60 / Number($("#bpm").value);
  for (let t = Math.ceil(offset / beat) * beat; t < total; t += beat) {
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.frequency.value = 1000;
    gain.gain.setValueAtTime(0.06, startClock + t);
    gain.gain.exponentialRampToValueAtTime(0.001, startClock + t + 0.04);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(startClock + t);
    oscillator.stop(startClock + t + 0.045);
    metronomeNodes.push(oscillator);
  }
}
function animate() {
  if (!playing) return;
  const ms = (audio.currentTime - startClock) * 1000;
  position = ms;
  const total = timings.at(-1)?.milliseconds || 0;
  if (ms >= total) {
    stop(true);
    return;
  }
  clearHighlight();
  let event;
  for (const e of timings) {
    if (e.milliseconds <= ms && e.type === "event") event = e;
    if (e.milliseconds > ms) break;
  }
  if ($("#highlight").checked && event)
    event.elements
      .flat()
      .filter(Boolean)
      .forEach((n) => n.classList.add("playing-note"));
  $("#progress-bar").style.width = Math.min(100, (ms / total) * 100) + "%";
  raf = requestAnimationFrame(animate);
}
async function playFrom(char) {
  if (loading) return;
  loading = true;
  $("#play").disabled = true;
  try {
    stop();
    await prepare();
    if (char !== undefined) {
      const ev = timings.find(
        (e) => e.startChar === char || e.startCharArray?.includes(char),
      );
      if (!ev) throw new Error("이 음표의 재생 위치를 찾을 수 없습니다.");
      position = ev.milliseconds;
    }
    const total = timings.at(-1)?.milliseconds || 0;
    if (position >= total) position = 0;
    synth.seek(position / 1000, "seconds");
    synth.start();
    startClock = audio.currentTime - position / 1000;
    metronome(position / 1000, total / 1000);
    playing = true;
    $("#play").textContent = "Ⅱ";
    animate();
  } finally {
    loading = false;
    $("#play").disabled = !renderValid;
  }
}
function tab(id) {
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === id));
  ["score", "abc", "scan"].forEach((k) =>
    $("#" + k).classList.toggle("hidden", id !== k),
  );
}
function showDetail() {
  $("#library-view").classList.add("hidden");
  $("#detail-view").classList.remove("hidden");
  $(".player").classList.remove("hidden");
}
function original() {
  const scan = $("#scan");
  scan.replaceChildren();
  if (!current?.original) {
    scan.textContent = "이 악보에는 원본 스캔이 없습니다.";
    return;
  }
  const el = document.createElement(
    current.original.endsWith(".pdf") ? "iframe" : "img",
  );
  el.src = "/api/scores/" + current.id + "/original";
  el.className = "score-original";
  if (el.tagName === "IFRAME") {
    el.title = "원본 스캔 PDF";
    el.style.height = "600px";
  } else el.alt = "원본 스캔 악보";
  scan.append(el);
}
async function openScore(id, force = false) {
  if (!force && !checkLeave()) return;
  try {
    const row = await api("/api/scores/" + id);
    invalidate();
    current = row;
    $("#title").value = row.title;
    $("#abc").value = row.abc;
    $("#bpm").value = $("#range").value = row.bpm;
    $("#player-bpm").textContent = row.bpm + " BPM";
    baseline = JSON.stringify(payload());
    showDetail();
    render();
    original();
    tab("score");
    renderRecent();
  } catch (e) {
    toast(e.message);
  }
}
function recentItem(row) {
  const b = document.createElement("button");
  b.className = "library" + (current?.id === row.id ? " active" : "");
  b.style.cssText = "display:block;width:100%;text-align:left;border:0";
  const name = document.createElement("span");
  name.textContent = row.title;
  const info = document.createElement("small");
  info.textContent =
    row.bpm + " BPM · " + new Date(row.created_at).toLocaleDateString("ko-KR");
  b.append(name, info);
  b.onclick = () => openScore(row.id);
  return b;
}
function renderRecent() {
  $("#recent-scores").replaceChildren(...scores.slice(0, 5).map(recentItem));
  if (!scores.length)
    $("#recent-scores").textContent = "아직 저장한 악보가 없습니다.";
}
function renderList() {
  const q = $("#search").value.trim().toLowerCase();
  const rows = scores.filter((s) => s.title.toLowerCase().includes(q));
  $("#list-count").textContent = "총 " + rows.length + "개 · 최근 등록순";
  $("#all-scores").replaceChildren();
  rows.forEach((row) => {
    const div = document.createElement("div");
    div.style.cssText =
      "display:flex;gap:10px;align-items:center;border-bottom:1px solid #edf0e9";
    const button = recentItem(row);
    button.style.flex = "1";
    const del = document.createElement("button");
    del.textContent = "삭제";
    del.onclick = () => remove(row.id, row.title);
    div.append(button, del);
    $("#all-scores").append(div);
  });
  if (!rows.length)
    $("#all-scores").textContent = q
      ? "검색 결과가 없습니다."
      : "악보를 가져오거나 ABC 코드를 직접 입력하세요.";
}
async function refresh() {
  scores = await api("/api/scores");
  renderRecent();
  renderList();
}
async function remove(id, title) {
  if (!confirm("“" + title + "” 악보를 삭제할까요?")) return;
  try {
    await api("/api/scores/" + id, { method: "DELETE" });
    if (current?.id === id) {
      newScore();
      baseline = JSON.stringify(payload());
      showLibrary(false);
    }
    await refresh();
    toast("악보를 삭제했습니다.");
  } catch (e) {
    toast(e.message);
  }
}
function newScore() {
  invalidate();
  current = null;
  $("#title").value = "새 악보";
  $("#abc").value =
    "X:1\nT:새 악보\nM:4/4\nL:1/4\nQ:1/4=100\nK:C\nC D E F | G A B c |]\n";
  $("#bpm").value = $("#range").value = 100;
  $("#player-bpm").textContent = "100 BPM";
  baseline = "";
  showDetail();
  render();
  original();
  tab("abc");
  $("#abc").focus();
}
function showLibrary(check = true) {
  if (check && !checkLeave()) return;
  invalidate();
  $("#detail-view").classList.add("hidden");
  $("#library-view").classList.remove("hidden");
  $(".player").classList.add("hidden");
  renderList();
}
$("#save").onclick = async () => {
  const button = $("#save");
  button.disabled = true;
  try {
    if (!renderValid) throw new Error("ABC 코드를 먼저 확인하세요.");
    const isNew = !current;
    const result = await api(
      isNew ? "/api/scores" : "/api/scores/" + current.id,
      {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      },
    );
    if (isNew) current = await api("/api/scores/" + result.id);
    baseline = JSON.stringify(payload());
    updateDirty();
    await refresh();
    toast("악보를 저장했습니다.");
  } catch (e) {
    toast(e.message);
    updateDirty();
  }
};
$("#delete").onclick = () => current && remove(current.id, current.title);
$("#abc").oninput = () => {
  invalidate();
  renderValid = false;
  $("#save").disabled = true;
  $("#save-status").textContent = "ABC 코드 확인 중…";
  clearTimeout(editTimer);
  editTimer = setTimeout(render, 350);
};
$("#title").oninput = () => {
  updateDirty();
  $("#player-title").textContent = $("#title").value;
};
function tempo(value) {
  const n = Math.min(240, Math.max(30, Number(value) || 100));
  $("#bpm").value = $("#range").value = n;
  $("#player-bpm").textContent = n + " BPM";
  render();
}
$("#bpm").onchange = (e) => tempo(e.target.value);
$("#range").oninput = (e) => tempo(e.target.value);
$("#play").onclick = () => {
  if (playing) stop();
  else playFrom().catch((e) => toast(e.message));
};
$("#reset").onclick = () => stop(true);
$("#highlight").onchange = () => {
  if (!$("#highlight").checked) clearHighlight();
};
$("#metronome").onchange = () => {
  if (playing) playFrom().catch((e) => toast(e.message));
};
document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      if (b.dataset.tab === "score" && editTimer) {
        clearTimeout(editTimer);
        render();
      }
      tab(b.dataset.tab);
    }),
);
$("#library-open").onclick = () => showLibrary();
$("#search").oninput = renderList;
$("#new-abc").onclick = () => {
  if (checkLeave()) newScore();
};
$("#upload").onclick = $("#library-upload").onclick = () => {
  if (checkLeave()) $("dialog").showModal();
};
$("#convert").onclick = async () => {
  const file = $("input[type=file]").files[0];
  if (!file) {
    toast("파일을 선택하세요.");
    return;
  }
  const button = $("#convert");
  button.disabled = true;
  $("#import-status").textContent =
    "악보를 인식하고 있습니다. 최대 4분 정도 걸릴 수 있습니다.";
  const form = new FormData();
  form.append("file", file);
  try {
    const r = await api("/api/import", { method: "POST", body: form });
    await refresh();
    await openScore(r.id, true);
    $("dialog").close();
    toast(r.warning);
  } catch (e) {
    $("#import-status").textContent = e.message;
  } finally {
    button.disabled = false;
  }
};
window.addEventListener("beforeunload", (e) => {
  if (dirty()) e.preventDefault();
});
(async () => {
  try {
    await refresh();
    if (scores.length) await openScore(scores[0].id, true);
    else {
      current = null;
      $("#title").value = "작은 별";
      $("#abc").value = example;
      baseline = "";
      render();
      original();
    }
    const status = await api("/api/status");
    if (!status.omr)
      $("#import-status").textContent = "스캔 인식 엔진이 설치되지 않았습니다.";
  } catch (e) {
    toast(e.message);
  }
})();
