const STORAGE_KEY = "badminton-ops-site-html-v2";
const LEGACY_STORAGE_KEY = "badminton-ops-site-html-v1";
const HISTORY_LIMIT = 10;
const LEVELS = ["A", "B", "C", "D"];
const DRAG_THRESHOLD = 8;

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
  const participants = legacy.participants.map(name => createParticipant(String(name), legacy.participationCounts?.[name] || 0));
  const byName = participants.reduce((map, participant) => {
    if (!map.has(participant.name)) map.set(participant.name, []);
    map.get(participant.name).push(participant.id);
    return map;
  }, new Map());
  const courts = Array.isArray(legacy.courts) && legacy.courts.length
    ? legacy.courts.map(oldCourt => {
        const used = new Set();
        const playerIds = (oldCourt.players || ["", "", "", ""]).map(name => {
          if (!name) return "";
          const ids = byName.get(String(name)) || [];
          const id = ids.find(candidate => !used.has(candidate)) || ids[0] || "";
          if (id) used.add(id);
          return id;
        });
        return { id: oldCourt.id || uid(), playerIds: [...playerIds, "", "", "", ""].slice(0, 4) };
      })
    : [createCourt()];
  return { version: 2, courts, participants };
}

function normalizeState(state) {
  const participants = Array.isArray(state?.participants)
    ? state.participants.map(item => ({
        id: item.id || uid(),
        name: String(item.name || "").trim(),
        count: Math.max(Number(item.count) || 0, 0),
        level: LEVELS.includes(item.level) ? item.level : "C",
      })).filter(item => item.name)
    : [];
  const validIds = new Set(participants.map(item => item.id));
  const courts = Array.isArray(state?.courts) && state.courts.length
    ? state.courts.map(court => ({
        id: court.id || uid(),
        playerIds: [...(court.playerIds || []), "", "", "", ""].slice(0, 4).map(id => validIds.has(id) ? id : ""),
      }))
    : [createCourt()];
  return { version: 2, courts, participants };
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
let pointerDrag = null;

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}

function persist(next, options = {}) {
  if (!options.skipHistory) {
    history.push(cloneState(data));
    if (history.length > HISTORY_LIMIT) history.shift();
  }
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

function getPlacedParticipants() {
  const result = [];
  data.courts.forEach((court, courtIndex) => {
    court.playerIds.forEach((id, slotIndex) => {
      const participant = getParticipant(id);
      if (participant) result.push({ participant, courtId: court.id, courtIndex, slotIndex });
    });
  });
  return result;
}

function getSortedParticipants() {
  return data.participants
    .map((participant, index) => ({ ...participant, index }))
    .filter(participant => participant.name.toLowerCase().includes(searchKeyword))
    .sort((a, b) => a.count - b.count || a.index - b.index);
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
  if (data.courts.length === 1) return flashSaved("코트는 최소 1개 필요합니다");
  if (!window.confirm("이 코트를 삭제할까요? 배치된 인원은 미배치 상태로 돌아갑니다.")) return;
  if (activeSlot?.courtId === courtId) activeSlot = null;
  persist({ ...data, courts: data.courts.filter(court => court.id !== courtId) });
}

function selectSlot(courtId, slotIndex) {
  activeSlot = { courtId, slotIndex };
  render();
}

function placeParticipant(participantId, courtId, slotIndex) {
  if (!getParticipant(participantId)) return;
  const clearedCourts = data.courts.map(court => ({
    ...court,
    playerIds: court.playerIds.map(id => id === participantId ? "" : id),
  }));
  const courts = clearedCourts.map(court => {
    if (court.id !== courtId) return court;
    const playerIds = [...court.playerIds];
    playerIds[slotIndex] = participantId;
    return { ...court, playerIds };
  });
  activeSlot = { courtId, slotIndex };
  selectedParticipantId = participantId;
  persist({ ...data, courts }, { message: "참석자 배치됨" });
}

function assignParticipant(participantId) {
  if (!activeSlot) return flashSaved("먼저 코트 자리를 선택하세요");
  placeParticipant(participantId, activeSlot.courtId, activeSlot.slotIndex);
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
  }, { message: "배치 해제됨" });
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
    participants: data.participants.map(participant => participant.id === participantId
      ? { ...participant, count: Math.max(participant.count + amount, 0) }
      : participant),
  });
}

