
"use strict";

/*
============================================================
Mindspace Plus-Plus
sketch.js

主要功能：
1. 泡泡工作台展開 / 收合
2. 全螢幕（保留攝影機與語音操作）
3. 攝影機拍照 / 上傳照片
4. AI 自動去背 / 手動擦除 / 復原
5. AI 自動判斷 Character 或 Environment
6. 角色模式：原始積木角色 + 滿版 AI 世界 + 自主活動
7. 場景模式：原始積木融合 + 滿版 AI 世界 + 3 秒特效
8. 角色列表 / 新增創作 / 清空世界
9. 與 ai-director.js 共用的世界操作介面
10. Google Apps Script Bridge 通訊

注意：
請將 GAS_URL 改成新版 Apps Script 網頁應用程式
部署後取得的 /exec 網址。

API Key 不要放在這個檔案。
============================================================
*/

const MINDSPACE_CONFIG = {
  GAS_URL: "",

  APP_ID: "mindspace-plusplus-v1",

  BRIDGE_TIMEOUT: 30000,

  IMAGE_TIMEOUT: 180000,

  WORLD_TIMEOUT: 180000,

  MAX_IMAGE_SIDE: 1280,

  JPEG_QUALITY: 0.88,

  ENVIRONMENT_INTRO_MS: 3000,

  DEFAULT_WORLD_COLOR: "#123b58"
};

/* =========================================================
   基本工具
========================================================= */

const $ = (id) => document.getElementById(id);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function uid(prefix = "id") {
  if (window.crypto && crypto.randomUUID) {
    return prefix + "-" + crypto.randomUUID();
  }

  return prefix + "-" +
    Date.now().toString(36) + "-" +
    Math.random().toString(36).slice(2);
}

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : fallback;
}

function setStatus(id, message) {
  const el = $(id);

  if (el) {
    el.textContent = String(message || "");
  }
}

function showElement(id) {
  const el = $(id);
  if (el) el.classList.remove("hidden");
}

function hideElement(id) {
  const el = $(id);
  if (el) el.classList.add("hidden");
}

function setBusy(buttonId, busy, busyText) {
  const button = $(buttonId);

  if (!button) return;

  if (busy) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent;
    }

    button.disabled = true;

    if (busyText) {
      button.textContent = busyText;
    }
  } else {
    button.disabled = false;

    if (button.dataset.originalText) {
      button.textContent = button.dataset.originalText;
    }
  }
}

function showProgress(message) {
  setStatus(
    "creationProgressText",
    message || "正在創造 Plus-Plus 世界……"
  );

  showElement("creationProgress");
}

function hideProgress() {
  hideElement("creationProgress");
}

function updateSpeechBubble(message) {
  setStatus("speechBubble", message);
}

function reportError(error, target = "aiSystemStatus") {
  const message = error instanceof Error
    ? error.message
    : String(error);

  console.error("[Mindspace]", error);

  setStatus(target, "❌ " + message);

  return message;
}

function normalizeAIResult(result) {
  if (result && result.ok === false) {
    throw new Error(
      result.error ||
      result.message ||
      "AI 後端回傳失敗"
    );
  }

  if (result && result.ok === true &&
      Object.prototype.hasOwnProperty.call(result, "result")) {
    return result.result;
  }

  return result;
}

function extractImage(result) {
  const data = normalizeAIResult(result);

  if (typeof data === "string") {
    return data;
  }

  if (!data || typeof data !== "object") {
    throw new Error("AI 沒有回傳圖片");
  }

  const image =
    data.image ||
    data.imageData ||
    data.imageUrl ||
    data.dataUrl ||
    data.url ||
    data.background;

  if (typeof image !== "string" || !image) {
    throw new Error("AI 回傳內容沒有圖片資料");
  }

  if (image.startsWith("data:image/")) {
    return image;
  }

  if (/^https?:\/\//i.test(image)) {
    return image;
  }

  // 後端也可以直接回傳 PNG base64。
  return "data:image/png;base64," + image;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => resolve(img);

    img.onerror = () => {
      reject(new Error("圖片載入失敗"));
    };

    img.src = src;
  });
}

function canvasToDataURL(canvas, type = "image/png") {
  return canvas.toDataURL(type);
}

function fitImageToCanvas(
  image,
  maxSide = MINDSPACE_CONFIG.MAX_IMAGE_SIDE
) {
  const scale = Math.min(
    1,
    maxSide / Math.max(image.width, image.height)
  );

  const width = Math.max(
    1,
    Math.round(image.width * scale)
  );

  const height = Math.max(
    1,
    Math.round(image.height * scale)
  );

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  ctx.drawImage(image, 0, 0, width, height);

  return canvas;
}

/* =========================================================
   全域狀態
========================================================= */

const state = {
  initialized: false,

  sidebarOpen: false,

  cameraStream: null,

  cameraFacing: "environment",

  originalPhoto: null,

  cutoutPhoto: null,

  cutoutHistory: [],

  manualEraseEnabled: false,

  manualEraseActive: false,

  manualEraseRadius: 18,

  currentAnalysis: null,

  currentMode: null,

  currentWorld: null,

  heroes: [],

  activeHeroId: null,

  worldObjects: [],

  effects: [],

  introEffectTimer: null,

  lastFrameTime: 0,

  animationFrame: null,

  isGenerating: false,

  bridge: {
    iframe: null,
    ready: false,
    token: uid("bridge"),
    requests: new Map(),
    nextId: 1,
    origin: null,
    source: null
  }
};

window.MindspaceState = state;
window.MindspaceConfig = MINDSPACE_CONFIG;

/* =========================================================
   泡泡工作台
========================================================= */

function setWorkbenchOpen(open) {
  state.sidebarOpen = Boolean(open);

  const sidebar = $("sidebar");
  const bubble = $("mobileToggle");

  if (sidebar) {
    sidebar.classList.toggle("open", state.sidebarOpen);
    sidebar.setAttribute(
      "aria-hidden",
      String(!state.sidebarOpen)
    );
  }

  if (bubble) {
    bubble.setAttribute(
      "aria-expanded",
      String(state.sidebarOpen)
    );

    bubble.setAttribute(
      "aria-label",
      state.sidebarOpen
        ? "收合創作工作台"
        : "開啟創作工作台"
    );

    bubble.textContent = state.sidebarOpen
      ? "✕"
      : "✦";
  }
}

