const STORAGE_KEY = "badminton-ops-site-html-v1";

function uid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function createCourt() {
  return { id: uid(), players: ["", "", "", ""] };
}

function createInitialState() {
  return {
    courts: [createCourt()],
    participants: [],
    participationCounts: {},
  };
}

let data = loadData();
let activeSlot = null;
let selectedParticipant = null;
let saveTimer = null;

function loadData() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {}
  return createInitialState();
}

function persist(next) {
  data = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  flashSaved();
  render();
}

function flashSaved() {
  const el = document.getElementById("saveMessage");
  el.textContent = "저장됨";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    el.textContent = "";
  }, 1000);
}

function getPlacedPlayers() {
  return data.courts.flatMap(court => court.players).filter(Boolean);
}

function getSortedParticipants() {
  const placedSet = new Set(getPlacedPlayers());
  return data.participants
    .map((name, index) => ({
      name,
      index,
      key: `${name}__${index}`,
      count: data.participationCounts?.[name] || 0,
      isPlaced: placedSet.has(name),
    }))
    .sort((a, b) => {
      if (a.count !== b.count) return a.count - b.count;
      if (a.isPlaced !== b.isPlaced) return Number(a.isPlaced) - Number(b.isPlaced);
      return a.index - b.index;
    });
}

function getSummary() {
  const placedPlayers = getPlacedPlayers();
  const courts = data.courts.length;
  const participants = data.participants.length;
  const assigned = placedPlayers.length;
  const unassigned = Math.max(participants - assigned, 0);
  const emptySlots = data.courts.reduce((sum, court) => sum + court.players.filter(p => !p).length, 0);
  return { courts, participants, assigned, unassigned, emptySlots };
}

function addParticipants() {
  const input = document.getElementById("playerInput");
  const names = input.value
    .split(/\n|,/)
    .map(name => name.trim())
    .filter(Boolean);
  if (!names.length) return;
  persist({
    ...data,
    participants: [...data.participants, ...names],
  });
  input.value = "";
}

function addCourt() {
  persist({
    ...data,
    courts: [...data.courts, createCourt()],
  });
}

function recommendPlacement() {
  const candidates = getSortedParticipants().filter(participant => !participant.isPlaced);
  if (!candidates.length) return;

  let candidateIndex = 0;
  const nextCourts = data.courts.map(court => {
    const nextPlayers = [...court.players];
    for (let i = 0; i < nextPlayers.length; i += 1) {
      if (nextPlayers[i]) continue;
      if (candidateIndex >= candidates.length) break;
      nextPlayers[i] = candidates[candidateIndex].name;
      candidateIndex += 1;
    }
    return { ...court, players: nextPlayers };
  });

  activeSlot = null;
  selectedParticipant = null;
  persist({
    ...data,
    courts: nextCourts,
  });
}

function removeCourt(courtId) {
  const nextCourts = data.courts.length === 1 ? data.courts : data.courts.filter(c => c.id !== courtId);
  if (activeSlot && activeSlot.courtId === courtId) activeSlot = null;
  persist({ ...data, courts: nextCourts });
}

function selectSlot(courtId, slotIndex) {
  activeSlot = { courtId, slotIndex };
  render();
}

function assignParticipant(name, key) {
  if (!activeSlot) return;

  const clearedCourts = data.courts.map(court => ({
    ...court,
    players: court.players.map(p => p === name ? "" : p),
  }));

  const nextCourts = clearedCourts.map(court => {
    if (court.id !== activeSlot.courtId) return court;
    const nextPlayers = [...court.players];
    nextPlayers[activeSlot.slotIndex] = name;
    return { ...court, players: nextPlayers };
  });

  selectedParticipant = key;
  persist({ ...data, courts: nextCourts });
}

