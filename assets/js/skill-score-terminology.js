/* 기존 내부 weight 필드는 데이터 호환성을 위해 유지하고, 사용자 표시 용어만 '실력 점수'로 통일합니다. */
(function () {
  const replaceText = value => String(value || "").replaceAll("가중치", "실력 점수");

  function replaceNodeText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const next = replaceText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });

    root.querySelectorAll?.("[title], [aria-label]").forEach(element => {
      ["title", "aria-label"].forEach(attribute => {
        if (!element.hasAttribute(attribute)) return;
        element.setAttribute(attribute, replaceText(element.getAttribute(attribute)));
      });
    });
  }

  const originalFlashSaved = window.flashSaved;
  if (typeof originalFlashSaved === "function") {
    window.flashSaved = function flashSkillScoreMessage(message) {
      return originalFlashSaved(replaceText(message));
    };
  }

  replaceNodeText(document.body);

  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
          const next = replaceText(node.nodeValue);
          if (next !== node.nodeValue) node.nodeValue = next;
          return;
        }
        if (node.nodeType === Node.ELEMENT_NODE) replaceNodeText(node);
      });
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });

  if (typeof window.render === "function") window.render();
})();