function toggleWorkbench() {
  setWorkbenchOpen(!state.sidebarOpen);
}

/* =========================================================
   全螢幕
========================================================= */

async function toggleFullscreen() {
  const app = $("app");

  if (!app) return;

  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (app.requestFullscreen) {
      await app.requestFullscreen();
    } else if (app.webkitRequestFullscreen) {
      await app.webkitRequestFullscreen();
    } else {
      throw new Error(
        "此瀏覽器不支援此頁面的全螢幕模式"
      );
    }
  } catch (error) {
    reportError(error, "cameraStatus");
  }
}

function updateFullscreenButton() {
  const button = $("fullscreenButton");

  if (!button) return;

  button.textContent = document.fullscreenElement
    ? "⤢"
    : "⛶";

  button.title = document.fullscreenElement
    ? "離開全螢幕"
    : "進入全螢幕";
}

/* =========================================================
   Google Apps Script Bridge

   前端不保存 API Key。

   GAS 網頁應用程式需提供：
   - doGet() -> Bridge.html
   - bridgeRequest({type,data})

   Bridge.html 需使用 postMessage 與此檔通訊。
========================================================= */

function isValidGASUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?.*)?$/.test(
    String(url || "")
  );
}

function initializeBridge() {
  const url = MINDSPACE_CONFIG.GAS_URL;

  if (!isValidGASUrl(url)) {
    setStatus(
      "aiSystemStatus",
      "⚠️ 尚未設定新版 GAS_URL。\n" +
      "請先部署 Code.gs 與 Bridge.html，" +
      "再將 /exec 網址填入 sketch.js。"
    );

    return;
  }

  const container = $("bridgeContainer");

  if (!container) {
    reportError(
      new Error("找不到 bridgeContainer")
    );
    return;
  }

  const iframe = document.createElement("iframe");

  iframe.title = "Mindspace AI Bridge";

  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.border = "0";

  const bridgeUrl = new URL(url);

  bridgeUrl.searchParams.set(
    "bridgeToken",
    state.bridge.token
  );

  bridgeUrl.searchParams.set(
    "parentOrigin",
    window.location.origin
  );

  iframe.src = bridgeUrl.toString();

  state.bridge.iframe = iframe;

  container.appendChild(iframe);

  setStatus(
    "aiSystemStatus",
    "正在連接 Mindspace AI 後端……"
  );
}

function isAllowedBridgeOrigin(origin) {
  try {
    const host = new URL(origin).hostname;

    return (
      host === "script.google.com" ||
      host === "script.googleusercontent.com" ||
      host.endsWith(".googleusercontent.com")
    );
  } catch {
    return false;
  }
}

function handleBridgeMessage(event) {
  if (!isAllowedBridgeOrigin(event.origin)) {
    return;
  }

  const data = event.data;

  if (!data || typeof data !== "object") {
    return;
  }

  if (data.app !== MINDSPACE_CONFIG.APP_ID) {
    return;
  }

  if (data.token !== state.bridge.token) {
    return;
  }

  if (data.kind === "ready") {
    state.bridge.ready = true;
    state.bridge.origin = event.origin;
    state.bridge.source = event.source;

    event.source.postMessage(
      {
        app: MINDSPACE_CONFIG.APP_ID,
        token: state.bridge.token,
        kind: "ack"
      },
      event.origin
    );

    setStatus(
      "aiSystemStatus",
      "✅ Google Apps Script Bridge 已連線。\n" +
      "尚需測試 OpenAI API。"
    );

    return;
  }

  if (data.kind !== "response") {
    return;
  }

  const pending = state.bridge.requests.get(data.id);

  if (!pending) return;

  clearTimeout(pending.timeout);

  state.bridge.requests.delete(data.id);

  if (data.ok === false) {
    pending.reject(
      new Error(
        data.error ||
        "AI 請求失敗"
      )
    );
  } else {
    pending.resolve(
      normalizeAIResult(data.result)
    );
  }
}

function callAI(
  type,
  data = {},
  timeoutMs = MINDSPACE_CONFIG.BRIDGE_TIMEOUT
) {
  return new Promise((resolve, reject) => {
    if (!state.bridge.ready ||
        !state.bridge.source ||
        !state.bridge.origin) {
      reject(
        new Error(
          "AI Bridge 尚未連線。請確認新版 GAS_URL、部署權限及 Bridge.html。"
        )
      );
      return;
    }

    const id = state.bridge.nextId++;

    const timeout = setTimeout(() => {
      state.bridge.requests.delete(id);

      reject(
        new Error(
          "AI 請求逾時：" + type +
          "。請檢查 Apps Script 執行紀錄。"
        )
      );
    }, timeoutMs);

    state.bridge.requests.set(id, {
      resolve,
      reject,
      timeout
    });

    try {
      state.bridge.source.postMessage(
        {
          app: MINDSPACE_CONFIG.APP_ID,
          token: state.bridge.token,
          kind: "request",
          id,
          type,
          data
        },
        state.bridge.origin
      );
    } catch (error) {
      clearTimeout(timeout);
      state.bridge.requests.delete(id);
      reject(error);
    }
  });
}

window.MindspaceCallAI = callAI;

async function testAIConnection() {
  setBusy(
    "testAIButton",
    true,
    "正在測試……"
  );

  try {
    setStatus(
      "aiSystemStatus",
      "① 測試 GAS Bridge……"
    );

    const ping = await callAI(
      "ping",
      {},
      15000
    );

    setStatus(
      "aiSystemStatus",
      "① GAS Bridge：成功\n" +
      "② 正在驗證 OpenAI API……"
    );

    const verify = await callAI(
      "verifyOpenAI",
      {},
      30000
    );

    if (verify && verify.ok === false) {
      throw new Error(
        verify.error || "OpenAI 驗證失敗"
      );
    }

    setStatus(
      "aiSystemStatus",
      "✅ GAS Bridge 已連線\n" +
      "✅ OpenAI API 已通過驗證\n" +
      "後端版本：" +
      safeText(
        ping && ping.version,
        "未提供"
      ) +
      "\n注意：去背、圖片生成及語音仍需各自實際測試。"
    );
  } catch (error) {
    reportError(error);
  } finally {
    setBusy("testAIButton", false);
  }
}