function removePlayerFromCourt(courtId, slotIndex) {
  persist({
    ...data,
    courts: data.courts.map(court => {
      if (court.id !== courtId) return court;
      const nextPlayers = [...court.players];
      nextPlayers[slotIndex] = "";
      return { ...court, players: nextPlayers };
    })
  });
}

function removeParticipant(targetName, targetIndex) {
  persist({
    ...data,
    participants: data.participants.filter((name, index) => !(name === targetName && index === targetIndex)),
    courts: data.courts.map(court => ({
      ...court,
      players: court.players.map(p => p === targetName ? "" : p),
    }))
  });
}

function increaseCount(name) {
  persist({
    ...data,
    participationCounts: {
      ...data.participationCounts,
      [name]: (data.participationCounts?.[name] || 0) + 1,
    }
  });
}

function decreaseCount(name) {
  const current = data.participationCounts?.[name] || 0;
  persist({
    ...data,
    participationCounts: {
      ...data.participationCounts,
      [name]: Math.max(current - 1, 0),
    }
  });
}

function completeCurrentGame() {
  const uniquePlayed = Array.from(new Set(getPlacedPlayers()));
  const nextCounts = { ...(data.participationCounts || {}) };
  uniquePlayed.forEach(name => {
    nextCounts[name] = (nextCounts[name] || 0) + 1;
  });

  activeSlot = null;
  selectedParticipant = null;
  persist({
    ...data,
    participationCounts: nextCounts,
    courts: data.courts.map(court => ({ ...court, players: ["", "", "", ""] }))
  });
}

function completeCourtGame(courtId) {
  const targetCourt = data.courts.find(court => court.id === courtId);
  if (!targetCourt) return;

  const uniquePlayed = Array.from(new Set(targetCourt.players.filter(Boolean)));
  if (!uniquePlayed.length) return;

  const nextCounts = { ...(data.participationCounts || {}) };
  uniquePlayed.forEach(name => {
    nextCounts[name] = (nextCounts[name] || 0) + 1;
  });

  if (activeSlot && activeSlot.courtId === courtId) activeSlot = null;
  selectedParticipant = null;

  persist({
    ...data,
    participationCounts: nextCounts,
    courts: data.courts.map(court =>
      court.id === courtId ? { ...court, players: ["", "", "", ""] } : court
    )
  });
}

function clearCourts() {
  activeSlot = null;
  selectedParticipant = null;
  persist({
    ...data,
    courts: data.courts.map(court => ({ ...court, players: ["", "", "", ""] }))
  });
}

function resetAll() {
  data = createInitialState();
  activeSlot = null;
  selectedParticipant = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  document.getElementById("playerInput").value = "";
  flashSaved();
  render();
}

function renderStats() {
  const stats = getSummary();
  const container = document.getElementById("stats");
  const items = [
    ["코트 수", stats.courts],
    ["참석자", stats.participants],
    ["배치 완료", stats.assigned],
    ["미배치", stats.unassigned],
    ["빈 자리", stats.emptySlots],
  ];

  container.innerHTML = items.map(([label, value]) => `
    <div class="card stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
    </div>
  `).join("");
}

