const STORAGE_KEY = "badminton-ops-site-html-v2";
const LEGACY_STORAGE_KEY = "badminton-ops-site-html-v1";
const HISTORY_LIMIT = 10;
const LEVELS = ["A", "B", "C", "D"];

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createParticipant(name, count = 0, level = "C") {
  return { id: uid(), name, count: Number(count) || 0, level: LEVELS.includes(level) ? level : "C" };
}

function createCourt() {
  return { id: uid(), playerIds: ["", "", "", ""] };
}

function createInitialState() {
  return { version: 2, courts: [createCourt()], participants: [] };
}

function migrateLegacyData(legacy) {
  if (!legacy || !Array.isArray(legacy.participants)) return createInitialState();

  const participants = legacy.participants.map(name =>
    createParticipant(String(name), legacy.participationCounts?.[name] || 0)
  );
  const availableByName = participants.reduce((map, participant) => {
    if (!map.has(participant.name)) map.set(participant.name, []);
    map.get(participant.name).push(participant.id);
    return map;
  }, new Map());

  const courts = Array.isArray(legacy.courts) && legacy.courts.length
    ? legacy.courts.map(oldCourt => {
        const usedInCourt = new Set();
        const playerIds = (oldCourt.players || ["", "", "", ""]).map(name => {
          if (!name) return "";
          const ids = availableByName.get(String(name)) || [];
          const id = ids.find(candidate => !usedInCourt.has(candidate)) || ids[0] || "";
          if (id) usedInCourt.add(id);
          return id;
        });
        return { id: oldCourt.id || uid(), playerIds: [...playerIds, "", "", ""].slice(0, 4) };
      })
    : [createCourt()];

  return { version: 2, courts, participants };
}

function normalizeState(state) {
  const safeParticipants = Array.isArray(state?.participants)
    ? state.participants.map(item => ({
        id: item.id || uid(),
        name: String(item.name || "").trim(),
        count: Math.max(Number(item.count) || 0, 0),
        level: LEVELS.includes(item.level) ? item.level : "C",
      })).filter(item => item.name)
    : [];
  const validIds = new Set(safeParticipants.map(item => item.id));
  const safeCourts = Array.isArray(state?.courts) && state.courts.length
    ? state.courts.map(court => ({
        id: court.id || uid(),
        playerIds: [...(court.playerIds || []), "", "", "", ""]
          .slice(0, 4)
          .map(id => validIds.has(id) ? id : ""),
      }))
    : [createCourt()];
  return { version: 2, courts: safeCourts, participants: safeParticipants };
}

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return normalizeState(JSON.parse(saved));
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const migrated = migrateLegacyData(JSON.parse(legacy));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch (error) {
    console.warn("저장 데이터 불러오기 실패", error);
  }
  return createInitialState();
}

let data = loadData();
let activeSlot = null;
let selectedParticipantId = null;
let saveTimer = null;
let history = [];
let searchKeyword = "";

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function pushHistory() {
  history.push(cloneState(data));
  if (history.length > HISTORY_LIMIT) history.shift();
}

function persist(next, options = {}) {
  if (!options.skipHistory) pushHistory();
  data = normalizeState(next);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  flashSaved(options.message || "저장됨");
  render();
}

function flashSaved(message) {
  const el = document.getElementById("saveMessage");
  el.textContent = message;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { el.textContent = ""; }, 1400);
}

function undo() {
  const previous = history.pop();
  if (!previous) return;
  data = normalizeState(previous);
  activeSlot = null;
  selectedParticipantId = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  flashSaved("이전 상태로 복원됨");
  render();
}

function getParticipant(id) {
  return data.participants.find(participant => participant.id === id);
}

function getPlacedIds() {
  return data.courts.flatMap(court => court.playerIds).filter(Boolean);
}

function getSortedParticipants() {
  const placedSet = new Set(getPlacedIds());
  return data.participants
    .map((participant, index) => ({ ...participant, index, isPlaced: placedSet.has(participant.id) }))
    .filter(participant => participant.name.toLowerCase().includes(searchKeyword))
    .sort((a, b) => {
      if (a.isPlaced !== b.isPlaced) return Number(a.isPlaced) - Number(b.isPlaced);
      if (a.count !== b.count) return a.count - b.count;
      return a.index - b.index;
    });
}