/* =========================================================
   攝影機
========================================================= */

async function startCamera() {
  try {
    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "瀏覽器不支援攝影機，或網站不是 HTTPS。"
      );
    }

    await stopCamera();

    const stream =
      await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: {
            ideal: state.cameraFacing
          },
          width: {
            ideal: 1280
          },
          height: {
            ideal: 720
          }
        }
      });

    state.cameraStream = stream;

    const video = $("cameraPreview");

    video.srcObject = stream;

    showElement("cameraPreview");

    await video.play();

    setStatus(
      "cameraStatus",
      "✅ 鏡頭已開啟，可以拍攝 Plus-Plus 積木。"
    );
  } catch (error) {
    reportError(error, "cameraStatus");
  }
}

async function stopCamera() {
  if (state.cameraStream) {
    for (const track of state.cameraStream.getTracks()) {
      track.stop();
    }
  }

  state.cameraStream = null;

  const video = $("cameraPreview");

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  hideElement("cameraPreview");
}

async function capturePhoto() {
  try {
    const video = $("cameraPreview");

    if (!state.cameraStream ||
        !video ||
        !video.videoWidth) {
      throw new Error(
        "請先開啟鏡頭，確認畫面後再拍照。"
      );
    }

    const canvas = $("captureCanvas");

    const scale = Math.min(
      1,
      MINDSPACE_CONFIG.MAX_IMAGE_SIDE /
      Math.max(
        video.videoWidth,
        video.videoHeight
      )
    );

    canvas.width = Math.round(
      video.videoWidth * scale
    );

    canvas.height = Math.round(
      video.videoHeight * scale
    );

    const ctx = canvas.getContext("2d");

    ctx.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const photo = canvas.toDataURL(
      "image/jpeg",
      MINDSPACE_CONFIG.JPEG_QUALITY
    );

    await setOriginalPhoto(photo);

    setStatus(
      "cameraStatus",
      "✅ 拍攝完成。接下來可以 AI 去背。"
    );
  } catch (error) {
    reportError(error, "cameraStatus");
  }
}

async function uploadPhoto(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    throw new Error("請選擇圖片檔案。");
  }

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);

    const canvas = fitImageToCanvas(image);

    const photo = canvas.toDataURL(
      "image/jpeg",
      MINDSPACE_CONFIG.JPEG_QUALITY
    );

    await setOriginalPhoto(photo);

    setStatus(
      "cameraStatus",
      "✅ 圖片已載入，可以 AI 去背。"
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function setOriginalPhoto(dataUrl) {
  await loadImage(dataUrl);

  state.originalPhoto = dataUrl;
  state.cutoutPhoto = null;
  state.cutoutHistory = [];
  state.currentAnalysis = null;
  state.currentMode = null;

  const preview = $("photoPreview");

  preview.src = dataUrl;

  showElement("photoPreview");

  hideElement("cutoutPreview");
  hideElement("cutoutCanvas");

  setStatus(
    "removeBgStatus",
    "照片已準備完成。請按「AI 自動去背」。"
  );
}

/* =========================================================
   AI 自動去背

   後端必須回傳透明 PNG。
   不接受只回傳一張白底圖片。
========================================================= */

async function aiRemoveBackground() {
  if (!state.originalPhoto) {
    setStatus(
      "removeBgStatus",
      "請先拍照或上傳積木照片。"
    );
    return;
  }

  setBusy(
    "aiRemoveBgButton",
    true,
    "AI 正在去背……"
  );

  try {
    setStatus(
      "removeBgStatus",
      "正在傳送照片給 AI，請稍等……"
    );

    const result = await callAI(
      "removeBackgroundAI",
      {
        image: state.originalPhoto,
        preserveOriginal: true,
        subject: "physical Plus-Plus interlocking construction toy sculpture",
        transparentBackground: true
      },
      MINDSPACE_CONFIG.IMAGE_TIMEOUT
    );

    const generatedImage = extractImage(result);

    const source = await loadImage(
      state.originalPhoto
    );

    const maskImage = await loadImage(
      generatedImage
    );

    const canvas = fitImageToCanvas(source);

    const maskCanvas =
      document.createElement("canvas");

    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;

    const maskCtx = maskCanvas.getContext(
      "2d",
      { willReadFrequently: true }
    );

    maskCtx.drawImage(
      maskImage,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const sourceCtx = canvas.getContext(
      "2d",
      { willReadFrequently: true }
    );

    const originalPixels =
      sourceCtx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    const maskPixels =
      maskCtx.getImageData(
        0,
        0,
        canvas.width,
        canvas.height
      );

    let transparentPixels = 0;

    for (
      let i = 0;
      i < originalPixels.data.length;
      i += 4
    ) {
      const alpha = maskPixels.data[i + 3];

      originalPixels.data[i + 3] = alpha;

      if (alpha < 250) {
        transparentPixels++;
      }
    }

    if (transparentPixels < 10) {
      throw new Error(
        "AI 沒有產生有效的透明區域，去背未完成。"
      );
    }

    sourceCtx.putImageData(
      originalPixels,
      0,
      0
    );

    const cutout = canvasToDataURL(canvas);

    state.cutoutHistory = [];
    state.cutoutPhoto = cutout;

    await showCutout(cutout);

    setStatus(
      "removeBgStatus",
      "✅ AI 去背完成！原始積木顏色已保留。"
    );
  } catch (error) {
    reportError(error, "removeBgStatus");
  } finally {
    setBusy("aiRemoveBgButton", false);
  }
}

async function showCutout(dataUrl) {
  const preview = $("cutoutPreview");

  preview.src = dataUrl;

  showElement("cutoutPreview");

  const canvas = $("cutoutCanvas");

  const image = await loadImage(dataUrl);

  canvas.width = image.width;
  canvas.height = image.height;

  const ctx = canvas.getContext(
    "2d",
    { willReadFrequently: true }
  );

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.drawImage(image, 0, 0);
}

/* =========================================================
   手動擦除與復原
========================================================= */

function toggleManualErase() {
  if (!state.cutoutPhoto) {
    setStatus(
      "removeBgStatus",
      "請先完成 AI 去背，再進行手動修整。"
    );
    return;
  }

  state.manualEraseEnabled =
    !state.manualEraseEnabled;

  if (state.manualEraseEnabled) {
    showElement("cutoutCanvas");
    hideElement("cutoutPreview");

    setStatus(
      "removeBgStatus",
      "手動修整已開啟。請在圖片上拖曳，擦除多餘背景。"
    );
  } else {
    saveManualCutout();

    hideElement("cutoutCanvas");
    showElement("cutoutPreview");

    setStatus(
      "removeBgStatus",
      "手動修整已完成。"
    );
  }
}

function getCanvasPointer(event) {
  const canvas = $("cutoutCanvas");

  const rect = canvas.getBoundingClientRect();

  return {
    x: (event.clientX - rect.left) *
      canvas.width / rect.width,

    y: (event.clientY - rect.top) *
      canvas.height / rect.height
  };
}

function eraseAt(event) {
  if (!state.manualEraseEnabled) return;

  const canvas = $("cutoutCanvas");

  const ctx = canvas.getContext("2d");

  const point = getCanvasPointer(event);

  const scale = canvas.width /
    Math.max(1, canvas.getBoundingClientRect().width);

  ctx.save();

  ctx.globalCompositeOperation =
    "destination-out";

  ctx.beginPath();

  ctx.arc(
    point.x,
    point.y,
    state.manualEraseRadius * scale,
    0,
    Math.PI * 2
  );

  ctx.fill();

  ctx.restore();
}

function saveManualCutout() {
  const canvas = $("cutoutCanvas");

  if (!canvas || !state.cutoutPhoto) return;

  state.cutoutPhoto = canvas.toDataURL(
    "image/png"
  );

  const preview = $("cutoutPreview");

  preview.src = state.cutoutPhoto;
}

async function undoCutout() {
  if (state.cutoutHistory.length > 0) {
    const previous = state.cutoutHistory.pop();

    state.cutoutPhoto = previous;

    await showCutout(previous);

    setStatus(
      "removeBgStatus",
      "已復原上一個修整步驟。"
    );

    return;
  }

  if (state.cutoutPhoto) {
    state.cutoutPhoto = null;

    hideElement("cutoutPreview");
    hideElement("cutoutCanvas");

    state.manualEraseEnabled = false;

    setStatus(
      "removeBgStatus",
      "已取消去背。可以重新執行 AI 去背。"
    );
  }
}

function bindCutoutCanvas() {
  const canvas = $("cutoutCanvas");

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (!state.manualEraseEnabled) return;

      state.cutoutHistory.push(
        canvas.toDataURL("image/png")
      );

      if (state.cutoutHistory.length > 12) {
        state.cutoutHistory.shift();
      }

      state.manualEraseActive = true;

      canvas.setPointerCapture(
        event.pointerId
      );

      eraseAt(event);
    }
  );

  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!state.manualEraseActive) return;

      eraseAt(event);
    }
  );

  const finish = () => {
    if (!state.manualEraseActive) return;

    state.manualEraseActive = false;

    saveManualCutout();
  };

  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
}

