/* 태블릿·모바일: 드래그 핸들을 길게 눌러야 드래그 시작 */
const TOUCH_DRAG_HOLD_MS = 350;
const TOUCH_DRAG_CANCEL_DISTANCE = 10;
let touchDragTimer = null;
let suppressNextParticipantClick = false;

function clearTouchDragTimer() {
  if (touchDragTimer) {
    clearTimeout(touchDragTimer);
    touchDragTimer = null;
  }
}

function cleanupTouchDragListeners(source) {
  source?.removeEventListener("pointermove", handleTouchDragMove);
  source?.removeEventListener("pointerup", handleTouchDragEnd);
  source?.removeEventListener("pointercancel", handleTouchDragEnd);
}

startPointerDrag = function startLongPressPointerDrag(event) {
  if (event.pointerType === "mouse") return;

  const handle = event.target.closest(".drag-handle");
  if (!handle) return;

  const source = event.currentTarget;
  clearTouchDragTimer();

  pointerDrag = {
    pointerId: event.pointerId,
    participantId: source.dataset.participantId,
    source,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    armed: false,
    active: false,
  };

  source.addEventListener("pointermove", handleTouchDragMove);
  source.addEventListener("pointerup", handleTouchDragEnd);
  source.addEventListener("pointercancel", handleTouchDragEnd);

  touchDragTimer = setTimeout(() => {
    if (!pointerDrag || pointerDrag.pointerId !== event.pointerId) return;

    pointerDrag.armed = true;
    pointerDrag.active = true;
    source.setPointerCapture?.(event.pointerId);
    source.classList.add("dragging");

    const participant = getParticipant(pointerDrag.participantId);
    const ghost = document.getElementById("dragGhost");
    ghost.textContent = participant?.name || "참석자";
    ghost.classList.add("visible");
    moveGhost(pointerDrag.lastX, pointerDrag.lastY);

    if (navigator.vibrate) navigator.vibrate(20);
  }, TOUCH_DRAG_HOLD_MS);
};

function handleTouchDragMove(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;

  pointerDrag.lastX = event.clientX;
  pointerDrag.lastY = event.clientY;

  const distance = Math.hypot(
    event.clientX - pointerDrag.startX,
    event.clientY - pointerDrag.startY
  );

  if (!pointerDrag.armed) {
    if (distance > TOUCH_DRAG_CANCEL_DISTANCE) {
      clearTouchDragTimer();
      cleanupTouchDragListeners(pointerDrag.source);
      pointerDrag = null;
    }
    return;
  }

  event.preventDefault();
  moveGhost(event.clientX, event.clientY);
  autoScrollDuringDrag(event.clientY);
  highlightDropTarget(event.clientX, event.clientY);
}

function handleTouchDragEnd(event) {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return;

  const { source, participantId, active } = pointerDrag;
  clearTouchDragTimer();
  cleanupTouchDragListeners(source);

  if (active) {
    source.releasePointerCapture?.(event.pointerId);
    source.classList.remove("dragging");
    document.getElementById("dragGhost")?.classList.remove("visible");

    const target = getSlotAtPoint(event.clientX, event.clientY);
    clearDropHighlights();
    suppressNextParticipantClick = true;
    setTimeout(() => { suppressNextParticipantClick = false; }, 300);

    pointerDrag = null;
    if (target) {
      placeParticipant(participantId, target.dataset.courtId, Number(target.dataset.slotIndex));
    }
    return;
  }

  pointerDrag = null;
}

document.addEventListener("click", event => {
  if (!suppressNextParticipantClick) return;
  if (event.target.closest("[data-participant-id], [data-waiting-participant-id]")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressNextParticipantClick = false;
  }
}, true);

render();
