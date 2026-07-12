/* 참가자 등급을 1~10 가중치로 전환하고 자동 편성 프리셋을 제공합니다. */
const WEIGHT_MIN = 1;
const WEIGHT_MAX = 10;
const WEIGHT_DEFAULT = 5;
const MATCH_MODE_KEY = "badminton-ops-match-mode";
const LEGACY_LEVEL_WEIGHT = { A: 9, B: 7, C: 5, D: 3 };

function clampWeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return WEIGHT_DEFAULT;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, Math.round(number)));
}

function resolveWeight(item) {
  if (item && item.weight != null) return clampWeight(item.weight);
  return LEGACY_LEVEL_WEIGHT[item?.level] || WEIGHT_DEFAULT;
}

createParticipant = function createWeightedParticipant(name, count = 0, weight = WEIGHT_DEFAULT) {
  return {
    id: uid(),
    name,
    count: Number(count) || 0,
    weight: clampWeight(weight),
  };
};

normalizeState = function normalizeWeightedState(state) {
  const participants = Array.isArray(state?.participants)
    ? state.participants.map(item => ({
        id: item.id || uid(),
        name: String(item.name || "").trim(),
        count: Math.max(Number(item.count) || 0, 0),
        weight: resolveWeight(item),
      })).filter(item => item.name)
    : [];

  const validIds = new Set(participants.map(item => item.id));
  const courts = Array.isArray(state?.courts) && state.courts.length
    ? state.courts.map(court => ({
        id: court.id || uid(),
        playerIds: [...(court.playerIds || []), "", "", "", ""]
          .slice(0, 4)
          .map(id => validIds.has(id) ? id : ""),
      }))
    : [createCourt()];

  return { version: 3, courts, participants };
};

function adjustWeight(participantId, amount) {
  persist({
    ...data,
    participants: data.participants.map(participant => participant.id === participantId
      ? { ...participant, weight: clampWeight(resolveWeight(participant) + amount) }
      : participant),
  }, { message: "가중치 변경됨" });
}

function getMatchMode() {
  return localStorage.getItem(MATCH_MODE_KEY) || "balanced";
}

function ensureMatchModeControl() {
  const actions = document.querySelector(".section-actions");
  if (!actions || document.getElementById("matchMode")) return;

  const label = document.createElement("label");
  label.className = "match-mode-control";
  label.innerHTML = `
    <span>자동 편성 기준</span>
    <select id="matchMode" aria-label="자동 편성 기준">
      <option value="count">게임횟수 우선</option>
      <option value="balanced">균형 우선</option>
      <option value="weight">가중치 균형 우선</option>
    </select>`;

  const recommendButton = document.getElementById("recommendPlacementBtn");
  actions.insertBefore(label, recommendButton);

  const select = label.querySelector("select");
  select.value = getMatchMode();
  select.addEventListener("change", () => {
    localStorage.setItem(MATCH_MODE_KEY, select.value);
    flashSaved("자동 편성 기준 저장됨");
  });
}

function candidateScore(participant, mode, targetWeight) {
  const weightGap = Math.abs(resolveWeight(participant) - targetWeight);
  if (mode === "count") return participant.count * 100 + weightGap;
  if (mode === "weight") return weightGap * 20 + participant.count;
  return participant.count * 20 + weightGap * 4;
}

function selectBalancedPlayers(pool, size, mode) {
  if (size <= 0) return [];
  const averageWeight = pool.length
    ? pool.reduce((sum, participant) => sum + resolveWeight(participant), 0) / pool.length
    : WEIGHT_DEFAULT;

  const candidateLimit = Math.min(pool.length, 14);
  const candidates = [...pool]
    .sort((a, b) => candidateScore(a, mode, averageWeight) - candidateScore(b, mode, averageWeight))
    .slice(0, candidateLimit);

  if (size === 1) return candidates.slice(0, 1);

  let best = candidates.slice(0, size);
  let bestScore = Number.POSITIVE_INFINITY;

  function evaluate(group) {
    const counts = group.map(item => item.count);
    const weights = group.map(resolveWeight);
    const countSpread = Math.max(...counts) - Math.min(...counts);
    const groupAverage = weights.reduce((sum, value) => sum + value, 0) / weights.length;
    const weightVariance = weights.reduce((sum, value) => sum + Math.pow(value - groupAverage, 2), 0);
    const averageGap = Math.abs(groupAverage - averageWeight);

    if (mode === "count") return countSpread * 100 + weightVariance + averageGap;
    if (mode === "weight") return weightVariance * 20 + averageGap * 10 + countSpread;
    return countSpread * 30 + weightVariance * 8 + averageGap * 4;
  }

  function combine(start, group) {
    if (group.length === size) {
      const score = evaluate(group);
      if (score < bestScore) {
        bestScore = score;
        best = [...group];
      }
      return;
    }
    for (let index = start; index <= candidates.length - (size - group.length); index += 1) {
      group.push(candidates[index]);
      combine(index + 1, group);
      group.pop();
    }
  }

  combine(0, []);
  return best;
}