/* =========================================================
   AI 自動判斷 Character / Environment
========================================================= */

function normalizeCreationMode(value) {
  const mode = String(value || "")
    .toLowerCase()
    .trim();

  if (
    mode === "environment" ||
    mode === "scene" ||
    mode === "background" ||
    mode === "place"
  ) {
    return "environment";
  }

  if (
    mode === "character" ||
    mode === "creature" ||
    mode === "actor"
  ) {
    return "character";
  }

  return null;
}

async function analyzeCreation(description) {
  const result = await callAI(
    "analyzeCreation",
    {
      image:
        state.originalPhoto,

      cutoutImage:
        state.cutoutPhoto,

      description,

      instructions:
        "Determine whether the maker intends this " +
        "physical Plus-Plus creation to be an animated " +
        "character or the foundation of an environment. " +
        "Prioritize the maker's own description over " +
        "visual assumptions. Return creationMode, " +
        "identity, appearance, colors, personality, " +
        "movement, worldName, worldPrompt, " +
        "welcomeMessage, introEffect."
    },
    90000
  );

  const analysis = normalizeAIResult(result);

  if (!analysis || typeof analysis !== "object") {
    throw new Error(
      "AI 沒有回傳有效的作品分析結果。"
    );
  }

  const mode = normalizeCreationMode(
    analysis.creationMode ||
    analysis.mode ||
    analysis.type
  );

  if (!mode) {
    throw new Error(
      "AI 未能判斷作品是角色還是場景，請補充作品描述後重試。"
    );
  }

  return {
    ...analysis,
    creationMode: mode
  };
}

/* =========================================================
   世界背景
========================================================= */

async function setWorldBackground(imageData) {
  const image = extractImage(imageData);

  await loadImage(image);

  const background = $("plusPlusBackground");

  background.src = image;

  background.classList.remove("hidden");

  state.currentWorld = {
    ...(state.currentWorld || {}),
    backgroundImage: image
  };
}

function clearWorldVisuals() {
  const actors = $("actors");
  const environment = $("plusPlusEnvironmentLayer");
  const effects = $("plusPlusEffectLayer");
  const background = $("plusPlusBackground");

  actors.replaceChildren();
  environment.replaceChildren();
  effects.replaceChildren();

  background.removeAttribute("src");
  background.classList.add("hidden");

  state.heroes = [];
  state.worldObjects = [];
  state.effects = [];
  state.activeHeroId = null;

  renderHeroList();
}

/* =========================================================
   角色建立與渲染
========================================================= */

function normalizeMovement(value) {
  const text = String(value || "").toLowerCase();

  if (
    text.includes("swim") ||
    text.includes("游")
  ) return "swim";

  if (
    text.includes("fly") ||
    text.includes("飛")
  ) return "fly";

  if (
    text.includes("walk") ||
    text.includes("走")
  ) return "walk";

  if (
    text.includes("jump") ||
    text.includes("跳")
  ) return "jump";

  if (
    text.includes("float") ||
    text.includes("漂")
  ) return "float";

  if (
    text.includes("crawl") ||
    text.includes("爬")
  ) return "crawl";

  return "wander";
}

