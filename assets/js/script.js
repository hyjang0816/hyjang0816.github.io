const STORAGE_KEY = "badminton-ops-site-html-v2";
const LEGACY_STORAGE_KEY = "badminton-ops-site-html-v1";
const MAX_HISTORY = 10;

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createCourt() {
  return { id: uid(), playerIds: ["", "", "", ""] };
}

function createInitialState() {
  return { courts: [createCourt()], participants: [], lastPlayedIds: [] };
}

let data = loadData();
let activeSlot = null;
let selectedParticipantId = null;
let history = [];
let saveTimer = null;
let searchKeyword = "";

function migrateLegacy(legacy) {
  if (!legacy || !Array.isArray(legacy.participants)) return createInitialState();
  const participants = legacy.participants.map(name => ({
    id: uid(),
    name: String(name || "").trim(),
    count: Number(legacy.participationCounts?.[name] || 0),
    createdAt: Date.now() + Math.random(),
  })).filter(p => p.name);
  const used = new Set();
  const courts = (legacy.courts || []).map(court => ({
    id: court.id || uid(),
    playerIds: (court.players || ["", "", "", ""]).map(name => {
      if (!name) return "";
      const participant = participants.find(p => p.name === name && !used.has(p.id));
      if (!participant) return "";
      used.add(participant.id);
      return participant.id;
    }),
  }));
  return { courts: courts.length ? courts : [createCourt()], participants, lastPlayedIds: [] };
}

function normalizeState(saved) {
  if (!saved || !Array.isArray(saved.participants)) return createInitialState();
  if (saved.participants.length && typeof saved.participants[0] === "string") return migrateLegacy(saved);
  return {
    courts: Array.isArray(saved.courts) && saved.courts.length ? saved.courts.map(c => ({
      id: c.id || uid(),
      playerIds: Array.isArray(c.playerIds) ? [...c.playerIds].slice(0, 4).concat(["", "", "", ""]).slice(0, 4) : ["", "", "", ""],
    })) : [createCourt()],
    participants: saved.participants.map(p => ({
      id: p.id || uid(),
      name: String(p.name || "").trim(),
      count: Math.max(0, Number(p.count || 0)),
      createdAt: p.createdAt || Date.now(),
    })),
    lastPlayedIds: Array.isArray(saved.lastPlayedIds) ? saved.lastPlayedIds : [],
  };
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeState(JSON.parse(saved));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const migrated = migrateLegacy(JSON.parse(legacy));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch (e) {
    console.warn("저장 데이터 로드 실패", e);
  }
  return createInitialState();
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

function persist(next, { recordHistory = true, message = "저장됨" } = {}) {
  if (recordHistory) {
    history.push(cloneState(data));
    if (history.length > MAX_HISTORY) history.shift();
  }
  data = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  flashSaved(message);
  render();
}

function undo() {
  if (!history.length) return;
  data = history.pop();
  activeSlot = null;
  selectedParticipantId = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  flashSaved("이전 상태로 복원됨");
  render();
}

function flashSaved(message) {
  const el = document.getElementById("saveMessage");
  el.textContent = message;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { el.textContent = ""; }, 1400);
}

function getParticipant(id) {
  return data.participants.find(p => p.id === id);
}

function getPlacedIds() {
  return data.courts.flatMap(c => c.playerIds).filter(Boolean);
}

function getSortedParticipants() {
  const placed = new Set(getPlacedIds());
  const lastPlayed = new Set(data.lastPlayedIds || []);
  return data.participants
    .filter(p => p.name.toLowerCase().includes(searchKeyword.toLowerCase()))
    .map(p => ({ ...p, isPlaced: placed.has(p.id), playedLast: lastPlayed.has(p.id) }))
    .sort((a, b) => {
      if (a.isPlaced !== b.isPlaced) return Number(a.isPlaced) - Number(b.isPlaced);
      if (a.playedLast !== b.playedLast) return Number(a.playedLast) - Number(b.playedLast);
      if (a.count !== b.count) return a.count - b.count;
      return a.createdAt - b.createdAt;
    });
}

function getSummary() {
  const assigned = getPlacedIds().length;
  return {
    courts: data.courts.length,
    participants: data.participants.length,
    assigned,
    unassigned: Math.max(data.participants.length - assigned, 0),
    emptySlots: data.courts.reduce((sum, c) => sum + c.playerIds.filter(id => !id).length, 0),
  };
}

function addParticipants() {
  const input = document.getElementById("playerInput");
  const names = input.value.split(/\n|,/).map(v => v.trim()).filter(Boolean);
  if (!names.length) return;
  const now = Date.now();
  persist({
    ...data,
    participants: [
      ...data.participants,
      ...names.map((name, i) => ({ id: uid(), name, count: 0, createdAt: now + i })),
    ],
  }, { message: `${names.length}명 추가됨` });
  input.value = "";
}

function addCourt() {
  persist({ ...data, courts: [...data.courts, createCourt()] }, { message: "코트 추가됨" });
}

