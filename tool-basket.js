
"use strict";

/* =========================================================
   MINDSPACE PLUS-PLUS
   tool-basket.js

   工作台介面管理

   原則：
   1. 不自行新增第二顆工作台泡泡
   2. 不重複綁定 bubbleWorkbench
   3. 不清空世界或孩子的作品
   4. 不干涉攝影機、錄音或 AI 任務
   5. 保留原有 sidebar 內容
========================================================= */

(function () {

  const basket = {
    initialized: false,
    sidebar: null,
    overlay: null,
    button: null,
    closeButton: null,
    lastFocused: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  /* =======================================================
     01｜取得工作台狀態
  ======================================================= */

  function isOpen() {
    if (
      typeof state !== "undefined" &&
      typeof state.workbenchOpen ===
      "boolean"
    ) {
      return state.workbenchOpen;
    }

    return basket.sidebar
      ?.classList.contains(
        "is-open"
      ) || false;
  }

  /* =======================================================
     02｜建立遮罩

     如果 sketch.js 已建立遮罩，
     直接沿用。
  ======================================================= */

  function ensureOverlay() {
    let overlay =
      byId("toolBasketOverlay");

    if (!overlay) {
      overlay =
        document.createElement(
          "div"
        );

      overlay.id =
        "toolBasketOverlay";

      overlay.className =
        "hidden";

      document.body.appendChild(
        overlay
      );
    }

    basket.overlay =
      overlay;

    return overlay;
  }

  /* =======================================================
     03｜同步視覺狀態

     注意：
     此處不綁定泡泡按鈕的 click。
     sketch.js 第四段已負責切換。
  ======================================================= */

  function syncBasket() {
    const sidebar =
      basket.sidebar;

    const overlay =
      basket.overlay;

    const button =
      basket.button;

    if (!sidebar) {
      return;
    }

    const open =
      isOpen();

    sidebar.classList.toggle(
      "is-open",
      open
    );

    sidebar.classList.toggle(
      "collapsed",
      !open
    );

    if (overlay) {
      overlay.classList.toggle(
        "hidden",
        !open
      );

      overlay.setAttribute(
        "aria-hidden",
        String(!open)
      );
    }

    if (button) {
      button.textContent =
        open ? "✕" : "🧺";

      button.title =
        open
          ? "收起工作台"
          : "打開工作台";

      button.setAttribute(
        "aria-label",
        button.title
      );

      button.setAttribute(
        "aria-expanded",
        String(open)
      );

      button.setAttribute(
        "aria-controls",
        "sidebar"
      );
    }

    sidebar.setAttribute(
      "aria-hidden",
      String(!open)
    );

    /*
      不使用 display:none，
      避免破壞原有工作台布局。
    */
  }

  /* =======================================================
     04｜開啟工作台

     優先使用 sketch.js 的
     setWorkbenchOpen()。
  ======================================================= */

  function openBasket() {
    if (
      typeof setWorkbenchOpen ===
      "function"
    ) {
      setWorkbenchOpen(true);
    } else {
      basket.sidebar
        ?.classList.add(
          "is-open"
        );

      basket.sidebar
        ?.classList.remove(
          "collapsed"
        );
    }

    syncBasket();
  }

  /* =======================================================
     05｜關閉工作台
  ======================================================= */

  function closeBasket() {
    if (
      typeof setWorkbenchOpen ===
      "function"
    ) {
      setWorkbenchOpen(false);
    } else {
      basket.sidebar
        ?.classList.remove(
          "is-open"
        );

      basket.sidebar
        ?.classList.add(
          "collapsed"
        );
    }

    syncBasket();
  }

  /* =======================================================
     06｜切換工作台
  ======================================================= */

  function toggleBasket() {
    if (isOpen()) {
      closeBasket();
    } else {
      openBasket();
    }
  }

  /* =======================================================
     07｜建立工作台關閉按鈕

     這是側欄內的關閉按鈕，
     不是新的懸浮泡泡。
  ======================================================= */

  function ensureCloseButton() {
    const sidebar =
      basket.sidebar;

    if (!sidebar) {
      return;
    }

    let button =
      byId("closeToolBasket");

    if (!button) {
      button =
        document.createElement(
          "button"
        );

      button.id =
        "closeToolBasket";

      button.type =
        "button";

      button.textContent =
        "✕";

      button.title =
        "關閉工作台";

      button.setAttribute(
        "aria-label",
        "關閉工作台"
      );

      button.style.position =
        "absolute";

      button.style.top =
        "12px";

      button.style.right =
        "12px";

      button.style.width =
        "36px";

      button.style.height =
        "36px";

      button.style.border =
        "none";

      button.style.borderRadius =
        "50%";

      button.style.background =
        "rgba(255,255,255,.9)";

      button.style.color =
        "#31445a";

      button.style.cursor =
        "pointer";

      button.style.zIndex =
        "20";

      sidebar.appendChild(
        button
      );
    }

    basket.closeButton =
      button;

    button.addEventListener(
      "click",
      closeBasket
    );
  }

  /* =======================================================
     08｜避免工作台遮住四顆泡泡

     不修改泡泡的位置，
     只確保泡泡可以正常操作。
  ======================================================= */

  function setupBubbleAccessibility() {
    const buttons = [
      [
        "bubbleCamera",
        "拍照建立積木作品"
      ],
      [
        "bubbleMic",
        "開始或停止錄音"
      ],
      [
        "bubbleWorkbench",
        "開啟或關閉工作台"
      ],
      [
        "bubbleFullscreen",
        "切換全螢幕"
      ]
    ];

    for (
      const entry of buttons
    ) {
      const button =
        byId(entry[0]);

      if (!button) {
        continue;
      }

      button.setAttribute(
        "aria-label",
        entry[1]
      );

      button.setAttribute(
        "type",
        "button"
      );

      button.style.touchAction =
        "manipulation";
    }
  }

  /* =======================================================
     09｜同步作品選擇

     當孩子在工作台選擇作品，
     更新目前選擇的積木。

     不重複綁定 selectedHero change：
     sketch.js 第四段已經處理。
  ======================================================= */

  function syncSelectedCreation() {
    const select =
      byId("selectedHero");

    if (
      !select ||
      typeof state === "undefined"
    ) {
      return;
    }

    if (
      state.selectedId &&
      select.value !==
      state.selectedId
    ) {
      const exists =
        Array.from(
          select.options
        ).some(
          option =>
            option.value ===
            state.selectedId
        );

      if (exists) {
        select.value =
          state.selectedId;
      }
    }
  }

  /* =======================================================
     10｜同步角色與環境操作提示

     角色可以使用變身與技能。

     環境主要使用場景延伸。

     這裡只控制提示，
     不擅自改變作品分類。
  ======================================================= */

  function syncCreationControls() {
    if (
      typeof selectedCreation !==
      "function"
    ) {
      return;
    }

    const creation =
      selectedCreation();

    const hint =
      byId("creationModeHint");

    if (!hint) {
      return;
    }

    if (!creation) {
      hint.textContent =
        "先拍照加入你的 Plus-Plus 作品。";

      return;
    }

    if (
      creation.role ===
      "character"
    ) {
      hint.textContent =
        "角色模式：你可以讓積木角色活動、變身，或賦予它新的能力。";
    } else if (
      creation.role ===
      "environment"
    ) {
      hint.textContent =
        "環境模式：AI 會以你的積木作品為基礎延伸場景。";
    } else {
      hint.textContent =
        "AI 正在辨識作品，你也可以自行選擇角色或環境。";
    }
  }

  /* =======================================================
     11｜更新工作台

     可在其他程式完成 AI 任務後呼叫。
  ======================================================= */

  function refreshBasket() {
    syncBasket();

    syncSelectedCreation();

    syncCreationControls();
  }

  /* =======================================================
     12｜初始化

     不綁定以下事件：
     - bubbleWorkbench
     - toolBasketOverlay
     - Escape

     因為 sketch.js 已經綁定，
     重複綁定會造成衝突。
  ======================================================= */

  function initializeBasket() {
    if (basket.initialized) {
      return;
    }

    basket.sidebar =
      byId("sidebar");

    basket.button =
      byId("bubbleWorkbench");

    if (!basket.sidebar) {
      console.warn(
        "[Tool Basket] 找不到 #sidebar"
      );

      return;
    }

    basket.initialized =
      true;

    ensureOverlay();

    ensureCloseButton();

    setupBubbleAccessibility();

    refreshBasket();

    /*
      對外提供更新入口。

      不額外建立輪詢計時器，
      避免增加不必要的效能負擔。
    */

    console.log(
      "🧺 Plus-Plus 工作台已初始化"
    );
  }

  /* =======================================================
     13｜公開 API
  ======================================================= */

  window.plusPlusBasket = {
    open: openBasket,

    close: closeBasket,

    toggle: toggleBasket,

    refresh: refreshBasket,

    isOpen: isOpen
  };

  /* =======================================================
     14｜啟動
  ======================================================= */

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initializeBasket
    );
  } else {
    initializeBasket();
  }

})();