function cycleLevel(participantId) {
  persist({
    ...data,
    participants: data.participants.map(participant => {
      if (participant.id !== participantId) return participant;
      return { ...participant, level: LEVELS[(LEVELS.indexOf(participant.level) + 1) % LEVELS.length] };
    }),
  }, { message: "등급 변경됨" });
}

function levelScore(level) {
  return { A: 4, B: 3, C: 2, D: 1 }[level] || 2;
}

function buildBalancedGroup(pool, size) {
  const selected = [...pool].sort((a, b) => a.count - b.count || levelScore(b.level) - levelScore(a.level)).slice(0, size);
  if (selected.length < 4) return selected;
  const byLevel = [...selected].sort((a, b) => levelScore(b.level) - levelScore(a.level));
  return [byLevel[0], byLevel[3], byLevel[1], byLevel[2]];
}

function recommendPlacement() {
  const placedSet = new Set(getPlacedIds());
  let pool = data.participants.filter(participant => !placedSet.has(participant.id));
  if (!pool.length) return flashSaved("배치할 미배치 인원이 없습니다");
  const courts = data.courts.map(court => {
    const emptyIndexes = court.playerIds.map((id, index) => id ? -1 : index).filter(index => index >= 0);
    if (!emptyIndexes.length || !pool.length) return court;
    const group = buildBalancedGroup(pool, Math.min(emptyIndexes.length, pool.length));
    const playerIds = [...court.playerIds];
    emptyIndexes.forEach((slotIndex, index) => { if (group[index]) playerIds[slotIndex] = group[index].id; });
    const used = new Set(group.map(item => item.id));
    pool = pool.filter(item => !used.has(item.id));
    return { ...court, playerIds };
  });
  activeSlot = null;
  selectedParticipantId = null;
  persist({ ...data, courts }, { message: "게임 횟수·등급 기준 자동 배치됨" });
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
  document.getElementById("stats").innerHTML = items.map(([label, value]) => `<div class="card stat-card"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`).join("");
}

function renderCourts() {
  const list = document.getElementById("courtList");
  list.innerHTML = data.courts.map((court, index) => {
    const filled = court.playerIds.filter(Boolean).length;
    const slots = court.playerIds.map((participantId, slotIndex) => {
      const participant = getParticipant(participantId);
      const active = activeSlot?.courtId === court.id && activeSlot?.slotIndex === slotIndex;
      return `<button class="slot ${active ? "active" : ""} ${participant ? "" : "empty"}" data-court-id="${court.id}" data-slot-index="${slotIndex}">
        <span class="slot-info"><span class="${participant ? "slot-player" : ""}">${participant ? escapeHtml(participant.name) : "빈 자리"}</span>${participant ? `<span class="slot-meta">등급 ${participant.level} · 참여 ${participant.count}회</span>` : ""}</span>
        ${participant ? `<span class="slot-remove" data-remove-court-id="${court.id}" data-remove-slot-index="${slotIndex}">✕</span>` : `<span class="slot-meta">드롭</span>`}
      </button>`;
    }).join("");
    return `<div class="card"><div class="court-card-header"><div><div class="section-title small-title">코트 ${index + 1}</div><div class="court-subtitle">복식 · 최대 4명</div></div><div class="court-actions"><div class="badge">${filled}/4</div><button class="btn success" data-complete-court-id="${court.id}">게임 종료</button><button class="btn" data-delete-court-id="${court.id}">삭제</button></div></div><div class="court-card-body"><div class="court-grid">${slots}</div></div></div>`;
  }).join("");

  list.querySelectorAll("[data-court-id][data-slot-index]").forEach(slot => {
    slot.addEventListener("click", event => {
      if (!event.target.closest("[data-remove-court-id]")) selectSlot(slot.dataset.courtId, Number(slot.dataset.slotIndex));
    });
    slot.addEventListener("dragover", event => { event.preventDefault(); slot.classList.add("drag-over"); });
    slot.addEventListener("dragleave", () => slot.classList.remove("drag-over"));
    slot.addEventListener("drop", event => {
      event.preventDefault();
      slot.classList.remove("drag-over");
      const participantId = event.dataTransfer.getData("text/participant-id");
      if (participantId) placeParticipant(participantId, slot.dataset.courtId, Number(slot.dataset.slotIndex));
    });
  });
  list.querySelectorAll("[data-remove-court-id]").forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    removePlayerFromCourt(button.dataset.removeCourtId, Number(button.dataset.removeSlotIndex));
  }));
  list.querySelectorAll("[data-delete-court-id]").forEach(button => button.addEventListener("click", () => removeCourt(button.dataset.deleteCourtId)));
  list.querySelectorAll("[data-complete-court-id]").forEach(button => button.addEventListener("click", () => completeCourtGame(button.dataset.completeCourtId)));
}