function orderForBalancedTeams(group) {
  if (group.length !== 4) return group;
  const sorted = [...group].sort((a, b) => resolveWeight(b) - resolveWeight(a));
  return [sorted[0], sorted[3], sorted[1], sorted[2]];
}

recommendPlacement = function recommendWeightedPlacement() {
  const placedSet = new Set(getPlacedIds());
  let pool = data.participants.filter(participant => !placedSet.has(participant.id));
  if (!pool.length) return flashSaved("배치할 미배치 인원이 없습니다");

  const mode = document.getElementById("matchMode")?.value || getMatchMode();
  const courts = data.courts.map(court => {
    const emptyIndexes = court.playerIds
      .map((id, index) => id ? -1 : index)
      .filter(index => index >= 0);

    if (!emptyIndexes.length || !pool.length) return court;

    const size = Math.min(emptyIndexes.length, pool.length);
    const selected = orderForBalancedTeams(selectBalancedPlayers(pool, size, mode));
    const playerIds = [...court.playerIds];
    emptyIndexes.forEach((slotIndex, index) => {
      if (selected[index]) playerIds[slotIndex] = selected[index].id;
    });

    const usedIds = new Set(selected.map(item => item.id));
    pool = pool.filter(item => !usedIds.has(item.id));
    return { ...court, playerIds };
  });

  activeSlot = null;
  selectedParticipantId = null;
  const modeText = {
    count: "게임횟수 우선",
    balanced: "게임횟수·가중치 균형",
    weight: "가중치 균형 우선",
  }[mode];
  persist({ ...data, courts }, { message: `${modeText} 자동 배치됨` });
};