function recommendPlacement() {
  const placed = new Set(getPlacedIds());
  const lastPlayed = new Set(data.lastPlayedIds || []);
  const candidates = data.participants
    .filter(p => !placed.has(p.id))
    .sort((a, b) => {
      const aLast = lastPlayed.has(a.id) ? 1 : 0;
      const bLast = lastPlayed.has(b.id) ? 1 : 0;
      if (aLast !== bLast) return aLast - bLast;
      if (a.count !== b.count) return a.count - b.count;
      return Math.random() - 0.5;
    });
  if (!candidates.length) return flashSaved("배치할 참석자가 없습니다");
  let index = 0;
  const courts = data.courts.map(court => ({
    ...court,
    playerIds: court.playerIds.map(id => id || (candidates[index] ? candidates[index++].id : "")),
  }));
  activeSlot = null;
  selectedParticipantId = null;
  persist({ ...data, courts }, { message: "공정 자동 배치 완료" });
}

function removeCourt(courtId) {
  if (data.courts.length === 1) return flashSaved("코트는 최소 1개 필요합니다");
  if (!window.confirm("이 코트를 삭제할까요? 배치된 인원은 미배치 상태가 됩니다.")) return;
  persist({ ...data, courts: data.courts.filter(c => c.id !== courtId) }, { message: "코트 삭제됨" });
}

function selectSlot(courtId, slotIndex) {
  activeSlot = { courtId, slotIndex };
  render();
}

function assignParticipant(participantId) {
  if (!activeSlot) return flashSaved("먼저 코트 자리를 선택하세요");
  const cleared = data.courts.map(c => ({
    ...c,
    playerIds: c.playerIds.map(id => id === participantId ? "" : id),
  }));
  const courts = cleared.map(c => {
    if (c.id !== activeSlot.courtId) return c;
    const ids = [...c.playerIds];
    ids[activeSlot.slotIndex] = participantId;
    return { ...c, playerIds: ids };
  });
  selectedParticipantId = participantId;
  persist({ ...data, courts }, { message: "참석자 배치됨" });
}

function removePlayerFromCourt(courtId, slotIndex) {
  persist({
    ...data,
    courts: data.courts.map(c => {
      if (c.id !== courtId) return c;
      const ids = [...c.playerIds];
      ids[slotIndex] = "";
      return { ...c, playerIds: ids };
    }),
  }, { message: "배치 해제됨" });
}

function removeParticipant(id) {
  const participant = getParticipant(id);
  if (!participant || !window.confirm(`${participant.name} 참석자를 삭제할까요?`)) return;
  persist({
    ...data,
    participants: data.participants.filter(p => p.id !== id),
    courts: data.courts.map(c => ({ ...c, playerIds: c.playerIds.map(x => x === id ? "" : x) })),
    lastPlayedIds: data.lastPlayedIds.filter(x => x !== id),
  }, { message: "참석자 삭제됨" });
}

function changeCount(id, delta) {
  persist({
    ...data,
    participants: data.participants.map(p => p.id === id ? { ...p, count: Math.max(0, p.count + delta) } : p),
  }, { message: "참여 횟수 변경됨" });
}

function completeGame(ids, courtId = null) {
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return flashSaved("게임 인원이 없습니다");
  const participants = data.participants.map(p => uniqueIds.includes(p.id) ? { ...p, count: p.count + 1 } : p);
  const courts = data.courts.map(c => (!courtId || c.id === courtId) ? { ...c, playerIds: ["", "", "", ""] } : c);
  activeSlot = null;
  selectedParticipantId = null;
  persist({ ...data, participants, courts, lastPlayedIds: uniqueIds }, { message: `${uniqueIds.length}명 참여 횟수 반영됨` });
}

function completeCurrentGame() {
  if (!window.confirm("현재 전체 코트를 게임 종료 처리할까요?")) return;
  completeGame(getPlacedIds());
}

function completeCourtGame(courtId) {
  const court = data.courts.find(c => c.id === courtId);
  if (!court || !window.confirm("이 코트를 게임 종료 처리할까요?")) return;
  completeGame(court.playerIds, courtId);
}

function clearCourts() {
  if (!window.confirm("코트 배치를 모두 비울까요?")) return;
  persist({
    ...data,
    courts: data.courts.map(c => ({ ...c, playerIds: ["", "", "", ""] })),
  }, { message: "코트 비워짐" });
}

function resetAll() {
  if (!window.confirm("참석자, 코트, 참여 횟수를 전부 초기화할까요? 실행 취소로 복구할 수 있습니다.")) return;
  persist(createInitialState(), { message: "전체 초기화됨" });
  document.getElementById("playerInput").value = "";
}

