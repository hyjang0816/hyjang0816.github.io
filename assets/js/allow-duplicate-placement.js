// 수동 배치에서는 같은 참가자를 여러 코트/슬롯에 중복 배치할 수 있습니다.
// 자동 배치는 기존 공정 배치 규칙대로 한 번씩만 배치합니다.

function placeParticipant(participantId, courtId, slotIndex) {
  if (!getParticipant(participantId)) return;

  const courts = data.courts.map(court => {
    if (court.id !== courtId) return court;
    const playerIds = [...court.playerIds];
    playerIds[slotIndex] = participantId;
    return { ...court, playerIds };
  });

  activeSlot = { courtId, slotIndex };
  selectedParticipantId = participantId;
  persist({ ...data, courts }, { message: "참석자 배치됨 · 중복 배치 가능" });
}

// 전체 게임 종료 시 참가자가 배치된 코트 수만큼 참여 횟수를 반영합니다.
// 같은 코트 안에 실수로 중복 배치된 경우에는 해당 게임을 1회로 계산합니다.
function completeCurrentGame() {
  const occupiedCourts = data.courts.filter(court => court.playerIds.some(Boolean));
  if (!occupiedCourts.length) return flashSaved("배치된 인원이 없습니다");

  const totalGames = occupiedCourts.length;
  if (!window.confirm(`현재 배치된 ${totalGames}개 게임의 참여 횟수를 반영하고 모든 코트를 비울까요?`)) return;

  const participationById = new Map();
  occupiedCourts.forEach(court => {
    new Set(court.playerIds.filter(Boolean)).forEach(participantId => {
      participationById.set(participantId, (participationById.get(participantId) || 0) + 1);
    });
  });

  activeSlot = null;
  selectedParticipantId = null;
  persist({
    ...data,
    participants: data.participants.map(participant => ({
      ...participant,
      count: participant.count + (participationById.get(participant.id) || 0),
    })),
    courts: data.courts.map(court => ({ ...court, playerIds: ["", "", "", ""] })),
  }, { message: `${totalGames}개 게임 참여 횟수 반영됨` });
}