function renderCourts() {
  const list = document.getElementById("courtList");
  list.innerHTML = data.courts.map((court, index) => {
    const filled = court.players.filter(Boolean).length;
    const slots = court.players.map((player, slotIndex) => {
      const isActive = activeSlot && activeSlot.courtId === court.id && activeSlot.slotIndex === slotIndex;
      return `
        <button class="slot ${isActive ? "active" : ""} ${player ? "" : "empty"}" data-court-id="${court.id}" data-slot-index="${slotIndex}">
          <span class="${player ? "slot-player" : ""}">${player || "빈 자리"}</span>
          ${player ? `<span class="slot-remove" data-remove-court-id="${court.id}" data-remove-slot-index="${slotIndex}">✕</span>` : `<span style="font-size:12px;color:#cbd5e1;">선택</span>`}
        </button>
      `;
    }).join("");

    return `
      <div class="card">
        <div class="court-card-header">
          <div>
            <div class="section-title" style="font-size:20px;">코트 ${index + 1}</div>
            <div class="court-subtitle">복식 · 최대 4명</div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <div class="badge">${filled}/4</div>
            <button class="btn success" data-complete-court-id="${court.id}">게임 종료</button>
            <button class="btn" data-delete-court-id="${court.id}">삭제</button>
          </div>
        </div>
        <div class="court-card-body">
          <div class="court-grid">${slots}</div>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-court-id][data-slot-index]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      if (e.target.closest("[data-remove-court-id]")) return;
      selectSlot(btn.dataset.courtId, Number(btn.dataset.slotIndex));
    });
  });

  list.querySelectorAll("[data-remove-court-id]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      removePlayerFromCourt(btn.dataset.removeCourtId, Number(btn.dataset.removeSlotIndex));
    });
  });

  list.querySelectorAll("[data-delete-court-id]").forEach(btn => {
    btn.addEventListener("click", () => removeCourt(btn.dataset.deleteCourtId));
  });
  list.querySelectorAll("[data-complete-court-id]").forEach(btn => {
    btn.addEventListener("click", () => completeCourtGame(btn.dataset.completeCourtId));
  });
}

function renderParticipants() {
  const list = document.getElementById("participantList");
  if (!data.participants.length) {
    list.innerHTML = '<div class="empty-text">참석자 이름을 먼저 입력해 주세요.</div>';
    return;
  }

  list.innerHTML = getSortedParticipants().map(({ name, index, key, isPlaced, count }) => `
    <div class="participant-item">
      <button class="participant-main ${selectedParticipant === key ? "selected" : ""} ${isPlaced ? "placed" : ""}" data-participant-name="${escapeHtml(name)}" data-participant-key="${escapeHtml(key)}">
        <div class="participant-meta">
          <div class="participant-count">참여 ${count}회</div>
          <div class="participant-name">${escapeHtml(name)}</div>
        </div>
        ${isPlaced ? '<span class="placed-badge">배치됨</span>' : ''}
      </button>
      <button class="btn icon" data-decrease-name="${escapeHtml(name)}">−</button>
      <button class="btn icon" data-increase-name="${escapeHtml(name)}">＋</button>
      <button class="btn icon" data-remove-name="${escapeHtml(name)}" data-remove-index="${index}">✕</button>
    </div>
  `).join("");

  list.querySelectorAll("[data-participant-name]").forEach(btn => {
    btn.addEventListener("click", () => assignParticipant(btn.dataset.participantName, btn.dataset.participantKey));
  });
  list.querySelectorAll("[data-decrease-name]").forEach(btn => {
    btn.addEventListener("click", () => decreaseCount(btn.dataset.decreaseName));
  });
  list.querySelectorAll("[data-increase-name]").forEach(btn => {
    btn.addEventListener("click", () => increaseCount(btn.dataset.increaseName));
  });
  list.querySelectorAll("[data-remove-name]").forEach(btn => {
    btn.addEventListener("click", () => removeParticipant(btn.dataset.removeName, Number(btn.dataset.removeIndex)));
  });
}

function renderActiveSlotBadge() {
  const badge = document.getElementById("activeSlotBadge");
  if (!activeSlot) {
    badge.textContent = "자리를 먼저 선택하세요";
    return;
  }
  const courtIndex = data.courts.findIndex(c => c.id === activeSlot.courtId);
  badge.textContent = `선택된 자리: 코트 ${courtIndex + 1} / ${activeSlot.slotIndex + 1}번`;
}

function render() {
  renderStats();
  renderCourts();
  renderParticipants();
  renderActiveSlotBadge();
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
document.getElementById("clearCourtsBtn").addEventListener("click", clearCourts);
document.getElementById("resetAllBtn").addEventListener("click", resetAll);
document.getElementById("playerInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) addParticipants();
});

render();
