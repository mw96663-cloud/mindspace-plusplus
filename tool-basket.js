
"use strict";

/*
 * Mindspace Plus-Plus
 * tool-basket.js
 *
 * 與 2026/11/01 index.html 相容
 *
 * 1. 沿用現有工作台，不建立第二個工作台
 * 2. 沿用原有的開啟與關閉按鈕
 * 3. 不重複綁定已由 index.html 管理的 click
 * 4. 不干涉 OpenAI、拍照、錄音或 p5.js
 * 5. 不清空孩子已建立的作品
 */

(function () {
  const basket = {
    initialized: false,
    sidebar: null,
    button: null,
    closeButton: null,
    lastFocused: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function isOpen() {
    return Boolean(
      basket.sidebar &&
      basket.sidebar.classList.contains("open")
    );
  }

  function syncBasket() {
    if (!basket.sidebar) return;

    const open = isOpen();

    basket.sidebar.setAttribute(
      "aria-hidden",
      String(!open)
    );

    if (basket.button) {
      basket.button.setAttribute(
        "aria-expanded",
        String(open)
      );

      basket.button.setAttribute(
        "aria-controls",
        "sidebar"
      );

      basket.button.setAttribute(
        "aria-label",
        open ? "工作台已開啟" : "開啟工作台"
      );
    }
  }

  function openBasket() {
    if (!basket.sidebar) return;

    basket.lastFocused = document.activeElement;

    basket.sidebar.classList.add("open");
    syncBasket();
  }

  function closeBasket() {
    if (!basket.sidebar) return;

    basket.sidebar.classList.remove("open");
    syncBasket();

    if (
      basket.lastFocused &&
      typeof basket.lastFocused.focus === "function"
    ) {
      basket.lastFocused.focus();
    }
  }

  function toggleBasket() {
    if (isOpen()) {
      closeBasket();
    } else {
      openBasket();
    }
  }

  function setupAccessibility() {
    const controls = [
      ["bubbleCamera", "拍照建立積木作品"],
      ["bubbleMic", "開始或停止錄音"],
      ["bubbleWorkbench", "開啟工作台"],
      ["closeWorkbench", "關閉工作台"]
    ];

    for (const [id, label] of controls) {
      const button = byId(id);
      if (!button) continue;

      button.type = "button";
      button.setAttribute("aria-label", label);
      button.style.touchAction = "manipulation";
    }
  }

  function syncSelectedCreation() {
    const select = byId("selectedHero");

    if (!select) return;

    const world =
      window.mindspaceCreations || [];

    if (!Array.isArray(world)) return;

    const selectedId =
      window.mindspaceSelectedId ||
      (
        typeof state !== "undefined"
          ? state.selectedId
          : null
      );

    if (!selectedId) return;

    const exists = Array.from(
      select.options
    ).some(option => option.value === selectedId);

    if (exists && select.value !== selectedId) {
      select.value = selectedId;
    }
  }

  function syncCreationControls() {
    const hint = byId("creationModeHint");

    if (!hint) return;

    const world =
      window.mindspaceCreations || [];

    const selectedId =
      window.mindspaceSelectedId ||
      (
        typeof state !== "undefined"
          ? state.selectedId
          : null
      );

    const creation = Array.isArray(world)
      ? world.find(item => item.id === selectedId)
      : null;

    if (!creation) {
      hint.textContent =
        "先拍照加入你的 Plus-Plus 作品。";
      return;
    }

    if (creation.role === "character") {
      hint.textContent =
        "角色模式：可以讓積木角色活動、變身或獲得新能力。";
    } else if (creation.role === "environment") {
      hint.textContent =
        "環境模式：可以以原始積木為基礎延伸場景。";
    } else {
      hint.textContent =
        "你可以決定作品是角色還是環境。";
    }
  }

  function refreshBasket() {
    syncBasket();
    syncSelectedCreation();
    syncCreationControls();
  }

  function initializeBasket() {
    if (basket.initialized) return;

    basket.sidebar = byId("sidebar");
    basket.button = byId("bubbleWorkbench");
    basket.closeButton = byId("closeWorkbench");

    if (!basket.sidebar) {
      console.warn(
        "[Mindspace Basket] 找不到 #sidebar"
      );
      return;
    }

    basket.initialized = true;

    setupAccessibility();
    refreshBasket();

    /*
     * index.html 已經綁定工作台按鈕事件。
     * 這裡不再次註冊 click，避免一次點擊切換兩次。
     */

    console.log(
      "[Mindspace Basket] 工作台已初始化"
    );
  }

  window.plusPlusBasket = {
    open: openBasket,
    close: closeBasket,
    toggle: toggleBasket,
    refresh: refreshBasket,
    isOpen: isOpen
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeBasket,
      { once: true }
    );
  } else {
    initializeBasket();
  }
})();
