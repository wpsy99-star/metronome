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
const storageKey = "measure.scores.v1";
function readScores() {
  const rows = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (
    !Array.isArray(rows) ||
    rows.some(
      (r) =>
        !r ||
        typeof r.id !== "string" ||
        typeof r.title !== "string" ||
        typeof r.abc !== "string" ||
        !Number.isInteger(r.bpm) ||
        r.bpm < 30 ||
        r.bpm > 240 ||
        typeof r.created_at !== "string",
    )
  )
    throw new Error(
      "저장된 악보 데이터가 올바르지 않습니다. 브라우저 데이터를 백업한 뒤 확인하세요.",
    );
  return rows;
}
const storageConfig = window.MEASURE_CONFIG || {};
const cloudStorage = !!storageConfig.supabaseUrl && !!storageConfig.supabaseKey;
$("#storage-mode").textContent = cloudStorage
  ? "Supabase 공유 저장"
  : "브라우저 저장";
if (cloudStorage)
  $("#storage-info").textContent =
    "이 사이트의 악보는 Supabase에 저장되어 접속자들이 공유합니다.";
async function cloudStore(url, options = {}) {
  const id = url.split("/")[3],
    method = options.method || "GET";
  const headers = {
    apikey: storageConfig.supabaseKey,
    "Content-Type": "application/json",
  };
  if (storageConfig.supabaseKey.startsWith("eyJ"))
    headers.Authorization = "Bearer " + storageConfig.supabaseKey;
  const base = storageConfig.supabaseUrl + "/rest/v1/measure_scores";
  let target = base + (id ? "?id=eq." + encodeURIComponent(id) : "");
  const init = { method: method === "PUT" ? "PATCH" : method, headers };
  if (method !== "GET") headers.Prefer = "return=representation";
  if (options.body) init.body = options.body;
  async function request(endpoint, requestOptions) {
    let response;
    try {
      response = await fetch(endpoint, {
        ...requestOptions,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error(
        "Supabase에 연결하지 못했습니다. 연결을 확인하세요. 편집 내용은 유지됩니다.",
      );
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      if (response.status === 401 || response.status === 403)
        throw new Error("Supabase 키와 테이블 접근 정책(RLS)을 확인하세요.");
      if (detail.code === "PGRST205" || detail.code === "42P01")
        throw new Error(
          "Supabase 테이블이 없습니다. supabase/schema.sql을 실행하세요.",
        );
      throw new Error(
        "Supabase 저장 요청이 실패했습니다. (" + response.status + ")",
      );
    }
    return response.status === 204 ? [] : response.json();
  }
  if (method === "GET" && !id) {
    const all = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await request(
        base +
          "?select=*&order=created_at.desc,id.desc&limit=1000&offset=" +
          offset,
        init,
      );
      all.push(...page);
      if (page.length < 1000) return all;
    }
  }
  const rows = await request(target, init);
  if (method === "POST") {
    if (!rows[0]) throw new Error("Supabase 저장 결과를 확인하지 못했습니다.");
    return { id: rows[0].id };
  }
  if (!rows.length)
    throw new Error(
      "악보가 없거나 접근 권한이 없습니다. 목록을 새로고침하세요.",
    );
  return method === "GET" ? rows[0] : { ok: true };
}
async function scoreStore(url, options = {}) {
  if (cloudStorage) return cloudStore(url, options);
  let rows;
  try {
    rows = readScores();
  } catch (e) {
    throw new Error("브라우저 저장소를 읽지 못했습니다: " + e.message);
  }
  const id = url.split("/")[3],
    method = options.method || "GET";
  if (method === "GET") {
    if (!id)
      return [...rows].sort(
        (a, b) =>
          b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
      );
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error("악보를 찾을 수 없습니다.");
    return row;
  }
  if (method === "DELETE") rows = rows.filter((r) => r.id !== id);
  else {
    const value = JSON.parse(options.body);
    if (
      !value.title ||
      value.title.length > 200 ||
      value.abc.length > 500000 ||
      !/^K:/m.test(value.abc) ||
      !Number.isInteger(value.bpm) ||
      value.bpm < 30 ||
      value.bpm > 240
    )
      throw new Error("제목, ABC 코드와 BPM을 확인하세요.");
    const now = new Date().toISOString();
    if (method === "POST") {
      const row = {
        ...value,
        id: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
      };
      rows.push(row);
      try {
        localStorage.setItem(storageKey, JSON.stringify(rows));
      } catch {
        throw new Error(
          "저장 공간이 부족하거나 브라우저 저장이 차단되어 있습니다. ABC 파일로 내보내세요.",
        );
      }
      return { id: row.id };
    }
    const index = rows.findIndex((r) => r.id === id);
    if (index < 0) throw new Error("악보를 찾을 수 없습니다.");
    rows[index] = { ...rows[index], ...value, updated_at: now };
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(rows));
  } catch {
    throw new Error("브라우저에 저장하지 못했습니다. ABC 파일로 내보내세요.");
  }
  return { ok: true };
}
function abcTitle(abc) {
  const header = abc.split(/^K:/m)[0];
  return (header.match(/^T:[ \t]*([^\r\n]*)/m)?.[1].trim() || "").slice(0, 200);
}
function syncTitleFromAbc() {
  const title = abcTitle($("#abc").value);
  if (title) $("#title").value = title;
  $("#player-title").textContent = $("#title").value;
  $("#breadcrumb").textContent = "내 악보 / " + $("#title").value;
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
        playFrom(abcelem.startChar).catch(reportAudioError);
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
const instrumentChoices = {
  piano: {
    program: 0,
    transpose: 0,
    name: "피아노",
    description: "악보 그대로 재생",
  },
  clarinet: {
    program: 71,
    transpose: -2,
    name: "B♭ 클라리넷",
    description: "악보보다 한 음 낮게 · 도 → 시♭",
  },
};
let selectedInstrument = "piano";
try {
  if (localStorage.getItem("measure.instrument.v1") === "clarinet")
    selectedInstrument = "clarinet";
} catch {}
function updateInstrumentControls() {
  for (const name of Object.keys(instrumentChoices))
    $("#instrument-" + name).checked = selectedInstrument === name;
  $("#instrument-description").textContent =
    instrumentChoices[selectedInstrument].description;
  $("#player-instrument").textContent =
    "· " + instrumentChoices[selectedInstrument].name + " 재생";
}
for (const name of Object.keys(instrumentChoices))
  $("#instrument-" + name).onchange = () => {
    if (name === selectedInstrument) {
      updateInstrumentControls();
      return;
    }
    const resume = playing;
    invalidate();
    selectedInstrument = name;
    updateInstrumentControls();
    try {
      localStorage.setItem("measure.instrument.v1", name);
    } catch {}
    if (resume) playFrom().catch(reportAudioError);
  };
updateInstrumentControls();
function reportAudioError(error) {
  const message = error?.message || "오디오 재생에 실패했습니다.";
  $("#audio-status").textContent = message;
  toast(message);
}
async function activateAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw new Error("이 브라우저는 오디오를 지원하지 않습니다.");
  if (!audio || audio.state === "closed") {
    synth = null;
    audio = new Context();
  }
  await audio.resume();
  if (audio.state !== "running")
    throw new Error(
      "브라우저가 소리를 차단했습니다. 사이트의 소리 권한을 확인하고 다시 눌러주세요.",
    );
  return audio;
}
$("#sound-test").onclick = async () => {
  try {
    const context = await activateAudio();
    const tone = context.createOscillator(),
      gain = context.createGain();
    tone.frequency.value = 440;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(0.15, context.currentTime + 0.02);
    gain.gain.setValueAtTime(0.15, context.currentTime + 0.6);
    gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.8);
    tone.connect(gain).connect(context.destination);
    tone.start();
    tone.stop(context.currentTime + 0.8);
    tone.onended = () => {
      tone.disconnect();
      gain.disconnect();
    };
    $("#audio-status").textContent =
      "테스트음을 재생했습니다. 안 들리면 탭 음소거와 기기 소리 출력을 확인하세요.";
  } catch (error) {
    reportAudioError(error);
  }
};
async function prepare() {
  await activateAudio();
  if (synth) return;
  if (!renderValid) throw new Error("먼저 유효한 ABC 악보를 입력하세요.");
  if (!ABCJS.synth.supportsAudio())
    throw new Error("이 브라우저는 오디오 재생을 지원하지 않습니다.");
  ABCJS.synth.registerAudioContext(audio);
  const token = generation;
  const buffer = new ABCJS.synth.CreateSynth();
  const instrument = instrumentChoices[selectedInstrument];
  const sequence = visual.setUpAudio({});
  sequence.tracks.forEach((track) =>
    track.forEach((event) => {
      if (event.pitch !== undefined) event.pitch += instrument.transpose;
      if (event.cmd === "program" || event.instrument !== undefined)
        event.instrument = instrument.program;
    }),
  );
  if (
    sequence.tracks.some((track) =>
      track.some(
        (e) => e.pitch !== undefined && (e.pitch < 21 || e.pitch > 108),
      ),
    )
  )
    throw new Error(
      "선택한 악기의 실제 재생 음높이가 A0–C8 범위를 벗어났습니다. ABC 음높이를 확인하세요.",
    );
  const meter = visual.getMeterFraction();
  let sampleError = false;
  const loaded = await buffer.init({
    audioContext: audio,
    debugCallback: (message) => {
      if (String(message).includes("loadBatch catch")) sampleError = true;
    },
    sequence,
    millisecondsPerMeasure: 240000 / Number($("#bpm").value),
    options: { soundFontUrl: "/soundfonts/", soundFontVolumeMultiplier: 2.1 },
  });
  if (sampleError || loaded.error?.length)
    throw new Error(
      "악기 음원을 불러오지 못했습니다. 페이지를 새로고침하고 다시 시도하세요.",
    );
  await buffer.prime();
  if (
    sequence.tracks.some((track) => track.some((e) => e.cmd === "note")) &&
    !buffer.audioBuffers.some((b) => {
      for (let channel = 0; channel < b.numberOfChannels; channel++)
        if (
          b.getChannelData(channel).some((value) => Math.abs(value) > 0.000001)
        )
          return true;
      return false;
    })
  )
    throw new Error(
      "악보의 오디오 데이터가 무음입니다. ABC 볼륨 설정과 음원 로딩을 확인하세요.",
    );
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
    gain.gain.setValueAtTime(0.078, startClock + t);
    gain.gain.exponentialRampToValueAtTime(0.0013, startClock + t + 0.04);
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
    await activateAudio();
    synth.start();
    $("#audio-status").textContent =
      instrumentChoices[selectedInstrument].name + " 오디오 재생 중";
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
  ["score", "abc"].forEach((k) =>
    $("#" + k).classList.toggle("hidden", id !== k),
  );
}
function showDetail() {
  $("#library-view").classList.add("hidden");
  $("#detail-view").classList.remove("hidden");
  $(".player").classList.remove("hidden");
}
async function openScore(id, force = false) {
  if (!force && !checkLeave()) return;
  try {
    const row = await scoreStore("/api/scores/" + id);
    invalidate();
    current = row;
    $("#title").value = abcTitle(row.abc) || row.title;
    $("#abc").value = row.abc;
    $("#bpm").value = $("#range").value = row.bpm;
    $("#player-bpm").textContent = row.bpm + " BPM";
    baseline = JSON.stringify({ ...payload(), title: row.title });
    showDetail();
    render();
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
  scores = (await scoreStore("/api/scores")).map((row) => ({
    ...row,
    title: abcTitle(row.abc) || row.title,
  }));
  renderRecent();
  renderList();
}
async function remove(id, title) {
  if (!confirm("“" + title + "” 악보를 삭제할까요?")) return;
  try {
    await scoreStore("/api/scores/" + id, { method: "DELETE" });
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
    const result = await scoreStore(
      isNew ? "/api/scores" : "/api/scores/" + current.id,
      {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      },
    );
    if (isNew) current = await scoreStore("/api/scores/" + result.id);
    baseline = JSON.stringify(payload());
    updateDirty();
    await refresh();
    toast(
      cloudStorage
        ? "Supabase에 악보를 저장했습니다."
        : "이 브라우저에 악보를 저장했습니다.",
    );
  } catch (e) {
    toast(e.message);
    updateDirty();
  }
};
$("#delete").onclick = () => current && remove(current.id, current.title);
$("#abc").oninput = () => {
  syncTitleFromAbc();
  invalidate();
  renderValid = false;
  $("#save").disabled = true;
  $("#save-status").textContent = "ABC 코드 확인 중…";
  clearTimeout(editTimer);
  editTimer = setTimeout(render, 350);
};
$("#title").oninput = () => {
  const value = $("#title").value.replace(/[\r\n]/g, "");
  const abc = $("#abc").value;
  const keyIndex = abc.search(/^K:/m);
  const header = keyIndex < 0 ? abc : abc.slice(0, keyIndex);
  $("#abc").value = /^T:/m.test(header)
    ? abc.replace(/^T:[^\r\n]*/m, () => "T:" + value)
    : "T:" + value + "\n" + abc;
  render();
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
  else playFrom().catch(reportAudioError);
};
$("#reset").onclick = () => stop(true);
$("#highlight").onchange = () => {
  if (!$("#highlight").checked) clearHighlight();
};
$("#metronome").onchange = () => {
  if (playing) playFrom().catch(reportAudioError);
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
  if (!file) return toast("ABC 파일을 선택하세요.");
  if (!/\.abc$/i.test(file.name) || file.size > 500000)
    return toast("500KB 이하의 .abc 파일을 선택하세요.");
  try {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    if (!/^K:/m.test(text))
      throw new Error("ABC 코드에 K: 조성 항목이 필요합니다.");
    if ((text.match(/^X:/gm) || []).length > 1)
      throw new Error("한 파일에 한 곡만 넣어주세요.");
    invalidate();
    current = null;
    $("#abc").value = text;
    $("#title").value = (
      abcTitle(text) || file.name.replace(/\.abc$/i, "")
    ).slice(0, 200);
    const bpm = Number(text.match(/^Q:\s*(?:1\/4\s*=\s*)?(\d+)/m)?.[1]) || 100;
    $("#bpm").value = $("#range").value = Math.max(30, Math.min(240, bpm));
    $("#player-bpm").textContent = $("#bpm").value + " BPM";
    baseline = "";
    showDetail();
    render();
    tab("score");
    $("dialog").close();
    toast(
      "ABC 파일을 가져왔습니다. 변경사항 저장을 누르면 선택한 저장소에 보관됩니다.",
    );
  } catch (e) {
    $("#import-status").textContent = e.message;
  }
};
$("#export").onclick = () => {
  const blob = new Blob([$("#abc").value], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download =
    ($("#title").value.trim() || "score").replace(/[\/\\:*?"<>|]/g, "_") +
    ".abc";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
window.addEventListener("storage", (e) => {
  if (!cloudStorage && e.key === storageKey)
    refresh().catch((e) => toast(e.message));
});
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
      syncTitleFromAbc();
      baseline = "";
      render();
    }
  } catch (e) {
    toast(e.message);
  }
})();
