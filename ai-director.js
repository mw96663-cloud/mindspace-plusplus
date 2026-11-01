
"use strict";

/*
 * =========================================================
 * Mindspace Plus-Plus
 * ai-director.js | Voice Director v1
 *
 * 目的：
 * 1. 讀取目前 p5.js 世界中的角色
 * 2. 透過既有 Bridge 呼叫真實 OpenAI
 * 3. 將 AI 回傳的創作指令整理成統一格式
 * 4. 保留原始角色與現有自主移動
 * 5. 等待 sketch.js 的視覺執行器接手
 *
 * 不負責：
 * - 改寫 Bridge 握手
 * - 修改原始 PNG
 * - 清空世界
 * - 使用假 AI 回覆
 * - 假裝視覺效果已完成
 * =========================================================
 */

(function () {

  const VERSION = "Voice Director v1";

  const director = {
    version: VERSION,
    busy: false,
    queue: [],
    history: [],
    lastResult: null,
    lastError: null,
    selectedId: null,
    maximumHistory: 30,
    maximumOperations: 40
  };

  /*
   * 01｜基本工具
   */

  function asText(value, fallback = "") {
    if (typeof value === "string") {
      return value.trim();
    }

    if (
      value === null ||
      value === undefined
    ) {
      return fallback;
    }

    return String(value).trim();
  }

  function makeId() {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }

    return (
      "mindspace_" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2)
    );
  }

  function emit(name, detail) {
    window.dispatchEvent(
      new CustomEvent(name, {
        detail
      })
    );
  }

  /*
   * 02｜讀取 p5.js 世界
   *
   * 直接使用 sketch.js 已公開的陣列。
   * 不建立另一份互不相通的角色資料。
   */

  function getCreations() {
    return Array.isArray(
      window.mindspaceCreations
    )
      ? window.mindspaceCreations
      : [];
  }

  function getCharacters() {
    return getCreations().filter(
      item => item.kind === "character"
    );
  }

  function getCreationById(id) {
    if (!id) return null;

    return getCreations().find(
      item => item.id === id
    ) || null;
  }

  function getSelectedCreation() {
    const selected = getCreationById(
      director.selectedId
    );

    if (selected) return selected;

    const characters = getCharacters();

    if (characters.length === 1) {
      return characters[0];
    }

    return null;
  }

  /*
   * 03｜角色選擇
   *
   * 目前不修改 sketch.js 的點選與拖曳。
   * 後續可由 index.html 的操作介面
   * 主動呼叫 selectCreation(id)。
   */

  function selectCreation(id) {
    if (!id) {
      director.selectedId = null;
      return null;
    }

    const item = getCreationById(id);

    if (!item) {
      throw new Error(
        "找不到指定的積木作品：" + id
      );
    }

    director.selectedId = item.id;

    emit("mindspace:selection", {
      creationId: item.id,
      name: item.name || item.identity || ""
    });

    return item;
  }

  /*
   * 04｜建立提供給 AI 的世界資訊
   *
   * 只傳送描述性資料，不傳送原始圖片。
   * 原始 PNG 仍留在 p5.js 世界。
   */

  function summarizeCreation(item) {
    return {
      id: item.id,
      kind: item.kind || "unclassified",
      name: item.name || "",
      identity: item.identity || "",
      description: item.description || "",
      personality: item.personality || "",
      movement: item.movement || "float",
      abilities: Array.isArray(item.abilities)
        ? item.abilities.slice(0, 12)
        : [],
      worldType: item.worldType || "",
      x: Number.isFinite(item.x)
        ? Math.round(item.x)
        : null,
      y: Number.isFinite(item.y)
        ? Math.round(item.y)
        : null
    };
  }

  function getWorldContext() {
    const creations = getCreations();

    const worldState =
      typeof window.getMindspaceWorldState ===
      "function"
        ? window.getMindspaceWorldState()
        : null;

    return {
      selectedCreationId:
        getSelectedCreation()?.id || null,

      creations:
        creations
          .slice(0, 50)
          .map(summarizeCreation),

      worlds:
        Array.isArray(worldState?.worlds)
          ? worldState.worlds.slice(0, 30)
          : []
    };
  }

  /*
   * 05｜整理 AI 回傳資料
   *
   * 兼容 operations / actions / timeline。
   * 不自行產生 AI 沒有回傳的操作。
   */

  function normalizeOperations(result) {
    if (!result || typeof result !== "object") {
      return [];
    }

    let operations =
      result.operations ??
      result.actions ??
      result.timeline ??
      [];

    if (typeof operations === "string") {
      try {
        operations = JSON.parse(operations);
      } catch {
        operations = [];
      }
    }

    if (
      !Array.isArray(operations) &&
      operations &&
      typeof operations === "object"
    ) {
      operations = [operations];
    }

    if (!Array.isArray(operations)) {
      return [];
    }

    return operations
      .filter(
        operation =>
          operation &&
          typeof operation === "object" &&
          !Array.isArray(operation)
      )
      .slice(
        0,
        director.maximumOperations
      )
      .map(operation => ({
        ...operation,
        type: asText(
          operation.type || operation.action
        ).toLowerCase()
      }))
      .filter(operation => operation.type);
  }

  function normalizeResult(raw) {
    let result = raw;

    if (typeof result === "string") {
      try {
        result = JSON.parse(result);
      } catch {
        throw new Error(
          "AI 回傳的內容不是有效 JSON"
        );
      }
    }

    if (
      !result ||
      typeof result !== "object"
    ) {
      throw new Error(
        "AI 沒有回傳有效的指令資料"
      );
    }

    if (
      result.result &&
      typeof result.result === "object" &&
      !result.operations &&
      !result.actions
    ) {
      result = result.result;
    }

    return {
      reply: asText(
        result.reply ||
        result.message ||
        result.response
      ),

      operations: normalizeOperations(result),

      raw: result
    };
  }

  /*
   * 06｜真實 AI 呼叫
   *
   * 使用 index.html 已存在的 requestAI。
   * 不自行建立另一套網路請求。
   */

  async function callVoiceAI(text, options = {}) {
    if (typeof requestAI !== "function") {
      throw new Error(
        "找不到 requestAI，請確認網站已載入原本的 index.html 通訊程式"
      );
    }

    const selectedId =
      options.targetId ||
      options.creationId ||
      director.selectedId ||
      getSelectedCreation()?.id ||
      null;

    const payload = {
      text,
      utterance: text,
      message: text,
      instruction: text,
      targetId: selectedId,
      creationId: selectedId,
      world: getWorldContext(),
      context: getWorldContext()
    };

    const raw = await requestAI(
      "interpretVoiceCommandAI",
      payload,
      120000
    );

    return normalizeResult(raw);
  }

  /*
   * 07｜語音指令入口
   *
   * 一次處理一段孩子的語音文字。
   * AI 只負責理解，孩子保有決定權。
   */

  async function interpretSpeech(
    speechText,
    options = {}
  ) {
    const text = asText(speechText);

    if (!text) {
      throw new Error(
        "請先說出想讓角色做什麼"
      );
    }

    if (director.busy) {
      throw new Error(
        "上一段想像指令還在理解中，請稍候"
      );
    }

    director.busy = true;
    director.lastError = null;

    emit("mindspace:ai-start", {
      text
    });

    try {
      const result = await callVoiceAI(
        text,
        options
      );

      const entry = {
        id: makeId(),
        text,
        reply: result.reply,
        operations: result.operations,
        targetId:
          options.targetId ||
          director.selectedId ||
          getSelectedCreation()?.id ||
          null,
        createdAt: Date.now(),
        executionStatus: "pending"
      };

      director.lastResult = entry;

      director.history.push(entry);

      if (
        director.history.length >
        director.maximumHistory
      ) {
        director.history.shift();
      }

      /*
       * 將真實 AI 指令交給後續視覺執行器。
       *
       * 此階段不直接改動 p5.js 角色。
       * 因為 sketch.js 尚未加入對應的
       * 翅膀、雷射、變身等繪製功能。
       */

      if (entry.operations.length > 0) {
        director.queue.push(entry);

        emit("mindspace:ai-operations", {
          entry,
          operations: entry.operations,
          targetId: entry.targetId
        });
      }

      emit("mindspace:ai-complete", {
        entry
      });

      return entry;

    } catch (error) {
      director.lastError =
        error?.message || String(error);

      emit("mindspace:ai-error", {
        text,
        error: director.lastError
      });

      throw error;

    } finally {
      director.busy = false;
    }
  }

  /*
   * 08｜待執行指令管理
   *
   * 未實際繪製前，不能標記 completed。
   */

  function getPendingOperations() {
    return director.queue.map(entry => ({
      id: entry.id,
      text: entry.text,
      targetId: entry.targetId,
      operations: entry.operations,
      status: entry.executionStatus
    }));
  }

  function markExecuted(entryId) {
    const index = director.queue.findIndex(
      entry => entry.id === entryId
    );

    if (index < 0) return false;

    const entry = director.queue[index];

    entry.executionStatus = "completed";

    director.queue.splice(index, 1);

    emit("mindspace:visual-complete", {
      entryId
    });

    return true;
  }

  function markFailed(entryId, reason) {
    const entry = director.queue.find(
      item => item.id === entryId
    );

    if (!entry) return false;

    entry.executionStatus = "failed";
    entry.executionError = asText(reason);

    return true;
  }

  /*
   * 09｜公開介面
   *
   * 給後續 index.html 與 sketch.js 使用。
   */

  window.MindspaceAIDirector = {
    version: VERSION,

    get busy() {
      return director.busy;
    },

    get lastResult() {
      return director.lastResult;
    },

    get lastError() {
      return director.lastError;
    },

    get history() {
      return director.history.slice();
    },

    get selectedId() {
      return director.selectedId;
    },

    getCreations,
    getCharacters,
    getCreationById,
    getSelectedCreation,
    selectCreation,
    getWorldContext,
    normalizeOperations,
    interpretSpeech,
    getPendingOperations,
    markExecuted,
    markFailed
  };

  console.info(
    "[Mindspace]",
    VERSION,
    "已載入；等待網站整合語音介面。"
  );

})();
