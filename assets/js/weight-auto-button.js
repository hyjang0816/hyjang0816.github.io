/* 기존 자동 배치 클릭 핸들러를 가중치 기반 로직으로 교체합니다. */
(function bindWeightedAutoPlacement() {
  const current = document.getElementById("recommendPlacementBtn");
  if (!current) return;

  const replacement = current.cloneNode(true);
  current.replaceWith(replacement);
  replacement.addEventListener("click", () => recommendPlacement());
})();