function renderPlacedParticipants() {
  const list = document.getElementById("placedParticipantList");
  const placed = getPlacedParticipants();
  if (!placed.length) {
    list.innerHTML = '<div class="empty-text">현재 배치된 참가자가 없습니다.</div>';
    return;
  }
  list.innerHTML = placed.map(({ participant, courtId, courtIndex, slotIndex }) => `<div class="placed-chip"><div class="placed-chip-main"><div class="placed-chip-name">${escapeHtml(participant.name)}</div><div class="placed-chip-location">코트 ${courtIndex + 1} · ${slotIndex + 1}번</div></div><button class="btn icon" data-unplace-court-id="${courtId}" data-unplace-slot-index="${slotIndex}" aria-label="배치 해제">✕</button></div>`).join("");
  list.querySelectorAll("[data-unplace-court-id]").forEach(button => button.addEventListener("click", () => removePlayerFromCourt(button.dataset.unplaceCourtId, Number(button.dataset.unplaceSlotIndex))));
}

function renderParticipants() {
  const list = document.getElementById("participantList");
  const participants = getSortedParticipants();
  if (!participants.length) {
    list.innerHTML = `<div class="empty-text">${searchKeyword ? "검색 결과가 없습니다." : "참석자 이름을 먼저 입력해 주세요."}</div>`;
    return;
  }
  list.innerHTML = participants.map(participant => `<div class="participant-item">
    <button class="participant-main ${selectedParticipantId === participant.id ? "selected" : ""}" data-participant-id="${participant.id}" draggable="true">
      <span class="participant-meta"><span class="participant-count">참여 ${participant.count}회</span><span class="participant-name">${escapeHtml(participant.name)}</span></span><span class="drag-handle" aria-hidden="true">⠿</span>
    </button>
    <button class="btn icon level-btn" title="등급 변경" data-level-id="${participant.id}">${participant.level}</button>
    <button class="btn icon count-btn" data-decrease-id="${participant.id}">−</button>
    <button class="btn icon count-btn" data-increase-id="${participant.id}">＋</button>
    <button class="btn icon" data-remove-id="${participant.id}">✕</button>
  </div>`).join("");

  list.querySelectorAll("[data-participant-id]").forEach(button => {
    button.addEventListener("click", () => assignParticipant(button.dataset.participantId));
    button.addEventListener("dragstart", event => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/participant-id", button.dataset.participantId);
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      clearDropHighlights();
    });
    button.addEventListener("pointerdown", startPointerDrag);
  });
  list.querySelectorAll("[data-level-id]").forEach(button => button.addEventListener("click", () => cycleLevel(button.dataset.levelId)));
  list.querySelectorAll("[data-decrease-id]").forEach(button => button.addEventListener("click", () => adjustCount(button.dataset.decreaseId, -1)));
  list.querySelectorAll("[data-increase-id]").forEach(button => button.addEventListener("click", () => adjustCount(button.dataset.increaseId, 1)));
  list.querySelectorAll("[data-remove-id]").forEach(button => button.addEventListener("click", () => removeParticipant(button.dataset.removeId)));
}