function createHero({
  image,
  name,
  movement,
  personality,
  isOriginal = false,
  scale = 1
}) {
  const hero = {
    id: uid("hero"),

    name: safeText(name, "積木朋友"),

    image,

    movement: normalizeMovement(movement),

    personality: safeText(
      personality,
      "友善、好奇"
    ),

    isOriginal,

    x: randomBetween(0.35, 0.65),

    y: randomBetween(0.35, 0.68),

    vx: randomBetween(-0.10, 0.10),

    vy: randomBetween(-0.06, 0.06),

    speed: randomBetween(0.08, 0.14),

    direction: 1,

    phase: randomBetween(0, Math.PI * 2),

    scale,

    accessories: [],

    skills: [],

    element: null
  };

  const actor = document.createElement("div");

  actor.className = "mindspace-actor";

  actor.dataset.heroId = hero.id;

  actor.style.cssText = [
    "position:absolute",
    "left:50%",
    "top:50%",
    "width:clamp(100px,18vw,240px)",
    "height:clamp(100px,22vh,240px)",
    "transform:translate(-50%,-50%)",
    "transform-origin:center center",
    "will-change:left,top,transform",
    "pointer-events:none",
    "z-index:3"
  ].join(";");

  const img = document.createElement("img");

  img.src = image;
  img.alt = hero.name;

  img.style.cssText = [
    "position:absolute",
    "inset:0",
    "width:100%",
    "height:100%",
    "object-fit:contain",
    "filter:drop-shadow(0 12px 10px rgba(0,0,0,.22))"
  ].join(";");

  actor.appendChild(img);

  $("actors").appendChild(actor);

  hero.element = actor;

  state.heroes.push(hero);

  state.activeHeroId = hero.id;

  renderHeroList();

  return hero;
}

function renderHeroList() {
  const list = $("heroList");

  if (!list) return;

  list.replaceChildren();

  for (const hero of state.heroes) {
    const button = document.createElement("button");

    button.type = "button";

    button.className = "hero-item";

    button.title = hero.name;

    const image = document.createElement("img");

    image.src = hero.image;
    image.alt = "";

    const name = document.createElement("span");

    name.textContent = hero.name;

    button.append(image, name);

    if (hero.id === state.activeHeroId) {
      button.style.borderColor = "#ffd86d";
    }

    button.addEventListener("click", () => {
      state.activeHeroId = hero.id;

      renderHeroList();

      updateSpeechBubble(
        "目前選擇：" + hero.name
      );
    });

    list.appendChild(button);
  }
}

function getActiveHero() {
  return state.heroes.find(
    (hero) => hero.id === state.activeHeroId
  ) || null;
}

function setHeroMovement(heroId, movement) {
  const hero = state.heroes.find(
    (item) => item.id === heroId
  );

  if (!hero) return false;

  hero.movement = normalizeMovement(movement);

  return true;
}

function attachHeroAccessory(
  heroId,
  image,
  options = {}
) {
  const hero = state.heroes.find(
    (item) => item.id === heroId
  );

  if (!hero) {
    throw new Error("找不到指定角色");
  }

  const accessory = document.createElement("img");

  accessory.src = image;

  accessory.alt = safeText(
    options.name,
    "Plus-Plus 配件"
  );

  accessory.style.cssText = [
    "position:absolute",
    "left:" + (options.x ?? 50) + "%",
    "top:" + (options.y ?? 50) + "%",
    "width:" + (options.width ?? 65) + "%",
    "height:" + (options.height ?? 65) + "%",
    "object-fit:contain",
    "transform:translate(-50%,-50%)",
    "pointer-events:none"
  ].join(";");

  hero.element.appendChild(accessory);

  hero.accessories.push({
    name: options.name || "新配件",
    image,
    element: accessory
  });

  return accessory;
}

/* =========================================================
   角色自主動畫

   每種 movement 有不同移動方式。
   原始積木照片本身不被重新繪製。
========================================================= */

function animateHero(hero, dt, time) {
  const step = Math.min(dt, 0.05);

  const t = time / 1000;

  const move = hero.movement;

  if (move === "swim") {
    hero.x += hero.vx * step;
    hero.y +=
      Math.sin(t * 1.9 + hero.phase) *
      0.00075;

    hero.vx +=
      Math.sin(t * 0.7 + hero.phase) *
      step * 0.002;
  }

  else if (move === "fly") {
    hero.x += hero.vx * step;

    hero.y +=
      Math.sin(t * 1.3 + hero.phase) *
      0.0014;

    hero.vx +=
      Math.sin(t * 0.5 + hero.phase) *
      step * 0.006;
  }

  else if (move === "walk") {
    hero.x += hero.vx * step;

    hero.y = 0.76;
  }

  else if (move === "jump") {
    hero.x += hero.vx * step;

    hero.y =
      0.74 -
      Math.abs(
        Math.sin(t * 2.3 + hero.phase)
      ) * 0.17;
  }

  else if (move === "crawl") {
    hero.x += hero.vx * step * 0.45;

    hero.y =
      0.78 +
      Math.sin(t * 3 + hero.phase) * 0.004;
  }

  else if (move === "float") {
    hero.x += hero.vx * step * 0.45;

    hero.y +=
      Math.sin(t + hero.phase) * 0.0006;
  }

  else {
    hero.x += hero.vx * step;
    hero.y += hero.vy * step;
  }

  if (hero.x < 0.12) {
    hero.x = 0.12;
    hero.vx = Math.abs(
      hero.vx || hero.speed
    );
  }

  if (hero.x > 0.88) {
    hero.x = 0.88;
    hero.vx = -Math.abs(
      hero.vx || hero.speed
    );
  }

  if (
    move !== "walk" &&
    move !== "jump" &&
    move !== "crawl"
  ) {
    if (hero.y < 0.15) {
      hero.y = 0.15;
      hero.vy = Math.abs(
        hero.vy || 0.03
      );
    }

    if (hero.y > 0.8) {
      hero.y = 0.8;
      hero.vy = -Math.abs(
        hero.vy || 0.03
      );
    }
  }

  if (Math.abs(hero.vx) > 0.002) {
    hero.direction = hero.vx >= 0
      ? 1
      : -1;
  }

  let rotation = 0;

  if (move === "swim") {
    rotation =
      Math.sin(t * 4 + hero.phase) * 4;
  }

  if (move === "fly") {
    rotation =
      Math.sin(t * 2 + hero.phase) * 7;
  }

  if (move === "walk") {
    rotation =
      Math.sin(t * 10 + hero.phase) * 2.5;
  }

  hero.element.style.left =
    (hero.x * 100) + "%";

  hero.element.style.top =
    (hero.y * 100) + "%";

  hero.element.style.transform =
    "translate(-50%,-50%) " +
    "scale(" +
    (hero.scale * hero.direction) +
    "," +
    hero.scale +
    ") " +
    "rotate(" + rotation + "deg)";
}

