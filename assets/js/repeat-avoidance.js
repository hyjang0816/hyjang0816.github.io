/* 최근 같은 파트너·상대 반복을 자동 편성의 후순위 기준으로 회피합니다. */
(function applyRepeatAvoidance() {
  const MATCH_HISTORY_KEY = "badminton-ops-match-history-v1";
  const MATCH_HISTORY_LIMIT = 12;

  function loadMatchHistory() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MATCH_HISTORY_KEY) || "[]");
      return Array.isArray(parsed) ? parsed.slice(-MATCH_HISTORY_LIMIT) : [];
    } catch (error) {
      console.warn("경기 조합 기록 불러오기 실패", error);
      return [];
    }
  }

  function saveMatchHistory(history) {
    localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(history.slice(-MATCH_HISTORY_LIMIT)));
  }

  function pairKey(firstId, secondId) {
    return [firstId, secondId].sort().join("|");
  }

  function buildRepeatMaps() {
    const partner = new Map();
    const opponent = new Map();
    const history = loadMatchHistory();

    history.forEach((game, index) => {
      const recency = index + 1;
      const teamA = Array.isArray(game.teamA) ? game.teamA : [];
      const teamB = Array.isArray(game.teamB) ? game.teamB : [];

      [teamA, teamB].forEach(team => {
        for (let i = 0; i < team.length; i += 1) {
          for (let j = i + 1; j < team.length; j += 1) {
            const key = pairKey(team[i], team[j]);
            partner.set(key, (partner.get(key) || 0) + recency);
          }
        }
      });

      teamA.forEach(firstId => {
        teamB.forEach(secondId => {
          const key = pairKey(firstId, secondId);
          opponent.set(key, (opponent.get(key) || 0) + recency);
        });
      });
    });

    return { partner, opponent };
  }

  function repeatCostForCourt(players, maps) {
    let cost = 0;
    for (let i = 0; i < players.length; i += 1) {
      for (let j = i + 1; j < players.length; j += 1) {
        const key = pairKey(players[i].id, players[j].id);
        cost += (maps.partner.get(key) || 0) * 2;
        cost += maps.opponent.get(key) || 0;
      }
    }
    return cost;
  }

  function teamRepeatCost(teamA, teamB, maps) {
    let partnerCost = 0;
    let opponentCost = 0;

    [teamA, teamB].forEach(team => {
      if (team.length === 2) {
        partnerCost += maps.partner.get(pairKey(team[0].id, team[1].id)) || 0;
      }
    });

    teamA.forEach(first => {
      teamB.forEach(second => {
        opponentCost += maps.opponent.get(pairKey(first.id, second.id)) || 0;
      });
    });

    return partnerCost * 3 + opponentCost;
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

  function skillOf(participant) {
    return resolveWeight(participant);
  }

  function groupSkillScore(group) {
    if (!group.length) return 0;
    const skills = group.map(skillOf);
    const range = Math.max(...skills) - Math.min(...skills);
    const average = skills.reduce((sum, value) => sum + value, 0) / skills.length;
    const variance = skills.reduce((sum, value) => sum + Math.pow(value - average, 2), 0);
    return range * 100000 + variance * 1000;
  }

  function selectCourtGroup(pool, size, existing, maps) {
    if (size <= 0) return [];
    if (pool.length <= size) return [...pool];

    const candidates = pool.slice(0, Math.min(pool.length, 18));
    let best = candidates.slice(0, size);
    let bestScore = Number.POSITIVE_INFINITY;

    combinations(candidates, size).forEach(selected => {
      const fullGroup = [...existing, ...selected];
      const score = groupSkillScore(fullGroup) + repeatCostForCourt(fullGroup, maps);
      if (score < bestScore) {
        bestScore = score;
        best = selected;
      }
    });

    return best;
  }

  function orderTeams(group, maps) {
    if (group.length !== 4) return [...group].sort((a, b) => skillOf(b) - skillOf(a));

    const pairings = [
      [[0, 1], [2, 3]],
      [[0, 2], [1, 3]],
      [[0, 3], [1, 2]],
    ];

    let best = pairings[0];
    let bestScore = Number.POSITIVE_INFINITY;

    pairings.forEach(pairing => {
      const teamA = pairing[0].map(index => group[index]);
      const teamB = pairing[1].map(index => group[index]);
      const firstSkill = teamA.reduce((sum, participant) => sum + skillOf(participant), 0);
      const secondSkill = teamB.reduce((sum, participant) => sum + skillOf(participant), 0);
      const teamGap = Math.abs(firstSkill - secondSkill);
      const score = teamGap * 100000 + teamRepeatCost(teamA, teamB, maps);

      if (score < bestScore) {
        bestScore = score;
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

  function recordCourts(courts) {
    const games = courts
      .map(court => {
        const ids = court.playerIds.filter(Boolean);
        if (ids.length < 2) return null;
        return {
          teamA: [...new Set(ids.slice(0, 2))],
          teamB: [...new Set(ids.slice(2, 4))],
          completedAt: Date.now(),
        };
      })
      .filter(Boolean);

    if (!games.length) return;
    saveMatchHistory([...loadMatchHistory(), ...games]);
  }

  recommendPlacement = function recommendWithRepeatAvoidance() {
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

    // 게임 횟수는 모든 다른 조건보다 절대 우선한다.
    let selectedPool = indexedPool
      .sort((a, b) => a.count - b.count || a._index - b._index)
      .slice(0, totalEmptySlots);

    const repeatMaps = buildRepeatMaps();
    const courts = data.courts.map(court => {
      const existing = court.playerIds
        .map(id => id ? getParticipant(id) : null)
        .filter(Boolean);
      const emptyCount = court.playerIds.filter(id => !id).length;
      if (!emptyCount || !selectedPool.length) return court;

      const need = Math.min(emptyCount, selectedPool.length);
      const selected = selectCourtGroup(selectedPool, need, existing, repeatMaps);
      const selectedIds = new Set(selected.map(item => item.id));
      selectedPool = selectedPool.filter(item => !selectedIds.has(item.id));

      const ordered = orderTeams([...existing, ...selected], repeatMaps);
      const playerIds = ordered.map(item => item.id);
      while (playerIds.length < 4) playerIds.push("");
      return { ...court, playerIds: playerIds.slice(0, 4) };
    });

    activeSlot = null;
    selectedParticipantId = null;
    persist({ ...data, courts }, {
      message: "게임 횟수 · 실력 · 팀 균형 · 최근 조합 기준 자동 배치됨",
    });
  };

  completeCurrentGame = function completeCurrentGameWithHistory() {
    const occupiedCourts = data.courts.filter(court => court.playerIds.some(Boolean));
    if (!occupiedCourts.length) return flashSaved("배치된 인원이 없습니다");
    if (!window.confirm(`현재 배치된 ${occupiedCourts.length}개 게임의 참여 횟수를 반영하고 모든 코트를 비울까요?`)) return;

    recordCourts(occupiedCourts);
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
    }, { message: `${occupiedCourts.length}개 게임 반영 · 조합 기록 저장됨` });
  };

  completeCourtGame = function completeCourtGameWithHistory(courtId) {
    const court = data.courts.find(item => item.id === courtId);
    const ids = court?.playerIds.filter(Boolean) || [];
    if (!ids.length) return flashSaved("이 코트에 배치된 인원이 없습니다");
    if (!window.confirm(`${ids.length}명의 참여 횟수를 반영하고 이 코트를 비울까요?`)) return;

    recordCourts([court]);
    const uniqueIds = new Set(ids);
    if (activeSlot?.courtId === courtId) activeSlot = null;
    selectedParticipantId = null;
    persist({
      ...data,
      participants: data.participants.map(participant => uniqueIds.has(participant.id)
        ? { ...participant, count: participant.count + 1 }
        : participant),
      courts: data.courts.map(item => item.id === courtId
        ? { ...item, playerIds: ["", "", "", ""] }
        : item),
    }, { message: `${uniqueIds.size}명 반영 · 조합 기록 저장됨` });
  };

  const modeControl = document.querySelector(".match-mode-control");
  if (modeControl) {
    modeControl.innerHTML = "<span>자동 편성 기준</span><strong>게임 횟수 → 비슷한 실력 → 팀 균형 → 최근 조합 회피</strong>";
  }

  const current = document.getElementById("recommendPlacementBtn");
  if (current) {
    const replacement = current.cloneNode(true);
    current.replaceWith(replacement);
    replacement.addEventListener("click", () => recommendPlacement());
  }

  const completeAll = document.getElementById("completeGameBtn");
  if (completeAll) {
    const replacement = completeAll.cloneNode(true);
    completeAll.replaceWith(replacement);
    replacement.addEventListener("click", () => completeCurrentGame());
  }

  const completeMobile = document.getElementById("mobileCompleteGameBtn");
  if (completeMobile) {
    const replacement = completeMobile.cloneNode(true);
    completeMobile.replaceWith(replacement);
    replacement.addEventListener("click", () => completeCurrentGame());
  }

  render();
})();