function startPointerDrag(event) {
  if (event.pointerType === "mouse") return;
  const source = event.currentTarget;
  pointerDrag = { pointerId: event.pointerId, participantId: source.dataset.participantId, source, startX: event.clientX, startY: event.clientY, active: false };
  source.setPointerCapture?.(event.pointerId);
  source.addEventListener("pointermove", movePointerDrag);
  source.addEventListener("pointerup", endPointerDrag);
  source.addEventListener("pointercancel", endPointerDrag);
}

function movePointerDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const distance = Math.hypot(event.clientX - pointerDrag.startX, event.clientY - pointerDrag.startY);
  if (!pointerDrag.active && distance < DRAG_THRESHOLD) return;
  if (!pointerDrag.active) {
    pointerDrag.active = true;
    pointerDrag.source.classList.add("dragging");
    const participant = getParticipant(pointerDrag.participantId);
    const ghost = document.getElementById("dragGhost");
    ghost.textContent = participant?.name || "참석자";
    ghost.classList.add("visible");
  }
  event.preventDefault();
  moveGhost(event.clientX, event.clientY);
  autoScrollDuringDrag(event.clientY);
  highlightDropTarget(event.clientX, event.clientY);
}

function endPointerDrag(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;
  const { source, participantId, active } = pointerDrag;
  source.releasePointerCapture?.(event.pointerId);
  source.removeEventListener("pointermove", movePointerDrag);
  source.removeEventListener("pointerup", endPointerDrag);
  source.removeEventListener("pointercancel", endPointerDrag);
  source.classList.remove("dragging");
  document.getElementById("dragGhost").classList.remove("visible");
  const target = active ? getSlotAtPoint(event.clientX, event.clientY) : null;
  clearDropHighlights();
  pointerDrag = null;
  if (target) placeParticipant(participantId, target.dataset.courtId, Number(target.dataset.slotIndex));
}

function autoScrollDuringDrag(y) {
  const edge = 90;
  if (y < edge) window.scrollBy({ top: -14, behavior: "auto" });
  else if (y > window.innerHeight - edge) window.scrollBy({ top: 14, behavior: "auto" });
}

function moveGhost(x, y) {
  document.getElementById("dragGhost").style.transform = `translate(${x + 12}px, ${y + 12}px)`;
}

function getSlotAtPoint(x, y) {
  return document.elementsFromPoint(x, y).map(element => element.closest?.(".slot")).find(Boolean) || null;
}

function highlightDropTarget(x, y) {
  const target = getSlotAtPoint(x, y);
  document.querySelectorAll(".slot.drag-over").forEach(slot => { if (slot !== target) slot.classList.remove("drag-over"); });
  target?.classList.add("drag-over");
}

function clearDropHighlights() {
  document.querySelectorAll(".slot.drag-over").forEach(slot => slot.classList.remove("drag-over"));
}

function renderActiveSlotBadge() {
  const badge = document.getElementById("activeSlotBadge");
  if (!activeSlot) return void (badge.textContent = "참석자를 끌거나 자리를 선택하세요");
  const courtIndex = data.courts.findIndex(court => court.id === activeSlot.courtId);
  badge.textContent = `선택된 자리: 코트 ${courtIndex + 1} / ${activeSlot.slotIndex + 1}번`;
}

function render() {
  renderStats();
  renderCourts();
  renderPlacedParticipants();
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