function animationLoop(time) {
  if (!state.lastFrameTime) {
    state.lastFrameTime = time;
  }

  const dt =
    (time - state.lastFrameTime) / 1000;

  state.lastFrameTime = time;

  for (const hero of state.heroes) {
    if (hero.element && hero.element.isConnected) {
      animateHero(hero, dt, time);
    }
  }

  state.animationFrame =
    requestAnimationFrame(animationLoop);
}

/* =========================================================
   Plus-Plus 風格特效

   特效不是寫實圖片。
   這裡使用 Plus-Plus 形狀的 SVG 積木單元，
   由 AI 回傳的主題選擇動作。
========================================================= */

function createPlusPlusSVG(color = "#ffd86d") {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" ' +
    'viewBox="0 0 100 100">' +
    '<path d="' +
    'M35 5 H65 V35 H95 V65 H65 V95 ' +
    'H35 V65 H5 V35 H35 Z' +
    '" fill="' + color + '" ' +
    'stroke="rgba(255,255,255,0.55)" ' +
    'stroke-width="3"/>' +
    '</svg>';

  return "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(svg);
}

function createEffectPiece(
  color,
  x,
  y,
  size
) {
  const img = document.createElement("img");

  img.src = createPlusPlusSVG(color);

  img.alt = "";

  img.style.cssText = [
    "position:absolute",
    "left:" + x + "%",
    "top:" + y + "%",
    "width:" + size + "px",
    "height:" + size + "px",
    "pointer-events:none",
    "will-change:transform,opacity"
  ].join(";");

  return img;
}

function chooseIntroEffect(analysis) {
  const explicit = String(
    analysis.introEffect ||
    analysis.effect ||
    ""
  ).toLowerCase();

  if (
    explicit.includes("leaf") ||
    explicit.includes("葉") ||
    explicit.includes("forest")
  ) return "leaves";

  if (
    explicit.includes("bubble") ||
    explicit.includes("泡泡") ||
    explicit.includes("ocean")
  ) return "bubbles";

  if (
    explicit.includes("snow") ||
    explicit.includes("雪")
  ) return "snow";

  if (
    explicit.includes("meteor") ||
    explicit.includes("流星")
  ) return "meteors";

  if (
    explicit.includes("fire") ||
    explicit.includes("火")
  ) return "fire";

  return "sparkles";
}

function playPlusPlusEffect(
  effectType = "sparkles",
  duration = 3000,
  options = {}
) {
  const layer = $("plusPlusEffectLayer");

  const effectId = uid("effect");

  const colors = Array.isArray(options.colors) &&
    options.colors.length
    ? options.colors
    : [
        "#ffd86d",
        "#77c9ff",
        "#ff91bd",
        "#9de6b4",
        "#c7a6ff"
      ];

  const count = clamp(
    Number(options.count) || 35,
    5,
    100
  );

  const pieces = [];

  for (let i = 0; i < count; i++) {
    const color =
      colors[i % colors.length];

    const x = randomBetween(0, 100);
    const y = randomBetween(0, 100);

    const size = randomBetween(12, 32);

    const piece = createEffectPiece(
      color,
      x,
      y,
      size
    );

    layer.appendChild(piece);

    let keyframes;

    if (
      effectType === "leaves" ||
      effectType === "snow"
    ) {
      piece.style.top = "-8%";

      keyframes = [
        {
          transform:
            "translate(0, -20px) rotate(0deg)",
          opacity: 0
        },
        {
          opacity: 1,
          offset: 0.15
        },
        {
          transform:
            "translate(" +
            randomBetween(-140, 140) +
            "px, 105vh) rotate(" +
            randomBetween(180, 900) +
            "deg)",
          opacity: 0
        }
      ];
    }

    else if (effectType === "bubbles") {
      piece.style.top = "105%";

      keyframes = [
        {
          transform:
            "translateY(0) scale(.6)",
          opacity: 0
        },
        {
          opacity: 0.9,
          offset: 0.25
        },
        {
          transform:
            "translate(" +
            randomBetween(-70, 70) +
            "px, -110vh) rotate(180deg)",
          opacity: 0
        }
      ];
    }

    else if (effectType === "meteors") {
      keyframes = [
        {
          transform:
            "translate(-30vw,-30vh) rotate(30deg)",
          opacity: 0
        },
        {
          opacity: 1,
          offset: 0.2
        },
        {
          transform:
            "translate(70vw,70vh) rotate(240deg)",
          opacity: 0
        }
      ];
    }

    else {
      keyframes = [
        {
          transform:
            "scale(.1) rotate(0deg)",
          opacity: 0
        },
        {
          transform:
            "scale(1.4) rotate(180deg)",
          opacity: 1,
          offset: 0.5
        },
        {
          transform:
            "scale(.1) rotate(360deg)",
          opacity: 0
        }
      ];
    }

    const animation = piece.animate(
      keyframes,
      {
        duration: duration *
          randomBetween(0.65, 1),

        delay: randomBetween(
          0,
          duration * 0.25
        ),

        easing: "ease-in-out",

        fill: "forwards"
      }
    );

    pieces.push({
      piece,
      animation
    });
  }

  const effect = {
    id: effectId,
    type: effectType,
    pieces
  };

  state.effects.push(effect);

  setTimeout(() => {
    for (const item of pieces) {
      item.animation.cancel();
      item.piece.remove();
    }

    state.effects = state.effects.filter(
      (item) => item.id !== effectId
    );
  }, duration + 150);

  return effectId;
}