function renderStats() {
  const s = getSummary();
  document.getElementById("stats").innerHTML = [
    ["코트", s.courts],
    ["참석자", s.participants],
    ["배치", s.assigned],
    ["미배치", s.unassigned],
    ["빈 자리", s.emptySlots],
  ].map(([label, value]) => `<div class="card stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join("");
}

function renderCourts() {
  const list = document.getElementById("courtList");
  list.innerHTML = data.courts.map((court, index) => {
    const filled = court.playerIds.filter(Boolean).length;
    const slots = court.playerIds.map((id, slotIndex) => {
      const participant = getParticipant(id);
      const active = activeSlot && activeSlot.courtId === court.id && activeSlot.slotIndex === slotIndex;
      return `<button class="slot ${active ? "active" : ""} ${participant ? "" : "empty"}" data-court-id="${court.id}" data-slot-index="${slotIndex}">
        <span class="${participant ? "slot-player" : ""}">${participant ? escapeHtml(participant.name) : "빈 자리"}</span>
        ${participant ? `<span class="slot-remove" data-remove-court-id="${court.id}" data-remove-slot-index="${slotIndex}">✕</span>` : `<span class="slot-hint">선택</span>`}
      </button>`;
    }).join("");
    return `<div class="card court-card">
      <div class="court-card-header">
        <div><div class="section-title small">코트 ${index + 1}</div><div class="court-subtitle">복식 · 최대 4명</div></div>
        <div class="court-actions"><div class="badge">${filled}/4</div><button class="btn success" data-complete-court-id="${court.id}">게임 종료</button><button class="btn" data-delete-court-id="${court.id}">삭제</button></div>
      </div>
      <div class="court-card-body"><div class="court-grid">${slots}</div></div>
    </div>`;
  }).join("");

  list.querySelectorAll("[data-court-id][data-slot-index]").forEach(btn => {
    btn.addEventListener("click", e => {
      if (!e.target.closest("[data-remove-court-id]")) selectSlot(btn.dataset.courtId, Number(btn.dataset.slotIndex));
    });
  });
  list.querySelectorAll("[data-remove-court-id]").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      removePlayerFromCourt(btn.dataset.removeCourtId, Number(btn.dataset.removeSlotIndex));
    });
  });
  list.querySelectorAll("[data-delete-court-id]").forEach(btn => btn.addEventListener("click", () => removeCourt(btn.dataset.deleteCourtId)));
  list.querySelectorAll("[data-complete-court-id]").forEach(btn => btn.addEventListener("click", () => completeCourtGame(btn.dataset.completeCourtId)));
}

function renderParticipants() {
  const list = document.getElementById("participantList");
  const participants = getSortedParticipants();
  if (!participants.length) {
    list.innerHTML = `<div class="empty-text">${searchKeyword ? "검색 결과가 없습니다." : "참석자를 먼저 입력해 주세요."}</div>`;
    return;
  }
  list.innerHTML = participants.map(p => `<div class="participant-item">
    <button class="participant-main ${selectedParticipantId === p.id ? "selected" : ""} ${p.isPlaced ? "placed" : ""}" data-participant-id="${p.id}">
      <div class="participant-meta"><div class="participant-count">참여 ${p.count}회${p.playedLast ? " · 직전 경기" : ""}</div><div class="participant-name">${escapeHtml(p.name)}</div></div>
      ${p.isPlaced ? '<span class="placed-badge">배치됨</span>' : ''}
    </button>
    <button class="btn icon" data-count-id="${p.id}" data-delta="-1">−</button>
    <button class="btn icon" data-count-id="${p.id}" data-delta="1">＋</button>
    <button class="btn icon" data-remove-id="${p.id}">✕</button>
  </div>`).join("");

  list.querySelectorAll("[data-participant-id]").forEach(btn => btn.addEventListener("click", () => assignParticipant(btn.dataset.participantId)));
  list.querySelectorAll("[data-count-id]").forEach(btn => btn.addEventListener("click", () => changeCount(btn.dataset.countId, Number(btn.dataset.delta))));
  list.querySelectorAll("[data-remove-id]").forEach(btn => btn.addEventListener("click", () => removeParticipant(btn.dataset.removeId)));
}

function renderActiveSlotBadge() {
  const badge = document.getElementById("activeSlotBadge");
  if (!activeSlot) {
    badge.textContent = "자리를 먼저 선택하세요";
    return;
  }
  const index = data.courts.findIndex(c => c.id === activeSlot.courtId);
  badge.textContent = `코트 ${index + 1} · ${activeSlot.slotIndex + 1}번 선택됨`;
}

function render() {
  renderStats();
  renderCourts();
  renderParticipants();
  renderActiveSlotBadge();
  const disabled = history.length === 0;
  document.getElementById("undoBtn").disabled = disabled;
  document.getElementById("mobileUndoBtn").disabled = disabled;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

document.getElementById("addParticipantsBtn").addEventListener("click", addParticipants);
document.getElementById("addCourtBtn").addEventListener("click", addCourt);
document.getElementById("recommendPlacementBtn").addEventListener("click", recommendPlacement);
document.getElementById("completeGameBtn").addEventListener("click", completeCurrentGame);
document.getElementById("mobileCompleteBtn").addEventListener("click", completeCurrentGame);
document.getElementById("clearCourtsBtn").addEventListener("click", clearCourts);
document.getElementById("resetAllBtn").addEventListener("click", resetAll);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("mobileUndoBtn").addEventListener("click", undo);
document.getElementById("participantSearch").addEventListener("input", e => {
  searchKeyword = e.target.value.trim();
  renderParticipants();
});
document.getElementById("playerInput").addEventListener("keydown", e => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addParticipants();
});

render();
