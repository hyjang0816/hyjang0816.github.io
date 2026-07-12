/* 미배치 인원을 참여 횟수가 적은 순으로 표시하는 대기열 */
renderPlacedParticipants = function renderUnassignedParticipants() {
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
    <button class="placed-chip waitlist-chip" data-waiting-participant-id="${participant.id}" draggable="true" aria-label="${escapeHtml(participant.name)} 코트에 배치">
      <span class="placed-chip-main">
        <span class="placed-chip-name">${escapeHtml(participant.name)}</span>
        <span class="placed-chip-location">참여 ${participant.count}회 · 등급 ${participant.level}</span>
      </span>
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
    button.dataset.participantId = participantId;
  });
};

render();