function getSummary() {
  const placedIds = getPlacedIds();
  return {
    courts: data.courts.length,
    participants: data.participants.length,
    assigned: placedIds.length,
    unassigned: Math.max(data.participants.length - new Set(placedIds).size, 0),
    emptySlots: data.courts.reduce((sum, court) => sum + court.playerIds.filter(id => !id).length, 0),
  };
}

function addParticipants() {
  const input = document.getElementById("playerInput");
  const names = input.value.split(/\n|,/).map(name => name.trim()).filter(Boolean);
  if (!names.length) return;
  persist({ ...data, participants: [...data.participants, ...names.map(name => createParticipant(name))] }, { message: `${names.length}명 추가됨` });
  input.value = "";
}

function addCourt() {
  persist({ ...data, courts: [...data.courts, createCourt()] }, { message: "코트 추가됨" });
}

function removeCourt(courtId) {
  if (data.courts.length === 1) return;
  if (!window.confirm("이 코트를 삭제할까요? 배치된 인원은 미배치 상태로 돌아갑니다.")) return;
  if (activeSlot?.courtId === courtId) activeSlot = null;
  persist({ ...data, courts: data.courts.filter(court => court.id !== courtId) });
}

function selectSlot(courtId, slotIndex) {
  activeSlot = { courtId, slotIndex };
  render();
}

function assignParticipant(participantId) {
  if (!activeSlot) {
    flashSaved("먼저 코트 자리를 선택하세요");
    return;
  }
  const clearedCourts = data.courts.map(court => ({
    ...court,
    playerIds: court.playerIds.map(id => id === participantId ? "" : id),
  }));
  const nextCourts = clearedCourts.map(court => {
    if (court.id !== activeSlot.courtId) return court;
    const playerIds = [...court.playerIds];
    playerIds[activeSlot.slotIndex] = participantId;
    return { ...court, playerIds };
  });
  selectedParticipantId = participantId;
  persist({ ...data, courts: nextCourts });
}

function removePlayerFromCourt(courtId, slotIndex) {
  persist({
    ...data,
    courts: data.courts.map(court => {
      if (court.id !== courtId) return court;
      const playerIds = [...court.playerIds];
      playerIds[slotIndex] = "";
      return { ...court, playerIds };
    }),
  });
}

function removeParticipant(participantId) {
  const participant = getParticipant(participantId);
  if (!participant || !window.confirm(`${participant.name} 참가자를 삭제할까요?`)) return;
  persist({
    ...data,
    participants: data.participants.filter(item => item.id !== participantId),
    courts: data.courts.map(court => ({ ...court, playerIds: court.playerIds.map(id => id === participantId ? "" : id) })),
  });
}

function adjustCount(participantId, amount) {
  persist({
    ...data,
    participants: data.participants.map(participant =>
      participant.id === participantId
        ? { ...participant, count: Math.max(participant.count + amount, 0) }
        : participant
    ),
  });
}

function cycleLevel(participantId) {
  persist({
    ...data,
    participants: data.participants.map(participant => {
      if (participant.id !== participantId) return participant;
      const nextIndex = (LEVELS.indexOf(participant.level) + 1) % LEVELS.length;
      return { ...participant, level: LEVELS[nextIndex] };
    }),
  }, { message: "등급 변경됨" });
}

function levelScore(level) {
  return { A: 4, B: 3, C: 2, D: 1 }[level] || 2;
}

function buildBalancedGroup(pool, size) {
  const sorted = [...pool].sort((a, b) => a.count - b.count || levelScore(b.level) - levelScore(a.level));
  const selected = sorted.slice(0, size);
  if (selected.length < 4) return selected;

  const byLevel = [...selected].sort((a, b) => levelScore(b.level) - levelScore(a.level));
  return [byLevel[0], byLevel[3], byLevel[1], byLevel[2]];
}

function recommendPlacement() {
  const placedSet = new Set(getPlacedIds());
  let pool = data.participants.filter(participant => !placedSet.has(participant.id));
  if (!pool.length) {
    flashSaved("배치할 미배치 인원이 없습니다");
    return;
  }

  const nextCourts = data.courts.map(court => {
    const emptyIndexes = court.playerIds.map((id, index) => id ? -1 : index).filter(index => index >= 0);
    if (!emptyIndexes.length || !pool.length) return court;
    const group = buildBalancedGroup(pool, Math.min(emptyIndexes.length, pool.length));
    const playerIds = [...court.playerIds];
    emptyIndexes.forEach((slotIndex, index) => {
      if (group[index]) playerIds[slotIndex] = group[index].id;
    });
    const used = new Set(group.map(item => item.id));
    pool = pool.filter(item => !used.has(item.id));
    return { ...court, playerIds };
  });

  activeSlot = null;
  selectedParticipantId = null;
  persist({ ...data, courts: nextCourts }, { message: "게임 횟수·등급 기준 자동 배치됨" });
}