/* =========================================================
   Character 模式
========================================================= */

async function generateCharacterWorld(
  analysis,
  description
) {
  showProgress(
    "正在依照積木角色生成專屬世界……"
  );

  const worldResult = await callAI(
    "generateWorld",
    {
      mode: "character",

      originalImage: state.originalPhoto,

      cutoutImage: state.cutoutPhoto,

      analysis,

      description,

      style:
        "Authentic Plus-Plus interlocking plastic " +
        "construction toy pieces. All environments " +
        "must look physically built from Plus-Plus. " +
        "Full-bleed immersive landscape background. " +
        "No text, no frame, no white margins.",

      aspectRatio: "16:9",

      backgroundOnly: true
    },
    MINDSPACE_CONFIG.WORLD_TIMEOUT
  );

  await setWorldBackground(worldResult);

  showProgress(
    "正在讓你的積木角色進入世界……"
  );

  const hero = createHero({
    image: state.cutoutPhoto,

    name:
      analysis.identity ||
      analysis.name ||
      "積木朋友",

    movement:
      analysis.movement ||
      analysis.motion ||
      "wander",

    personality:
      analysis.personality,

    isOriginal: true,

    scale: 1
  });

  state.currentWorld = {
    ...(state.currentWorld || {}),

    mode: "character",

    name:
      analysis.worldName ||
      "我的 Plus-Plus 世界",

    description,

    analysis
  };

  state.currentMode = "character";

  await sleep(700);

  hideProgress();

  const welcome = safeText(
    analysis.welcomeMessage ||
    analysis.greeting,
    "你好！我是你創造的積木朋友！" +
    "歡迎來到我們的世界，你想讓我做什麼呢？"
  );

  updateSpeechBubble(welcome);

  setStatus(
    "creationStatus",
    "✅ 角色已進入滿版 Plus-Plus 世界！\n" +
    "角色：" + hero.name + "\n" +
    "動作：" + hero.movement
  );

  if (
    window.MindspaceDirector &&
    typeof window.MindspaceDirector.speak === "function"
  ) {
    await window.MindspaceDirector.speak(welcome);
  }
}

/* =========================================================
   Environment 模式

   場景照片是世界的核心。
   AI 生成滿版背景後，保留原始作品作為獨立圖層。
========================================================= */

async function generateEnvironmentWorld(
  analysis,
  description
) {
  showProgress(
    "正在以你的積木作品延伸完整場景……"
  );

  const worldResult = await callAI(
    "generateWorld",
    {
      mode: "environment",

      originalImage: state.originalPhoto,

      cutoutImage: state.cutoutPhoto,

      analysis,

      description,

      style:
        "Create a full-bleed immersive environment " +
        "entirely from authentic Plus-Plus " +
        "interlocking construction toy pieces. " +
        "Extend the maker's physical creation " +
        "naturally into the world. " +
        "Match its colors, structure and perspective. " +
        "No text, no frame, no white margins.",

      aspectRatio: "16:9",

      preserveOriginal: true
    },
    MINDSPACE_CONFIG.WORLD_TIMEOUT
  );

  await setWorldBackground(worldResult);

  const environmentLayer =
    $("plusPlusEnvironmentLayer");

  /*
    原始作品獨立保留。

    後續 Code.gs 應生成適合放置原始作品的
    背景構圖，避免原始作品與背景重複。
  */

  const originalObject =
    document.createElement("img");

  originalObject.src = state.cutoutPhoto;

  originalObject.alt =
    analysis.identity ||
    "長輩的 Plus-Plus 場景作品";

  originalObject.style.cssText = [
    "position:absolute",
    "left:50%",
    "bottom:7%",
    "width:min(48vw,560px)",
    "height:65%",
    "object-fit:contain",
    "transform:translateX(-50%)",
    "filter:drop-shadow(0 14px 12px rgba(0,0,0,.18))",
    "pointer-events:none"
  ].join(";");

  environmentLayer.appendChild(
    originalObject
  );

  state.currentWorld = {
    ...(state.currentWorld || {}),

    mode: "environment",

    name:
      analysis.worldName ||
      "我的 Plus-Plus 世界",

    description,

    analysis,

    originalObject
  };

  state.currentMode = "environment";

  showProgress(
    "世界完成！正在啟動場景特效……"
  );

  await sleep(350);

  hideProgress();

  const effectType =
    chooseIntroEffect(analysis);

  playPlusPlusEffect(
    effectType,
    MINDSPACE_CONFIG.ENVIRONMENT_INTRO_MS
  );

  setStatus(
    "creationStatus",
    "✅ 場景已生成！\n" +
    "正在播放 3 秒 Plus-Plus 特效：" +
    effectType
  );

  await sleep(
    MINDSPACE_CONFIG.ENVIRONMENT_INTRO_MS
  );

  const welcome = safeText(
    analysis.welcomeMessage ||
    analysis.greeting,
    "哇！你的積木作品變成了一個好大的世界！" +
    "你還想在這裡增加什麼呢？"
  );

  updateSpeechBubble(welcome);

  setStatus(
    "creationStatus",
    "✅ Plus-Plus 場景已完成！\n" +
    "你可以繼續用語音新增角色、技能和故事。"
  );

  if (
    window.MindspaceDirector &&
    typeof window.MindspaceDirector.speak === "function"
  ) {
    await window.MindspaceDirector.speak(welcome);
  }
}

/* =========================================================
   主要世界生成入口

   不讓使用者手動選 Character / Environment。
========================================================= */

