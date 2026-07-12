/*
 * 자동 배치 우선순위
 * 1. 게임 횟수가 적은 참가자 절대 우선
 * 2. 선택된 참가자 중 비슷한 실력끼리 같은 코트 구성
 * 3. 코트 내부 팀 실력 합 차이 최소화
 *
 * 기존 데이터 필드(weight)는 호환성을 위해 유지하고 화면에서는 '실력'으로 표시합니다.
 */
(function applySkillMatching() {
  function skillOf(participant) {
    return resolveWeight(participant);
  }

  function combinations(items, size) {
    const result = [];
    function pick(start, selected) {
      if (selected.length === size) {
        result.push([...selected]);
        return;
      }
      for (let index = start; index <= items.length - (size - selected.length); index += 1) {
        selected.push(items[index]);
        pick(index + 1, selected);
        selected.pop();
      }
    }
    pick(0, []);
    return result;
  }

  function groupSkillScore(existing, candidates) {
    const group = [...existing, ...candidates];
    if (!group.length) return 0;
    const skills = group.map(skillOf);
    const range = Math.max(...skills) - Math.min(...skills);
    const average = skills.reduce((sum, value) => sum + value, 0) / skills.length;
    const variance = skills.reduce((sum, value) => sum + Math.pow(value - average, 2), 0);
    return range * 1000 + variance;
  }

  function selectClosestSkillGroup(pool, size, existing) {
    if (size <= 0) return [];
    if (pool.length <= size) return [...pool];

    let best = pool.slice(0, size);
    let bestScore = Number.POSITIVE_INFINITY;
    const candidateLimit = Math.min(pool.length, 18);
    const candidates = pool.slice(0, candidateLimit);

    combinations(candidates, size).forEach(group => {
      const score = groupSkillScore(existing, group);
      if (score < bestScore) {
        bestScore = score;
        best = group;
      }
    });
    return best;
  }

  function orderBalancedTeams(group) {
    if (group.length !== 4) {
      return [...group].sort((a, b) => skillOf(b) - skillOf(a));
    }

    const pairings = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ];

    let best = pairings[0];
    let bestGap = Number.POSITIVE_INFINITY;

    pairings.forEach(pairing => {
      const first = pairing[0].reduce((sum, index) => sum + skillOf(group[index]), 0);
      const second = pairing[1].reduce((sum, index) => sum + skillOf(group[index]), 0);
      const gap = Math.abs(first - second);
      if (gap < bestGap) {
        bestGap = gap;
        best = pairing;
      }
    });

    return [
      group[best[0][0]],
      group[best[0][1]],
      group[best[1][0]],
      group[best[1][1]],
    ];
  }

  recommendPlacement = function recommendByCountThenSkill() {
    const placedSet = new Set(getPlacedIds());
    const indexedPool = data.participants
      .map((participant, index) => ({ ...participant, _index: index }))
      .filter(participant => !placedSet.has(participant.id));

    const totalEmptySlots = data.courts.reduce(
      (sum, court) => sum + court.playerIds.filter(id => !id).length,
      0
    );

    if (!totalEmptySlots) return flashSaved("빈 자리가 없습니다");
    if (!indexedPool.length) return flashSaved("배치할 미배치 인원이 없습니다");

    // 게임 횟수는 절대 우선이다. 필요한 인원 수만큼 먼저 확정한 뒤 실력을 고려한다.
    let selectedPool = indexedPool
      .sort((a, b) => a.count - b.count || a._index - b._index)
      .slice(0, totalEmptySlots);

    const courts = data.courts.map(court => {
      const existing = court.playerIds
        .map(id => id ? getParticipant(id) : null)
        .filter(Boolean);
      const emptyCount = court.playerIds.filter(id => !id).length;

      if (!emptyCount || !selectedPool.length) return court;

      const need = Math.min(emptyCount, selectedPool.length);
      const selected = selectClosestSkillGroup(selectedPool, need, existing);
      const selectedIds = new Set(selected.map(item => item.id));
      selectedPool = selectedPool.filter(item => !selectedIds.has(item.id));

      const ordered = orderBalancedTeams([...existing, ...selected]);
      const playerIds = ordered.map(item => item.id);
      while (playerIds.length < 4) playerIds.push("");

      return { ...court, playerIds: playerIds.slice(0, 4) };
    });

    activeSlot = null;
    selectedParticipantId = null;
    persist({ ...data, courts }, {
      message: "게임 횟수 우선 · 비슷한 실력 · 팀 균형 기준 자동 배치됨",
    });
  };

  const originalAdjustWeight = adjustWeight;
  adjustWeight = function adjustSkill(participantId, amount) {
    originalAdjustWeight(participantId, amount);
    flashSaved("실력 변경됨");
  };

  function replaceWeightText(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      node.nodeValue = node.nodeValue
        .replaceAll("가중치 합", "실력 합")
        .replaceAll("가중치", "실력");
    });
  }

  const originalRenderCourts = renderCourts;
  renderCourts = function renderSkillCourts() {
    originalRenderCourts();
    replaceWeightText(document.getElementById("courtList"));
  };

  const originalRenderParticipants = renderParticipants;
  renderParticipants = function renderSkillParticipants() {
    originalRenderParticipants();
    replaceWeightText(document.getElementById("participantList"));
  };

  const originalRenderPlacedParticipants = renderPlacedParticipants;
  renderPlacedParticipants = function renderSkillWaitingList() {
    originalRenderPlacedParticipants();
    replaceWeightText(document.getElementById("placedParticipantList"));
  };

  const modeControl = document.querySelector(".match-mode-control");
  if (modeControl) {
    modeControl.innerHTML = "<span>자동 편성 기준</span><strong>게임 횟수 → 비슷한 실력 → 팀 균형</strong>";
  }

  render();
})();