function completeGameForIds(ids, courtId = null) {
  const uniqueIds = new Set(ids.filter(Boolean));
  if (!uniqueIds.size) return;
  persist({
    ...data,
    participants: data.participants.map(participant => uniqueIds.has(participant.id) ? { ...participant, count: participant.count + 1 } : participant),
    courts: data.courts.map(court => (!courtId || court.id === courtId) ? { ...court, playerIds: ["", "", "", ""] } : court),
  }, { message: `${uniqueIds.size}명 참여 횟수 반영됨` });
}

function completeCurrentGame() {
  const ids = getPlacedIds();
  if (!ids.length) return flashSaved("배치된 인원이 없습니다");
  if (!window.confirm(`현재 배치된 ${new Set(ids).size}명의 참여 횟수를 반영하고 모든 코트를 비울까요?`)) return;
  activeSlot = null;
  selectedParticipantId = null;
  completeGameForIds(ids);
}

function completeCourtGame(courtId) {
  const court = data.courts.find(item => item.id === courtId);
  const ids = court?.playerIds.filter(Boolean) || [];
  if (!ids.length) return flashSaved("이 코트에 배치된 인원이 없습니다");
  if (!window.confirm(`${ids.length}명의 참여 횟수를 반영하고 이 코트를 비울까요?`)) return;
  if (activeSlot?.courtId === courtId) activeSlot = null;
  selectedParticipantId = null;
  completeGameForIds(ids, courtId);
}

function clearCourts() {
  if (!window.confirm("모든 코트 배치를 비울까요? 참여 횟수는 유지됩니다.")) return;
  activeSlot = null;
  selectedParticipantId = null;
  persist({ ...data, courts: data.courts.map(court => ({ ...court, playerIds: ["", "", "", ""] })) });
}

function resetAll() {
  if (!window.confirm("참석자, 코트, 참여 횟수를 모두 초기화할까요? 실행 취소로 복구할 수 있습니다.")) return;
  activeSlot = null;
  selectedParticipantId = null;
  persist(createInitialState(), { message: "전체 초기화됨" });
  document.getElementById("playerInput").value = "";
}

function renderStats() {
  const stats = getSummary();
  const items = [["코트 수", stats.courts], ["참석자", stats.participants], ["배치 완료", stats.assigned], ["미배치", stats.unassigned], ["빈 자리", stats.emptySlots]];
  document.getElementById("stats").innerHTML = items.map(([label, value]) => `
    <div class="card stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>
  `).join("");
}

function renderCourts() {
  const list = document.getElementById("courtList");
  list.innerHTML = data.courts.map((court, index) => {
    const filled = court.playerIds.filter(Boolean).length;
    const slots = court.playerIds.map((participantId, slotIndex) => {
      const participant = getParticipant(participantId);
      const isActive = activeSlot?.courtId === court.id && activeSlot?.slotIndex === slotIndex;
      return `
        <button class="slot ${isActive ? "active" : ""} ${participant ? "" : "empty"}" data-court-id="${court.id}" data-slot-index="${slotIndex}">
          <span class="slot-info">
            <span class="${participant ? "slot-player" : ""}">${participant ? escapeHtml(participant.name) : "빈 자리"}</span>
            ${participant ? `<span class="slot-meta">등급 ${participant.level} · 참여 ${participant.count}회</span>` : ""}
          </span>
          ${participant ? `<span class="slot-remove" data-remove-court-id="${court.id}" data-remove-slot-index="${slotIndex}">✕</span>` : `<span class="slot-meta">선택</span>`}
        </button>`;
    }).join("");
    return `
      <div class="card">
        <div class="court-card-header">
          <div><div class="section-title small-title">코트 ${index + 1}</div><div class="court-subtitle">복식 · 최대 4명</div></div>
          <div class="court-actions actions"><div class="badge">${filled}/4</div><button class="btn success" data-complete-court-id="${court.id}">게임 종료</button><button class="btn" data-delete-court-id="${court.id}">삭제</button></div>
        </div>
        <div class="court-card-body"><div class="court-grid">${slots}</div></div>
      </div>`;
  }).join("");

  list.querySelectorAll("[data-court-id][data-slot-index]").forEach(button => button.addEventListener("click", event => {
    if (event.target.closest("[data-remove-court-id]")) return;
    selectSlot(button.dataset.courtId, Number(button.dataset.slotIndex));
  }));
  list.querySelectorAll("[data-remove-court-id]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    removePlayerFromCourt(button.dataset.removeCourtId, Number(button.dataset.removeSlotIndex));
  }));
  list.querySelectorAll("[data-delete-court-id]").forEach(button => button.addEventListener("click", () => removeCourt(button.dataset.deleteCourtId)));
  list.querySelectorAll("[data-complete-court-id]").forEach(button => button.addEventListener("click", () => completeCourtGame(button.dataset.completeCourtId)));
}