async function generateCreationWorld() {
  if (state.isGenerating) return;

  if (!state.originalPhoto) {
    setStatus(
      "creationStatus",
      "請先拍照或上傳積木作品。"
    );
    return;
  }

  if (!state.cutoutPhoto) {
    setStatus(
      "creationStatus",
      "請先完成 AI 去背，保留原始積木作品。"
    );
    return;
  }

  state.isGenerating = true;

  setBusy(
    "generateCreationWorld",
    true,
    "AI 正在創造世界……"
  );

  const description =
    $("creationDescription").value.trim();

  try {
    showProgress(
      "AI 正在理解你的 Plus-Plus 創作……"
    );

    const analysis =
      await analyzeCreation(description);

    state.currentAnalysis = analysis;

    clearWorldVisuals();

    if (analysis.creationMode === "character") {
      await generateCharacterWorld(
        analysis,
        description
      );
    } else {
      await generateEnvironmentWorld(
        analysis,
        description
      );
    }
  } catch (error) {
    hideProgress();

    reportError(error, "creationStatus");
  } finally {
    state.isGenerating = false;

    setBusy(
      "generateCreationWorld",
      false
    );
  }
}

/* =========================================================
   世界物件

   提供 ai-director.js 呼叫。
========================================================= */

async function addWorldObject({
  image,
  name = "積木物件",
  x = 50,
  y = 55,
  width = 24,
  height = 35
}) {
  await loadImage(image);

  const object = document.createElement("img");

  object.src = image;
  object.alt = name;

  object.style.cssText = [
    "position:absolute",
    "left:" + clamp(x, 0, 100) + "%",
    "top:" + clamp(y, 0, 100) + "%",
    "width:" + clamp(width, 5, 90) + "%",
    "height:" + clamp(height, 5, 90) + "%",
    "object-fit:contain",
    "transform:translate(-50%,-50%)",
    "pointer-events:none"
  ].join(";");

  $("plusPlusEnvironmentLayer")
    .appendChild(object);

  const item = {
    id: uid("object"),
    name,
    image,
    element: object
  };

  state.worldObjects.push(item);

  return item;
}

async function addGeneratedCharacter({
  image,
  name,
  movement,
  personality
}) {
  await loadImage(image);

  return createHero({
    image,
    name,
    movement,
    personality,
    isOriginal: false,
    scale: 0.8
  });
}

async function replaceWorldBackground(image) {
  await setWorldBackground(image);
}

function clearWorld() {
  clearWorldVisuals();

  state.currentWorld = null;
  state.currentMode = null;
  state.currentAnalysis = null;

  setStatus(
    "creationStatus",
    "世界已清空，可以開始新的創作。"
  );

  updateSpeechBubble("");
}

function prepareNewCreation() {
  state.originalPhoto = null;
  state.cutoutPhoto = null;
  state.cutoutHistory = [];

  state.manualEraseEnabled = false;

  hideElement("photoPreview");
  hideElement("cutoutPreview");
  hideElement("cutoutCanvas");

  $("creationDescription").value = "";

  setStatus(
    "cameraStatus",
    "請拍攝新的 Plus-Plus 積木作品。"
  );

  setStatus(
    "removeBgStatus",
    "請先拍攝或上傳積木照片。"
  );

  setWorkbenchOpen(true);
}

/* =========================================================
   提供 AI Director 使用的介面
========================================================= */

window.MindspaceWorld = {
  get state() {
    return state;
  },

  getActiveHero,

  createHero,

  addGeneratedCharacter,

  addWorldObject,

  attachHeroAccessory,

  setHeroMovement,

  replaceWorldBackground,

  playPlusPlusEffect,

  updateSpeechBubble,

  setStatus,

  clearWorld,

  prepareNewCreation,

  extractImage,

  callAI
};

/* =========================================================
   事件綁定
========================================================= */

function bindButton(id, handler) {
  const button = $(id);

  if (!button) {
    console.warn(
      "[Mindspace] 找不到按鈕：",
      id
    );
    return;
  }

  button.addEventListener(
    "click",
    handler
  );
}

function bindInterface() {
  bindButton(
    "mobileToggle",
    toggleWorkbench
  );

  bindButton(
    "closeWorkbench",
    () => setWorkbenchOpen(false)
  );

  bindButton(
    "fullscreenButton",
    toggleFullscreen
  );

  document.addEventListener(
    "fullscreenchange",
    updateFullscreenButton
  );

  bindButton(
    "startCamera",
    startCamera
  );

  bindButton(
    "stopCamera",
    stopCamera
  );

  bindButton(
    "capturePhoto",
    capturePhoto
  );

  bindButton(
    "uploadPhotoButton",
    () => $("photoInput").click()
  );

  $("photoInput").addEventListener(
    "change",
    async (event) => {
      const file =
        event.target.files &&
        event.target.files[0];

      if (!file) return;

      try {
        await uploadPhoto(file);
      } catch (error) {
        reportError(
          error,
          "cameraStatus"
        );
      }

      event.target.value = "";
    }
  );

  bindButton(
    "aiRemoveBgButton",
    aiRemoveBackground
  );

  bindButton(
    "manualRemoveBgButton",
    toggleManualErase
  );

  bindButton(
    "undoRemoveBgButton",
    undoCutout
  );

  bindButton(
    "generateCreationWorld",
    generateCreationWorld
  );

  bindButton(
    "newCreationButton",
    prepareNewCreation
  );

  bindButton(
    "clearWorldButton",
    () => {
      if (
        window.confirm(
          "確定要清空目前的數位世界嗎？"
        )
      ) {
        clearWorld();
      }
    }
  );

  bindButton(
    "testAIButton",
    testAIConnection
  );

  bindCutoutCanvas();

  /*
    語音按鈕由下一個檔案 ai-director.js 接管：
    voiceButton
    workbenchVoiceButton
    toggleVoiceOutput
    stopSpeakingButton
    sendTextCommand
  */
}

/* =========================================================
   初始化
========================================================= */

function initializeMindspace() {
  if (state.initialized) return;

  state.initialized = true;

  bindInterface();

  setWorkbenchOpen(false);

  window.addEventListener(
    "message",
    handleBridgeMessage
  );

  initializeBridge();

  state.animationFrame =
    requestAnimationFrame(animationLoop);

  setStatus(
    "creationStatus",
    "歡迎來到 Mindspace Plus-Plus！\n" +
    "請先製作積木，拍照後讓 AI 創造世界。"
  );

  console.log(
    "[Mindspace Plus-Plus] sketch.js initialized"
  );
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeMindspace
  );
} else {
  initializeMindspace();
}