renderCourts = function renderWeightedCourts() {
  const list = document.getElementById("courtList");
  list.innerHTML = data.courts.map((court, index) => {
    const filled = court.playerIds.filter(Boolean).length;
    const totalWeight = court.playerIds.reduce((sum, id) => sum + (id ? resolveWeight(getParticipant(id)) : 0), 0);
    const slots = court.playerIds.map((participantId, slotIndex) => {
      const participant = getParticipant(participantId);
      const active = activeSlot?.courtId === court.id && activeSlot?.slotIndex === slotIndex;
      return `<button class="slot ${active ? "active" : ""} ${participant ? "" : "empty"}" data-court-id="${court.id}" data-slot-index="${slotIndex}">
        <span class="slot-info"><span class="${participant ? "slot-player" : ""}">${participant ? escapeHtml(participant.name) : "빈 자리"}</span>${participant ? `<span class="slot-meta">가중치 ${resolveWeight(participant)} · 참여 ${participant.count}회</span>` : ""}</span>
        ${participant ? `<span class="slot-remove" data-remove-court-id="${court.id}" data-remove-slot-index="${slotIndex}">✕</span>` : `<span class="slot-meta">드롭</span>`}
      </button>`;
    }).join("");
    return `<div class="card"><div class="court-card-header"><div><div class="section-title small-title">코트 ${index + 1}</div><div class="court-subtitle">복식 · 최대 4명${filled ? ` · 가중치 합 ${totalWeight}` : ""}</div></div><div class="court-actions"><div class="badge">${filled}/4</div><button class="btn success" data-complete-court-id="${court.id}">게임 종료</button><button class="btn" data-delete-court-id="${court.id}">삭제</button></div></div><div class="court-card-body"><div class="court-grid">${slots}</div></div></div>`;
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
};

renderParticipants = function renderWeightedParticipants() {
  const list = document.getElementById("participantList");
  const participants = getSortedParticipants();
  if (!participants.length) {
    list.innerHTML = `<div class="empty-text">${searchKeyword ? "검색 결과가 없습니다." : "참석자 이름을 먼저 입력해 주세요."}</div>`;
    return;
  }

  list.innerHTML = participants.map(participant => `<div class="participant-item">
    <button class="participant-main ${selectedParticipantId === participant.id ? "selected" : ""}" data-participant-id="${participant.id}" draggable="true">
      <span class="participant-meta"><span class="participant-count">참여 ${participant.count}회 · 가중치 ${resolveWeight(participant)}</span><span class="participant-name">${escapeHtml(participant.name)}</span></span><span class="drag-handle" aria-hidden="true">⠿</span>
    </button>
    <div class="weight-control" aria-label="${escapeHtml(participant.name)} 가중치">
      <button class="weight-step" data-weight-decrease-id="${participant.id}" aria-label="가중치 감소">−</button>
      <span class="weight-value" title="가중치">${resolveWeight(participant)}</span>
      <button class="weight-step" data-weight-increase-id="${participant.id}" aria-label="가중치 증가">＋</button>
    </div>
    <button class="btn icon count-btn" data-decrease-id="${participant.id}" aria-label="참여 횟수 감소">−</button>
    <button class="btn icon count-btn" data-increase-id="${participant.id}" aria-label="참여 횟수 증가">＋</button>
    <button class="btn icon" data-remove-id="${participant.id}" aria-label="참석자 삭제">✕</button>
  </div>`).join("");

  list.querySelectorAll("[data-participant-id]").forEach(button => {
    button.addEventListener("click", () => assignParticipant(button.dataset.participantId));
    button.addEventListener("dragstart", event => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/participant-id", button.dataset.participantId);
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      clearDropHighlights();
    });
    button.addEventListener("pointerdown", startPointerDrag);
  });
  list.querySelectorAll("[data-weight-decrease-id]").forEach(button => button.addEventListener("click", () => adjustWeight(button.dataset.weightDecreaseId, -1)));
  list.querySelectorAll("[data-weight-increase-id]").forEach(button => button.addEventListener("click", () => adjustWeight(button.dataset.weightIncreaseId, 1)));
  list.querySelectorAll("[data-decrease-id]").forEach(button => button.addEventListener("click", () => adjustCount(button.dataset.decreaseId, -1)));
  list.querySelectorAll("[data-increase-id]").forEach(button => button.addEventListener("click", () => adjustCount(button.dataset.increaseId, 1)));
  list.querySelectorAll("[data-remove-id]").forEach(button => button.addEventListener("click", () => removeParticipant(button.dataset.removeId)));
};

renderPlacedParticipants = function renderWeightedUnassignedParticipants() {
  const list = document.getElementById("placedParticipantList");
  const count = document.getElementById("unassignedCount");
  if (!list) return;

  const placedIds = new Set(getPlacedIds());
  const unassigned = data.participants
    .map((participant, index) => ({ ...participant, index }))
    .filter(participant => !placedIds.has(participant.id))
    .sort((a, b) => a.count - b.count || a.index - b.index);

  if (count) count.textContent = `(${unassigned.length}명)`;
  if (!unassigned.length) {
    list.innerHTML = '<div class="empty-text">모든 참석자가 현재 코트에 배치되어 있습니다.</div>';
    return;
  }

  list.innerHTML = unassigned.map(participant => `
    <button class="placed-chip waitlist-chip" data-waiting-participant-id="${participant.id}" data-participant-id="${participant.id}" draggable="true" aria-label="${escapeHtml(participant.name)} 코트에 배치">
      <span class="placed-chip-main"><span class="placed-chip-name">${escapeHtml(participant.name)}</span><span class="placed-chip-location">참여 ${participant.count}회 · 가중치 ${resolveWeight(participant)}</span></span>
      <span class="drag-handle" aria-hidden="true">⠿</span>
    </button>`).join("");

  list.querySelectorAll("[data-waiting-participant-id]").forEach(button => {
    const participantId = button.dataset.waitingParticipantId;
    button.addEventListener("click", () => assignParticipant(participantId));
    button.addEventListener("dragstart", event => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/participant-id", participantId);
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      clearDropHighlights();
    });
    button.addEventListener("pointerdown", startPointerDrag);
  });
};

// 기존 A~D 데이터를 숫자 가중치로 즉시 마이그레이션합니다.
data = normalizeState(data);
localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
ensureMatchModeControl();
render();