function renderParticipants() {
  const list = document.getElementById("participantList");
  const participants = getSortedParticipants();
  if (!participants.length) {
    list.innerHTML = `<div class="empty-text">${searchKeyword ? "검색 결과가 없습니다." : "참석자 이름을 먼저 입력해 주세요."}</div>`;
    return;
  }
  list.innerHTML = participants.map(participant => `
    <div class="participant-item">
      <button class="participant-main ${selectedParticipantId === participant.id ? "selected" : ""} ${participant.isPlaced ? "placed" : ""}" data-participant-id="${participant.id}">
        <span class="participant-meta"><span class="participant-count">참여 ${participant.count}회</span><span class="participant-name">${escapeHtml(participant.name)}</span></span>
        ${participant.isPlaced ? '<span class="placed-badge">배치됨</span>' : ""}
      </button>
      <button class="btn icon level-btn" title="등급 변경" data-level-id="${participant.id}">${participant.level}</button>
      <button class="btn icon count-btn" data-decrease-id="${participant.id}">−</button>
      <button class="btn icon count-btn" data-increase-id="${participant.id}">＋</button>
      <button class="btn icon" data-remove-id="${participant.id}">✕</button>
    </div>`).join("");

  list.querySelectorAll("[data-participant-id]").forEach(button => button.addEventListener("click", () => assignParticipant(button.dataset.participantId)));
  list.querySelectorAll("[data-level-id]").forEach(button => button.addEventListener("click", () => cycleLevel(button.dataset.levelId)));
  list.querySelectorAll("[data-decrease-id]").forEach(button => button.addEventListener("click", () => adjustCount(button.dataset.decreaseId, -1)));
  list.querySelectorAll("[data-increase-id]").forEach(button => button.addEventListener("click", () => adjustCount(button.dataset.increaseId, 1)));
  list.querySelectorAll("[data-remove-id]").forEach(button => button.addEventListener("click", () => removeParticipant(button.dataset.removeId)));
}

function renderActiveSlotBadge() {
  const badge = document.getElementById("activeSlotBadge");
  if (!activeSlot) return void (badge.textContent = "자리를 먼저 선택하세요");
  const courtIndex = data.courts.findIndex(court => court.id === activeSlot.courtId);
  badge.textContent = `선택된 자리: 코트 ${courtIndex + 1} / ${activeSlot.slotIndex + 1}번`;
}

function render() {
  renderStats();
  renderCourts();
  renderParticipants();
  renderActiveSlotBadge();
  document.getElementById("undoBtn").disabled = history.length === 0;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

document.getElementById("addParticipantsBtn").addEventListener("click", addParticipants);
document.getElementById("addCourtBtn").addEventListener("click", addCourt);
document.getElementById("recommendPlacementBtn").addEventListener("click", recommendPlacement);
document.getElementById("completeGameBtn").addEventListener("click", completeCurrentGame);
document.getElementById("mobileCompleteGameBtn").addEventListener("click", completeCurrentGame);
document.getElementById("clearCourtsBtn").addEventListener("click", clearCourts);
document.getElementById("resetAllBtn").addEventListener("click", resetAll);
document.getElementById("undoBtn").addEventListener("click", undo);
document.getElementById("participantSearch").addEventListener("input", event => {
  searchKeyword = event.target.value.trim().toLowerCase();
  renderParticipants();
});
document.getElementById("playerInput").addEventListener("keydown", event => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) addParticipants();
});

render();