
"use strict";

/* =========================================================
   MINDSPACE PLUS-PLUS
   sketch.js — PART 1

   基於一評 Mindspace V2

   核心：
   - 保留原始 Plus-Plus 積木
   - 去背後先進入世界
   - AI 辨識在後續執行
   - 角色與環境共同累積
   - AI 視覺內容維持 Plus-Plus 風格
   - 沿用 mindspace-v2 GAS Bridge
========================================================= */

/*
  目前先沿用一評的 GAS 部署網址。

  等新版 Code.gs 和 Bridge.html 部署完成，
  再替換成新版部署網址。
*/

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbwUooMD69_NMBhTzxf0Os_D6BEGb3QsGyhXpTGv09emRcG_4du219K4qO_FggY1vnLHOg/exec";

/* =========================================================
   01｜基礎工具
========================================================= */

const $ = id =>
  document.getElementById(id);

const clamp = (number, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, number));

const uid = () =>
  Date.now().toString(36) +
  Math.random().toString(36).slice(2, 9);

const sleep = milliseconds =>
  new Promise(resolve =>
    setTimeout(resolve, milliseconds)
  );

function status(message) {
  const element = $("status");

  if (element) {
    element.textContent = String(message);
  }

  console.log("[Mindspace]", message);
}

function bubble(message) {
  const element = $("speechBubble");

  if (element) {
    element.textContent = String(message);
  }
}

function modal(id, show) {
  const element = $(id);

  if (!element) return;

  element.classList.toggle(
    "hidden",
    !show
  );
}

function click(id, callback) {
  const element = $(id);

  if (!element) {
    console.warn(
      "[Mindspace] 找不到按鈕：",
      id
    );
    return;
  }

  element.addEventListener(
    "click",
    () => {
      try {
        const result = callback();

        if (
          result &&
          typeof result.catch === "function"
        ) {
          result.catch(error => {
            status(
              "❌ " +
              (error?.message || String(error))
            );
          });
        }
      } catch (error) {
        status(
          "❌ " +
          (error?.message || String(error))
        );
      }
    }
  );
}

function imageLoad(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };

    image.onerror = () => {
      reject(
        new Error("圖片載入失敗")
      );
    };

    image.src = source;
  });
}

function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      resolve(reader.result);
    };

    reader.onerror = () => {
      reject(
        new Error("無法讀取圖片檔案")
      );
    };

    reader.readAsDataURL(file);
  });
}

async function scaledData(
  source,
  maximum = 650,
  format = "image/png"
) {
  const image = await imageLoad(source);

  const ratio = Math.min(
    1,
    maximum / Math.max(
      image.width,
      image.height
    )
  );

  const canvas =
    document.createElement("canvas");

  canvas.width = Math.max(
    1,
    Math.round(image.width * ratio)
  );

  canvas.height = Math.max(
    1,
    Math.round(image.height * ratio)
  );

  const context = canvas.getContext("2d");

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  return canvas.toDataURL(
    format,
    format === "image/jpeg"
      ? 0.86
      : undefined
  );
}

/* =========================================================
   02｜全域狀態

   保留一評原有欄位，
   新增二評 Plus-Plus 資料。
========================================================= */

const state = {

  /* ===== 一評原有角色系統 ===== */

  heroes: [],

  selectedId: null,

  world: "ocean",

  history: [],

  scenes: [],

  voiceEnabled: true,

  /* ===== GAS Bridge ===== */

  bridgeReady: false,

  bridgeInitialized: false,

  bridgeWindow: null,

  bridgeOrigin: "",

  bridgeToken: uid() + uid(),

  pending: new Map(),

  /* ===== 攝影機 ===== */

  cameraStream: null,

  cameraFacing: "environment",

  cameraRequestId: 0,

  /* ===== 語音錄製 ===== */

  recorder: null,

  audioStream: null,

  audioChunks: [],

  recording: false,

  busy: false,

  /* ===== 圖片編輯器 ===== */

  editorOriginal: null,

  editorHeroId: null,

  editorHistory: [],

  editorMode: "erase",

  editorPainting: false,

  editorLastPoint: null,

  /* ===== AI 語音播放 ===== */

  audio: null,

  speechSerial: 0,

  /* =====================================================
     二評新增：Plus-Plus 共同世界
  ===================================================== */

  /*
    所有拍照作品都先進入 creations。

    role 尚未確定時為 pending。

    AI 完成辨識後才變成：
    character / environment。
  */

  creations: [],

  /* AI 生成的背景資料 */

  generatedWorlds: [],

  /* AI 生成的環境物件 */

  environments: [],

  /* AI 生成的配角與道具 */

  generatedObjects: [],

  /* 附著在原始角色上的配件 */

  accessories: [],

  /* 需要播放的視覺特效 */

  effects: [],

  /* AI 故事事件佇列 */

  eventQueue: [],

  /* 目前主要世界背景 */

  activeBackgroundId: null,

  /* 是否已經產生第一個世界 */

  worldInitialized: false,

  /* 正在等待 AI 辨識的作品 */

  pendingCreationId: null,

  /* AI 建議的分類 */

  suggestedCreationRole: null,

  /* 孩子選擇的分類 */

  selectedCreationRole: null,

  /* 正在執行的生成工作 */

  generationJobs: new Map(),

  /* 世界版本，避免過期結果覆蓋新內容 */

  worldRevision: 0,

  /* 右側工作台狀態 */

  workbenchOpen: false
};

/* =========================================================
   03｜角色與創作查詢
========================================================= */

function heroNow() {
  return state.heroes.find(
    hero => hero.id === state.selectedId
  ) || null;
}

function creationById(id) {
  return state.creations.find(
    creation => creation.id === id
  ) || null;
}

function selectedCreation() {
  return creationById(
    state.selectedId
  );
}

function isCharacter(creation) {
  return (
    creation &&
    creation.role === "character"
  );
}

function isEnvironment(creation) {
  return (
    creation &&
    creation.role === "environment"
  );
}

/* =========================================================
   04｜建立原始 Plus-Plus 作品資料

   重要：
   originalImage 不可被 AI 生成圖覆蓋。
========================================================= */

function createPlusPlusRecord({
  image,
  description = "",
  source = "camera"
}) {
  if (!image) {
    throw new Error(
      "建立積木作品時缺少圖片"
    );
  }

  return {
    id: uid(),

    type: "plusplus-creation",

    role: "pending",

    source,

    description,

    /* 孩子原本的實體積木 */

    originalImage: image,

    /* 目前顯示的造型 */

    displayImage: image,

    /* AI 變身後的圖片 */

    transformedImage: null,

    /* AI 辨識結果 */

    analysis: null,

    /* AI 辨識狀態 */

    analysisStatus: "pending",

    /* AI 生成背景狀態 */

    worldStatus: "pending",

    /* 角色基本屬性 */

    name: "",

    personality: "",

    abilities: [],

    /* 附著配件 */

    accessoryIds: [],

    /* 相關環境 */

    environmentIds: [],

    /* 畫面位置 */

    x: 0.5,

    y: 0.55,

    scale: 1,

    rotation: 0,

    /* 動作 */

    movement: {
      type: "idle",
      speed: 1
    },

    /* 時間 */

    createdAt: Date.now(),

    updatedAt: Date.now()
  };
}

/* =========================================================
   05｜GAS Bridge 安全來源檢查
========================================================= */

function googleOrigin(origin) {
  try {
    const url = new URL(origin);

    const host =
      url.hostname.toLowerCase();

    return (
      url.protocol === "https:" &&
      (
        host === "script.google.com" ||
        host === "script.googleusercontent.com" ||
        host.endsWith(
          ".googleusercontent.com"
        )
      )
    );
  } catch (error) {
    return false;
  }
}

/* =========================================================
   06｜初始化 GAS Bridge

   沿用一評 mindspace-v2 協定。
========================================================= */

function initializeBridge() {
  if (
    !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/
      .test(GAS_URL)
  ) {
    status(
      "❌ GAS_URL 不是有效的部署網址"
    );
    return;
  }

  const frame = $("bridgeFrame");

  if (!frame) {
    status(
      "❌ 找不到 GAS iframe"
    );
    return;
  }

  if (state.bridgeInitialized) {
    return;
  }

  state.bridgeInitialized = true;

  state.bridgeReady = false;

  state.bridgeWindow = null;

  state.bridgeOrigin = "";

  window.addEventListener(
    "message",
    event => {
      const message = event.data;

      if (!googleOrigin(event.origin)) {
        return;
      }

      if (
        !message ||
        typeof message !== "object"
      ) {
        return;
      }

      if (
        message.app !== "mindspace-v2"
      ) {
        return;
      }

      if (
        message.token !==
        state.bridgeToken
      ) {
        return;
      }

      if (message.kind === "ready") {
        if (!event.source) {
          return;
        }

        state.bridgeWindow =
          event.source;

        state.bridgeOrigin =
          event.origin;

        state.bridgeReady = true;

        status(
          "✅ GAS Bridge 已連線"
        );

        event.source.postMessage(
          {
            app: "mindspace-v2",
            kind: "ack",
            token: state.bridgeToken
          },
          event.origin
        );

        return;
      }

      if (message.kind === "response") {
        const pending =
          state.pending.get(
            message.id
          );

        if (!pending) {
          return;
        }

        if (
          event.source !==
          state.bridgeWindow
        ) {
          return;
        }

        clearTimeout(
          pending.timer
        );

        state.pending.delete(
          message.id
        );

        if (message.ok) {
          pending.resolve(
            message.result
          );
        } else {
          pending.reject(
            new Error(
              message.error ||
              "GAS AI 後端執行失敗"
            )
          );
        }
      }
    }
  );

  const url = new URL(GAS_URL);

  url.searchParams.set(
    "bridgeToken",
    state.bridgeToken
  );

  url.searchParams.set(
    "parentOrigin",
    window.location.origin
  );

  frame.src = url.toString();

  frame.addEventListener(
    "error",
    () => {
      status(
        "❌ GAS iframe 載入失敗"
      );
    }
  );

  setTimeout(() => {
    if (!state.bridgeReady) {
      status(
        "⚠️ 尚未收到 GAS 連線訊息，請檢查 Bridge.html 與部署版本"
      );
    }
  }, 15000);
}

/* =========================================================
   07｜向 GAS 發送 AI 請求

   保留一評原有通訊格式。
========================================================= */

function callAI(
  type,
  data = {},
  timeout = 120000
) {
  return new Promise(
    (resolve, reject) => {
      if (
        !state.bridgeReady ||
        !state.bridgeWindow
      ) {
        reject(
          new Error(
            "GAS 尚未連線，請先測試 AI 連線"
          )
        );
        return;
      }

      const id = uid();

      const timer = setTimeout(
        () => {
          state.pending.delete(id);

          reject(
            new Error(
              "AI 回應逾時：" + type
            )
          );
        },
        timeout
      );

      state.pending.set(
        id,
        {
          resolve,
          reject,
          timer
        }
      );

      try {
        state.bridgeWindow.postMessage(
          {
            app: "mindspace-v2",
            kind: "request",
            token: state.bridgeToken,
            id,
            type,
            data
          },
          state.bridgeOrigin
        );
      } catch (error) {
        clearTimeout(timer);

        state.pending.delete(id);

        reject(error);
      }
    }
  );
}

/* ===== sketch.js 第一段結束 ===== */

/* =========================================================
   MINDSPACE PLUS-PLUS
   sketch.js — PART 2

   08｜攝影機
   09｜圖片編輯器
   10｜AI 去背
   11｜原始積木立即進入世界
   12｜AI 角色 / 環境辨識
   13｜孩子確認分類
========================================================= */

/* =========================================================
   08｜攝影機
========================================================= */

async function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream
      .getTracks()
      .forEach(track => {
        track.stop();
      });

    state.cameraStream = null;
  }

  const video = $("cameraVideo");

  if (video) {
    video.pause();
    video.srcObject = null;
  }
}

async function closeCamera() {
  state.cameraRequestId++;

  await stopCamera();

  modal("cameraModal", false);
}

async function openCamera() {
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    throw new Error(
      "目前瀏覽器不支援攝影機，請使用 HTTPS 網站"
    );
  }

  const video = $("cameraVideo");

  if (!video) {
    throw new Error(
      "找不到 cameraVideo"
    );
  }

  const requestId =
    ++state.cameraRequestId;

  await stopCamera();

  const preview = $("cameraPreview");

  if (preview) {
    preview.classList.add("hidden");
    preview.removeAttribute("src");
  }

  video.classList.remove("hidden");

  const message = $("cameraMessage");

  if (message) {
    message.textContent =
      "請將 Plus-Plus 積木作品放在畫面中央。";
  }

  modal("cameraModal", true);

  try {
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

    if (
      requestId !==
      state.cameraRequestId
    ) {
      stream
        .getTracks()
        .forEach(track => track.stop());

      return;
    }

    state.cameraStream = stream;

    video.srcObject = stream;

    await video.play();

    status("📸 攝影機已開啟");
  } catch (error) {
    await stopCamera();

    status(
      "❌ 無法開啟攝影機：" +
      error.message
    );

    throw error;
  }
}

async function switchCamera() {
  state.cameraFacing =
    state.cameraFacing === "environment"
      ? "user"
      : "environment";

  await openCamera();
}

async function capturePhoto() {
  const video = $("cameraVideo");

  if (
    !video ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    throw new Error(
      "攝影機尚未準備完成"
    );
  }

  const canvas =
    document.createElement("canvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const context = canvas.getContext("2d");

  context.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const image = canvas.toDataURL(
    "image/png"
  );

  /*
    拍照後先停止攝影機，
    再進入去背編輯器。
  */

  await closeCamera();

  await openEditor(image, null);

  status(
    "📸 拍照完成，請進行 AI 去背"
  );
}

/* =========================================================
   09｜圖片編輯器
========================================================= */

const editor = {
  canvas: null,
  context: null,

  originalImage: null,

  originalPixels: null,

  currentImage: null,

  history: [],

  mode: "erase",

  brushSize: 28,

  painting: false,

  lastPoint: null,

  targetCreationId: null
};

async function openEditor(
  source,
  creationId = null
) {
  const canvas = $("editCanvas");

  if (!canvas) {
    throw new Error(
      "找不到 editCanvas"
    );
  }

  const image = await imageLoad(source);

  const maximum = 1100;

  const ratio = Math.min(
    1,
    maximum / Math.max(
      image.width,
      image.height
    )
  );

  canvas.width = Math.max(
    1,
    Math.round(image.width * ratio)
  );

  canvas.height = Math.max(
    1,
    Math.round(image.height * ratio)
  );

  const context =
    canvas.getContext(
      "2d",
      {
        willReadFrequently: true
      }
    );

  context.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  editor.canvas = canvas;
  editor.context = context;

  editor.originalImage =
    canvas.toDataURL("image/png");

  editor.originalPixels =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  editor.currentImage =
    editor.originalImage;

  editor.history = [];

  editor.mode = "erase";

  editor.painting = false;

  editor.lastPoint = null;

  editor.targetCreationId =
    creationId;

  modal("editorModal", true);
}

function editorHistory() {
  if (
    !editor.canvas ||
    !editor.context
  ) {
    return;
  }

  editor.history.push(
    editor.context.getImageData(
      0,
      0,
      editor.canvas.width,
      editor.canvas.height
    )
  );

  if (editor.history.length > 20) {
    editor.history.shift();
  }
}

function undoEditor() {
  if (
    !editor.context ||
    editor.history.length === 0
  ) {
    return;
  }

  const previous =
    editor.history.pop();

  editor.context.putImageData(
    previous,
    0,
    0
  );

  editor.currentImage =
    editor.canvas.toDataURL(
      "image/png"
    );
}

async function resetEditor() {
  if (!editor.originalImage) {
    return;
  }

  editorHistory();

  const image =
    await imageLoad(
      editor.originalImage
    );

  editor.context.clearRect(
    0,
    0,
    editor.canvas.width,
    editor.canvas.height
  );

  editor.context.drawImage(
    image,
    0,
    0,
    editor.canvas.width,
    editor.canvas.height
  );

  editor.currentImage =
    editor.canvas.toDataURL(
      "image/png"
    );
}

/* =========================================================
   09-A｜手動筆刷
========================================================= */

function editorPoint(event) {
  const canvas = editor.canvas;

  if (!canvas) {
    return null;
  }

  const rect =
    canvas.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left) *
      canvas.width / rect.width,

    y:
      (event.clientY - rect.top) *
      canvas.height / rect.height
  };
}

function paintEditor(event) {
  if (
    !editor.painting ||
    !editor.context
  ) {
    return;
  }

  const point = editorPoint(event);

  if (!point) {
    return;
  }

  const context = editor.context;

  const last =
    editor.lastPoint || point;

  const size =
    Number(
      $("brushSize")?.value || 28
    );

  context.save();

  context.lineWidth = size;
  context.lineCap = "round";
  context.lineJoin = "round";

  context.beginPath();

  context.moveTo(
    last.x,
    last.y
  );

  context.lineTo(
    point.x,
    point.y
  );

  if (editor.mode === "erase") {
    context.globalCompositeOperation =
      "destination-out";

    context.strokeStyle =
      "rgba(0,0,0,1)";

    context.stroke();
  } else {
    /*
      還原筆刷：

      從原始圖片還原對應位置，
      而不是在畫布上畫白色。
    */

    const mask =
      document.createElement(
        "canvas"
      );

    mask.width =
      editor.canvas.width;

    mask.height =
      editor.canvas.height;

    const maskContext =
      mask.getContext("2d");

    maskContext.lineWidth = size;
    maskContext.lineCap = "round";
    maskContext.lineJoin = "round";

    maskContext.strokeStyle =
      "#ffffff";

    maskContext.beginPath();

    maskContext.moveTo(
      last.x,
      last.y
    );

    maskContext.lineTo(
      point.x,
      point.y
    );

    maskContext.stroke();

    const maskPixels =
      maskContext.getImageData(
        0,
        0,
        mask.width,
        mask.height
      );

    const currentPixels =
      context.getImageData(
        0,
        0,
        editor.canvas.width,
        editor.canvas.height
      );

    const original =
      editor.originalPixels;

    if (original) {
      for (
        let i = 0;
        i < maskPixels.data.length;
        i += 4
      ) {
        const alpha =
          maskPixels.data[i + 3];

        if (alpha > 0) {
          const amount =
            alpha / 255;

          for (let channel = 0;
            channel < 4;
            channel++
          ) {
            currentPixels.data[
              i + channel
            ] =
              currentPixels.data[
                i + channel
              ] * (1 - amount) +
              original.data[
                i + channel
              ] * amount;
          }
        }
      }

      context.putImageData(
        currentPixels,
        0,
        0
      );
    }
  }

  context.restore();

  editor.lastPoint = point;

  editor.currentImage =
    editor.canvas.toDataURL(
      "image/png"
    );
}

function installEditorBrush() {
  const canvas = $("editCanvas");

  if (!canvas) {
    return;
  }

  canvas.addEventListener(
    "pointerdown",
    event => {
      if (!editor.context) {
        return;
      }

      event.preventDefault();

      editorHistory();

      editor.painting = true;

      editor.lastPoint =
        editorPoint(event);

      canvas.setPointerCapture(
        event.pointerId
      );

      paintEditor(event);
    }
  );

  canvas.addEventListener(
    "pointermove",
    event => {
      if (!editor.painting) {
        return;
      }

      event.preventDefault();

      paintEditor(event);
    }
  );

  const finish = () => {
    editor.painting = false;
    editor.lastPoint = null;
  };

  canvas.addEventListener(
    "pointerup",
    finish
  );

  canvas.addEventListener(
    "pointercancel",
    finish
  );

  click("eraseMode", () => {
    editor.mode = "erase";

    status("🧽 已切換擦除筆刷");
  });

  click("restoreMode", () => {
    editor.mode = "restore";

    status("🖌️ 已切換還原筆刷");
  });

  click("undoEdit", undoEditor);

  click("resetEdit", resetEditor);

  click("closeEditor", () => {
    modal("editorModal", false);
  });
}

/* =========================================================
   10｜AI 去背

   使用一評的 removeBackgroundAI API。
========================================================= */

function normalizeAIImage(result) {
  if (!result) {
    throw new Error(
      "AI 沒有回傳圖片"
    );
  }

  if (typeof result === "string") {
    if (
      result.startsWith("data:image/")
    ) {
      return result;
    }

    if (
      result.startsWith("https://")
    ) {
      return result;
    }

    /*
      OpenAI 可能回傳純 base64。
    */

    return (
      "data:image/png;base64," +
      result
    );
  }

  const possible = [
    result.image,
    result.imageData,
    result.dataUrl,
    result.dataURL,
    result.url,
    result.result,
    result.b64_json,
    result.base64
  ];

  for (const value of possible) {
    if (
      typeof value === "string" &&
      value.length > 0
    ) {
      return normalizeAIImage(value);
    }
  }

  throw new Error(
    "AI 回傳格式中找不到圖片"
  );
}

async function aiRemoveBg() {
  if (
    !editor.canvas ||
    !editor.context
  ) {
    throw new Error(
      "請先拍照或上傳圖片"
    );
  }

  const button = $("removeBgAI");

  if (button) {
    button.disabled = true;
    button.textContent =
      "⏳ AI 正在去背……";
  }

  status(
    "🤖 AI 正在保留積木並移除背景……"
  );

  try {
    const source =
      editor.canvas.toDataURL(
        "image/png"
      );

    const result = await callAI(
      "removeBackgroundAI",
      {
        image: await scaledData(
          source,
          1024
        )
      },
      180000
    );

    const imageSource =
      normalizeAIImage(result);

    const image =
      await imageLoad(
        imageSource
      );

    editorHistory();

    editor.canvas.width =
      image.width;

    editor.canvas.height =
      image.height;

    editor.context =
      editor.canvas.getContext(
        "2d",
        {
          willReadFrequently: true
        }
      );

    editor.context.clearRect(
      0,
      0,
      image.width,
      image.height
    );

    editor.context.drawImage(
      image,
      0,
      0
    );

    editor.currentImage =
      editor.canvas.toDataURL(
        "image/png"
      );

    /*
      關鍵：

      去背成功後立即加入世界，
      不等待 AI 辨識或生成背景。
    */

    await saveEditor({
      fromAI: true
    });

    status(
      "✨ 去背完成！積木已進入世界，AI 正在理解作品。"
    );
  } catch (error) {
    status(
      "❌ AI 去背失敗：" +
      error.message
    );

    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent =
        "🤖 AI 自動去背";
    }
  }
}

/* =========================================================
   10-A｜快速去背

   一評的手動輔助功能。
========================================================= */

function quickRemoveBg() {
  if (
    !editor.canvas ||
    !editor.context
  ) {
    return;
  }

  editorHistory();

  const canvas = editor.canvas;

  const context = editor.context;

  const image =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

  const data = image.data;

  const corners = [
    0,
    (canvas.width - 1) * 4,
    (
      (canvas.height - 1) *
      canvas.width
    ) * 4,
    (
      canvas.width *
      canvas.height - 1
    ) * 4
  ];

  const background = [
    0,
    0,
    0
  ];

  for (const offset of corners) {
    background[0] += data[offset];
    background[1] += data[offset + 1];
    background[2] += data[offset + 2];
  }

  background[0] /= corners.length;
  background[1] /= corners.length;
  background[2] /= corners.length;

  const threshold = 46;

  for (
    let i = 0;
    i < data.length;
    i += 4
  ) {
    const distance = Math.sqrt(
      (
        data[i] -
        background[0]
      ) ** 2 +
      (
        data[i + 1] -
        background[1]
      ) ** 2 +
      (
        data[i + 2] -
        background[2]
      ) ** 2
    );

    if (distance < threshold) {
      data[i + 3] = 0;
    }
  }

  context.putImageData(
    image,
    0,
    0
  );

  editor.currentImage =
    canvas.toDataURL(
      "image/png"
    );

  status(
    "✨ 快速去背完成，可以繼續修正或放入世界"
  );
}

/* =========================================================
   11｜去背後立即加入世界

   不等待 AI 辨識。
========================================================= */

async function saveEditor(options = {}) {
  if (!editor.canvas) {
    throw new Error(
      "沒有可以儲存的積木圖片"
    );
  }

  const image =
    editor.canvas.toDataURL(
      "image/png"
    );

  /*
    修改既有作品時，
    不建立重複角色。
  */

  if (editor.targetCreationId) {
    const creation =
      creationById(
        editor.targetCreationId
      );

    if (!creation) {
      throw new Error(
        "找不到要修改的作品"
      );
    }

    creation.originalImage = image;

    creation.displayImage = image;

    creation.transformedImage = null;

    creation.updatedAt =
      Date.now();

    updateCreationVisual(
      creation
    );

    modal("editorModal", false);

    bubble(
      "✨ 你的積木作品已經更新！"
    );

    return creation;
  }

  const description =
    $("creationDescription")?.value
      ?.trim() || "";

  const creation =
    createPlusPlusRecord({
      image,
      description,
      source: "camera"
    });

  state.creations.push(
    creation
  );

  state.selectedId =
    creation.id;

  /*
    保留與一評 heroes 的相容資料。

    角色與環境在 AI 分類前，
    都先以原始積木作品呈現。
  */

  const hero = {
    id: creation.id,

    name: "我的積木作品",

    image: creation.originalImage,

    originalImage:
      creation.originalImage,

    currentImage:
      creation.displayImage,

    transformedImage: null,

    role: "pending",

    x: creation.x,

    y: creation.y,

    scale: creation.scale,

    rotation: creation.rotation,

    personality: "",

    abilities: [],

    createdAt:
      creation.createdAt
  };

  state.heroes.push(
    hero
  );

  /*
    立即繪製作品。

    這個函式會在後續世界繪製段落實作。
  */

  createCreationVisual(
    creation
  );

  refreshHeroes();

  /*
    關閉編輯器與攝影機，
    讓孩子直接看到作品。
  */

  modal("editorModal", false);

  await closeCamera();

  bubble(
    "🧩 你的 Plus-Plus 積木進入世界了！"
  );

  status(
    "✨ 作品已加入世界，正在等待 AI 辨識"
  );

  /*
    AI 辨識在背景執行，
    不阻擋原始積木進入世界。
  */

  Promise.resolve()
    .then(() =>
      analyzePlusPlusCreation(
        creation.id
      )
    )
    .catch(error => {
      console.error(error);

      status(
        "⚠️ AI 辨識暫時失敗，可以稍後重新辨識"
      );
    });

  return creation;
}

/* =========================================================
   11-A｜更新既有作品的畫面
========================================================= */

function updateCreationVisual(creation) {
  const element =
    document.querySelector(
      '[data-creation-id="' +
      creation.id +
      '"]'
    );

  if (!element) {
    return;
  }

  const image =
    element.querySelector("img");

  if (image) {
    image.src =
      creation.displayImage;
  }
}

/* =========================================================
   12｜AI 作品辨識

   使用新版 Code.gs 的 analyzeCreation。
========================================================= */

async function analyzePlusPlusCreation(
  creationId
) {
  const creation =
    creationById(creationId);

  if (!creation) {
    return;
  }

  creation.analysisStatus =
    "analyzing";

  state.pendingCreationId =
    creationId;

  status(
    "🧠 AI 正在觀察 Plus-Plus 作品……"
  );

  try {
    const result = await callAI(
      "analyzeCreation",
      {
        image: await scaledData(
          creation.originalImage,
          900
        ),

        description:
          creation.description,

        style:
          "Plus-Plus interlocking building blocks",

        allowedRoles: [
          "character",
          "environment"
        ]
      },
      120000
    );

    /*
      允許新版後端回傳：
      result.role
      result.category
      result.kind
    */

    let role =
      String(
        result?.role ||
        result?.category ||
        result?.kind ||
        "character"
      ).toLowerCase();

    if (
      role !== "character" &&
      role !== "environment"
    ) {
      role = "character";
    }

    creation.analysis = result;

    creation.analysisStatus =
      "completed";

    creation.name =
      String(
        result?.name ||
        creation.name ||
        "我的積木作品"
      );

    creation.personality =
      String(
        result?.personality ||
        ""
      );

    state.suggestedCreationRole =
      role;

    /*
      只顯示分類確認視窗。

      不刪除已經進入世界的作品。
    */

    showClassification(
      creation,
      role,
      result
    );

    status(
      "✨ AI 已完成辨識，等待孩子確認"
    );
  } catch (error) {
    creation.analysisStatus =
      "failed";

    /*
      即使 AI 辨識失敗，
      原始作品也繼續留在世界裡。
    */

    showClassification(
      creation,
      "character",
      {
        explanation:
          "AI 暫時無法辨識，你可以自己決定這是角色還是環境。"
      }
    );

    throw error;
  }
}

/* =========================================================
   12-A｜分類確認視窗
========================================================= */

function showClassification(
  creation,
  suggestedRole,
  analysis = {}
) {
  state.pendingCreationId =
    creation.id;

  state.selectedCreationRole =
    suggestedRole;

  const preview =
    $("classificationPreview");

  if (preview) {
    preview.src =
      creation.originalImage;
  }

  const description =
    $("classificationDescription");

  if (description) {
    description.value =
      creation.description || "";
  }

  const message =
    $("classificationMessage");

  if (message) {
    const roleName =
      suggestedRole === "environment"
        ? "環境 Environment"
        : "角色 Character";

    message.textContent =
      "AI 認為這是「" +
      roleName +
      "」。" +
      (
        analysis.explanation ||
        analysis.reason ||
        "你可以確認或更正 AI 的判斷。"
      );
  }

  updateClassificationButtons();

  modal(
    "classificationModal",
    true
  );
}

function updateClassificationButtons() {
  const character =
    $("classifyCharacter");

  const environment =
    $("classifyEnvironment");

  if (character) {
    character.classList.toggle(
      "active",
      state.selectedCreationRole ===
        "character"
    );
  }

  if (environment) {
    environment.classList.toggle(
      "active",
      state.selectedCreationRole ===
        "environment"
    );
  }
}

function setCreationMode(role) {
  if (
    role !== "character" &&
    role !== "environment"
  ) {
    return;
  }

  state.selectedCreationRole =
    role;

  updateClassificationButtons();

  const hint =
    $("creationModeHint");

  if (hint) {
    hint.textContent =
      role === "character"
        ? "🐠 角色會活動、互動，AI 會依角色特質延伸世界。"
        : "🌳 環境會延伸成 Plus-Plus 場景，並播放三秒特效。";
  }
}

/* =========================================================
   13｜確認分類並啟動世界生成
========================================================= */

async function confirmClassification() {
  const creation =
    creationById(
      state.pendingCreationId
    );

  if (!creation) {
    throw new Error(
      "找不到等待確認的作品"
    );
  }

  const role =
    state.selectedCreationRole;

  if (
    role !== "character" &&
    role !== "environment"
  ) {
    throw new Error(
      "請選擇角色或環境"
    );
  }

  const description =
    $("classificationDescription")
      ?.value?.trim() || "";

  creation.role = role;

  creation.description =
    description;

  creation.updatedAt =
    Date.now();

  const hero =
    state.heroes.find(
      item =>
        item.id === creation.id
    );

  if (hero) {
    hero.role = role;

    hero.name =
      creation.name ||
      (
        role === "character"
          ? "積木角色"
          : "積木環境"
      );
  }

  modal(
    "classificationModal",
    false
  );

  refreshHeroes();

  /*
    分類後，角色與環境走不同路線。

    但兩條路線都匯入同一個世界，
    不會清空已有內容。

    generateCreationWorld 將在
    後續段落實作。
  */

  if (role === "character") {
    bubble(
      "✨ AI 正在為你的積木角色創造適合的世界！"
    );
  } else {
    bubble(
      "🌳 AI 正在延伸你的 Plus-Plus 積木場景！"
    );
  }

  status(
    "🌍 開始生成 Plus-Plus 想像世界"
  );

  /*
    不等待生成完成才關閉分類視窗。
  */

  Promise.resolve()
    .then(() =>
      generateCreationWorld(
        creation.id
      )
    )
    .catch(error => {
      status(
        "⚠️ 世界生成失敗：" +
        error.message
      );
    });

  return creation;
}

/* =========================================================
   13-A｜分類操作按鈕
========================================================= */

function installClassificationButtons() {
  click(
    "classifyCharacter",
    () => {
      setCreationMode(
        "character"
      );
    }
  );

  click(
    "classifyEnvironment",
    () => {
      setCreationMode(
        "environment"
      );
    }
  );

  click(
    "confirmClassification",
    confirmClassification
  );

  click(
    "closeClassification",
    () => {
      modal(
        "classificationModal",
        false
      );

      /*
        稍後再決定時，
        原始積木仍留在世界裡。
      */
    }
  );

  click(
    "characterModeButton",
    () => {
      setCreationMode(
        "character"
      );
    }
  );

  click(
    "environmentModeButton",
    () => {
      setCreationMode(
        "environment"
      );
    }
  );
}

/* =========================================================
   13-B｜攝影與編輯按鈕
========================================================= */

function installCameraAndEditorButtons() {
  /*
    右側工作台拍照
  */

  click(
    "openCamera",
    openCamera
  );

  /*
    懸浮拍照泡泡
  */

  click(
    "bubbleCamera",
    openCamera
  );

  click(
    "captureButton",
    capturePhoto
  );

  click(
    "switchCamera",
    switchCamera
  );

  click(
    "retryCamera",
    openCamera
  );

  click(
    "closeCamera",
    closeCamera
  );

  /*
    上傳圖片
  */

  click(
    "uploadPhoto",
    () => {
      $("photoFile")?.click();
    }
  );

  $("photoFile")?.addEventListener(
    "change",
    async event => {
      const file =
        event.target.files?.[0];

      if (!file) {
        return;
      }

      try {
        const source =
          await fileData(file);

        await openEditor(
          source,
          null
        );
      } catch (error) {
        status(
          "❌ 圖片載入失敗：" +
          error.message
        );
      } finally {
        event.target.value = "";
      }
    }
  );

  /*
    AI 去背
  */

  click(
    "removeBgAI",
    aiRemoveBg
  );

  /*
    一評快速去背
  */

  click(
    "removeBg",
    quickRemoveBg
  );

  /*
    手動儲存去背結果
  */

  click(
    "saveEditor",
    () => saveEditor()
  );

  /*
    安裝擦除與還原筆刷
  */

  installEditorBrush();
}

/* ===== sketch.js 第二段結束 ===== */

/* =========================================================
   MINDSPACE PLUS-PLUS
   sketch.js — PART 3

   14｜世界圖層
   15｜原始積木立即顯示
   16｜角色自主活動
   17｜AI 世界生成
   18｜AI 背景顯示
   19｜環境延伸
   20｜三秒特效
   21｜世界持續累積

   接續 PART 2
========================================================= */

/* =========================================================
   14｜世界顯示狀態
========================================================= */

const plusPlusWorld = {
  canvas: null,
  p5Instance: null,

  initialized: false,

  backgroundImages: new Map(),

  creationImages: new Map(),

  environmentImages: new Map(),

  effectImages: new Map(),

  backgroundLayers: [],

  environmentLayers: [],

  particles: [],

  lastTime: 0
};

/* =========================================================
   14-A｜取得世界尺寸
========================================================= */

function worldSize() {
  const element = $("world");

  return {
    width:
      element?.clientWidth ||
      window.innerWidth,

    height:
      element?.clientHeight ||
      window.innerHeight
  };
}

/* =========================================================
   14-B｜取得安全的 AI 圖片
========================================================= */

function extractGeneratedImage(result) {
  if (!result) {
    return null;
  }

  if (typeof result === "string") {
    return normalizeAIImage(result);
  }

  const candidates = [
    result.image,
    result.background,
    result.backgroundImage,
    result.generatedImage,
    result.imageData,
    result.dataUrl,
    result.dataURL,
    result.url,
    result.base64
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.length > 0
    ) {
      return normalizeAIImage(candidate);
    }
  }

  return null;
}

/* =========================================================
   14-C｜載入圖片並快取
========================================================= */

async function cachePlusPlusImage(
  cache,
  key,
  source
) {
  if (!source) {
    return null;
  }

  if (cache.has(key)) {
    return cache.get(key);
  }

  const image =
    await imageLoad(source);

  cache.set(key, image);

  return image;
}

/* =========================================================
   15｜原始積木立即進入世界

   這裡使用 DOM 圖片圖層。

   好處：
   - 去背成功即可顯示
   - 不需要等待 p5.js 載入圖片
   - 保留原始積木完整顏色
   - 可以持續增加多個作品
========================================================= */

function createCreationVisual(creation) {
  if (!creation) {
    return;
  }

  const container = $("actors");

  if (!container) {
    console.warn(
      "找不到 actors 圖層"
    );
    return;
  }

  let element =
    container.querySelector(
      '[data-creation-id="' +
      creation.id +
      '"]'
    );

  if (!element) {
    element =
      document.createElement("div");

    element.className =
      "plusplus-creation";

    element.dataset.creationId =
      creation.id;

    element.style.position =
      "absolute";

    element.style.left = "0";
    element.style.top = "0";

    element.style.width =
      "min(24vw, 230px)";

    element.style.height =
      "min(24vw, 230px)";

    element.style.transformOrigin =
      "center center";

    element.style.pointerEvents =
      "auto";

    element.style.cursor =
      "pointer";

    element.style.userSelect =
      "none";

    element.style.touchAction =
      "none";

    const image =
      document.createElement("img");

    image.src =
      creation.displayImage;

    image.alt =
      "Plus-Plus 積木作品";

    image.draggable = false;

    image.style.width =
      "100%";

    image.style.height =
      "100%";

    image.style.objectFit =
      "contain";

    image.style.pointerEvents =
      "none";

    element.appendChild(image);

    container.appendChild(element);

    element.addEventListener(
      "click",
      event => {
        event.stopPropagation();

        state.selectedId =
          creation.id;

        refreshHeroes();

        bubble(
          "🧩 已選擇：" +
          (
            creation.name ||
            "我的積木作品"
          )
        );
      }
    );
  }

  /*
    初始位置：

    使用百分比座標，
    適應不同螢幕尺寸。
  */

  if (!creation.motion) {
    creation.motion = {
      vx: 0,
      vy: 0,

      direction:
        Math.random() < 0.5
          ? -1
          : 1,

      phase:
        Math.random() *
        Math.PI * 2,

      targetX:
        creation.x,

      targetY:
        creation.y,

      nextDecision:
        performance.now() + 2000
    };
  }

  updateCreationPosition(
    creation
  );

  return element;
}

/* =========================================================
   15-A｜更新積木位置
========================================================= */

function updateCreationPosition(creation) {
  const element =
    $("actors")?.querySelector(
      '[data-creation-id="' +
      creation.id +
      '"]'
    );

  if (!element) {
    return;
  }

  const size = worldSize();

  const x =
    creation.x * size.width;

  const y =
    creation.y * size.height;

  const scale =
    Number(
      creation.scale || 1
    );

  const rotation =
    Number(
      creation.rotation || 0
    );

  const facing =
    creation.motion?.direction || 1;

  element.style.transform =
    "translate(" +
    (
      x -
      element.offsetWidth / 2
    ) +
    "px," +
    (
      y -
      element.offsetHeight / 2
    ) +
    "px) " +
    "rotate(" +
    rotation +
    "deg) " +
    "scale(" +
    scale * facing +
    "," +
    scale +
    ")";
}

/* =========================================================
   15-B｜刷新作品列表

   同時保留一評的 selectedHero。
========================================================= */

function refreshHeroes() {
  const list = $("heroList");

  const select =
    $("selectedHero");

  if (list) {
    list.innerHTML = "";
  }

  if (select) {
    select.innerHTML = "";
  }

  if (
    state.creations.length === 0
  ) {
    if (list) {
      list.textContent =
        "還沒有加入作品";
    }

    if (select) {
      const option =
        document.createElement(
          "option"
        );

      option.value = "";

      option.textContent =
        "請先加入作品";

      select.appendChild(option);
    }

    return;
  }

  for (
    const creation of
    state.creations
  ) {
    const name =
      creation.name ||
      (
        creation.role === "environment"
          ? "積木環境"
          : creation.role === "character"
            ? "積木角色"
            : "等待 AI 辨識"
      );

    const icon =
      creation.role === "environment"
        ? "🌳"
        : creation.role === "character"
          ? "🐠"
          : "🧩";

    if (list) {
      const button =
        document.createElement(
          "button"
        );

      button.type = "button";

      button.textContent =
        icon + " " + name;

      button.style.width =
        "100%";

      button.style.marginBottom =
        "7px";

      button.style.textAlign =
        "left";

      if (
        creation.id ===
        state.selectedId
      ) {
        button.style.background =
          "#d5eeff";
      }

      button.addEventListener(
        "click",
        () => {
          state.selectedId =
            creation.id;

          refreshHeroes();
        }
      );

      list.appendChild(button);
    }

    if (select) {
      const option =
        document.createElement(
          "option"
        );

      option.value =
        creation.id;

      option.textContent =
        icon + " " + name;

      select.appendChild(option);
    }
  }

  if (select) {
    select.value =
      state.selectedId || "";
  }
}

/* =========================================================
   16｜角色自主活動

   注意：

   AI 決定角色的性格、動作傾向，
   前端負責持續播放動作。

   不用固定「魚只能游泳」的判斷。
========================================================= */

function initializeCharacterMotion(
  creation
) {
  if (!creation.motion) {
    creation.motion = {};
  }

  const motion =
    creation.motion;

  const analysis =
    creation.analysis || {};

  const behavior =
    analysis.behavior || {};

  motion.speed =
    clamp(
      Number(
        behavior.speed ||
        analysis.speed ||
        1
      ),
      0.2,
      4
    );

  motion.energy =
    clamp(
      Number(
        behavior.energy ||
        analysis.energy ||
        0.5
      ),
      0,
      1
    );

  motion.wander =
    clamp(
      Number(
        behavior.wander ||
        0.6
      ),
      0,
      1
    );

  motion.bob =
    clamp(
      Number(
        behavior.bob ||
        0.5
      ),
      0,
      1
    );

  motion.direction =
    motion.direction || 1;

  motion.phase =
    motion.phase ||
    Math.random() *
    Math.PI * 2;

  motion.targetX =
    creation.x;

  motion.targetY =
    creation.y;

  motion.nextDecision =
    performance.now() + 1000;
}

/* =========================================================
   16-A｜角色每幀活動
========================================================= */

function animatePlusPlusCharacters(
  deltaTime
) {
  const dt =
    Math.min(
      deltaTime / 1000,
      0.05
    );

  const now =
    performance.now();

  for (
    const creation of
    state.creations
  ) {
    if (
      creation.role !== "character"
    ) {
      continue;
    }

    if (!creation.motion) {
      initializeCharacterMotion(
        creation
      );
    }

    const motion =
      creation.motion;

    if (
      now >=
      motion.nextDecision
    ) {
      /*
        隨機探索只負責基本活動。

        AI 指定的事件動作，
        會在後續 ai-director.js
        使用獨立的動畫控制。
      */

      motion.targetX =
        clamp(
          creation.x +
          (
            Math.random() - 0.5
          ) *
          0.5 *
          motion.wander,
          0.12,
          0.88
        );

      motion.targetY =
        clamp(
          creation.y +
          (
            Math.random() - 0.5
          ) *
          0.35 *
          motion.wander,
          0.16,
          0.83
        );

      motion.nextDecision =
        now +
        1400 +
        Math.random() * 3200;
    }

    const dx =
      motion.targetX -
      creation.x;

    const dy =
      motion.targetY -
      creation.y;

    const distance =
      Math.hypot(dx, dy);

    if (distance > 0.003) {
      const step =
        motion.speed *
        0.09 *
        dt;

      creation.x +=
        dx / distance *
        Math.min(
          distance,
          step
        );

      creation.y +=
        dy / distance *
        Math.min(
          distance,
          step
        );

      if (
        Math.abs(dx) > 0.01
      ) {
        motion.direction =
          dx >= 0 ? 1 : -1;
      }
    }

    /*
      微幅漂浮：

      使用 CSS transform，
      不永久改動座標。
    */

    const bob =
      Math.sin(
        now * 0.002 *
        motion.speed +
        motion.phase
      ) *
      motion.bob *
      4;

    updateCreationPosition(
      creation
    );

    const element =
      $("actors")?.querySelector(
        '[data-creation-id="' +
        creation.id +
        '"]'
      );

    if (element) {
      element.style.marginTop =
        bob + "px";
    }
  }
}

/* =========================================================
   16-B｜角色與環境分離

   環境不會套用自主移動。
========================================================= */

function applyCreationRole(creation) {
  if (!creation) {
    return;
  }

  if (
    creation.role === "character"
  ) {
    initializeCharacterMotion(
      creation
    );
  }

  if (
    creation.role === "environment"
  ) {
    const element =
      $("actors")?.querySelector(
        '[data-creation-id="' +
        creation.id +
        '"]'
      );

    if (element) {
      element.style.pointerEvents =
        "auto";
    }
  }

  updateCreationPosition(
    creation
  );
}

/* =========================================================
   17｜Plus-Plus 風格規則

   這些規則會傳給 Code.gs，
   作為 AI 生成的共同視覺限制。
========================================================= */

const PLUSPLUS_STYLE = [
  "Every generated visual element must be built",
  "from recognizable Plus-Plus interlocking",
  "plastic construction toy pieces.",
  "Preserve the distinctive plus-shaped",
  "interlocking geometry and physical",
  "connections between pieces.",
  "Use colorful tangible plastic materials.",
  "Do not replace the user's photographed",
  "creation with a generic cartoon character.",
  "The photographed creation remains the",
  "identity and visual foundation.",
  "Generated backgrounds, buildings,",
  "landscapes, accessories, supporting",
  "characters, props and effects must all",
  "share the same Plus-Plus toy aesthetic.",
  "Children's unusual imaginative ideas",
  "must not be normalized into realistic",
  "or conventional forms."
].join(" ");

/* =========================================================
   17-A｜取得目前世界摘要

   AI 必須知道已經有哪些作品，
   才能讓新內容融入現有世界。
========================================================= */

function getPlusPlusWorldContext() {
  return {
    initialized:
      state.worldInitialized,

    activeBackgroundId:
      state.activeBackgroundId,

    creations:
      state.creations.map(
        creation => ({
          id: creation.id,

          role: creation.role,

          name: creation.name,

          description:
            creation.description,

          personality:
            creation.personality,

          abilities:
            creation.abilities,

          x: creation.x,

          y: creation.y
        })
      ),

    backgrounds:
      state.generatedWorlds.map(
        background => ({
          id: background.id,

          description:
            background.description,

          sourceCreationId:
            background.sourceCreationId
        })
      ),

    environments:
      state.environments.map(
        environment => ({
          id: environment.id,

          description:
            environment.description,

          sourceCreationId:
            environment.sourceCreationId
        })
      ),

    objects:
      state.generatedObjects.map(
        object => ({
          id: object.id,

          name: object.name,

          description:
            object.description
        })
      )
  };
}

/* =========================================================
   17-B｜依分類生成世界
========================================================= */

async function generateCreationWorld(
  creationId
) {
  const creation =
    creationById(creationId);

  if (!creation) {
    throw new Error(
      "找不到要生成世界的作品"
    );
  }

  if (
    creation.role !== "character" &&
    creation.role !== "environment"
  ) {
    throw new Error(
      "請先確認角色或環境分類"
    );
  }

  const existingJob =
    state.generationJobs.get(
      creationId
    );

  if (existingJob) {
    return existingJob;
  }

  const job =
    (async () => {
      creation.worldStatus =
        "generating";

      const progress =
        $("creationProgress");

      if (progress) {
        progress.textContent =
          "✨ AI 正在延伸 Plus-Plus 世界……";
      }

      try {
        if (
          creation.role ===
          "character"
        ) {
          await generateCharacterWorld(
            creation
          );
        } else {
          await generateEnvironmentWorld(
            creation
          );
        }

        creation.worldStatus =
          "completed";

        state.worldInitialized =
          true;

        state.worldRevision++;

        if (progress) {
          progress.textContent =
            "✅ Plus-Plus 世界生成完成";
        }

        status(
          "🌈 世界已更新，原有作品全部保留"
        );
      } catch (error) {
        creation.worldStatus =
          "failed";

        if (progress) {
          progress.textContent =
            "⚠️ 世界生成失敗，可以重試";
        }

        throw error;
      }
    })();

  state.generationJobs.set(
    creationId,
    job
  );

  try {
    return await job;
  } finally {
    state.generationJobs.delete(
      creationId
    );
  }
}

/* =========================================================
   18｜角色路線

   AI 分析角色特質，
   自主生成適合的 Plus-Plus 背景。

   例如：
   積木魚 → 積木海底世界
   積木太空生物 → 積木星球世界

   但不使用固定關鍵字 if。
========================================================= */

async function generateCharacterWorld(
  creation
) {
  applyCreationRole(
    creation
  );

  bubble(
    "✨ AI 正在為你的角色想像一個世界……"
  );

  const result = await callAI(
    "generateWorld",
    {
      mode: "character",

      image:
        await scaledData(
          creation.originalImage,
          850
        ),

      creation: {
        id: creation.id,

        name: creation.name,

        description:
          creation.description,

        personality:
          creation.personality,

        analysis:
          creation.analysis
      },

      world:
        getPlusPlusWorldContext(),

      style:
        PLUSPLUS_STYLE,

      preserveOriginal:
        true,

      accumulate:
        true
    },
    240000
  );

  /*
    第一件作品可以建立主要背景。

    已經有世界時，
    新生成內容應融入現有世界。
  */

  await applyGeneratedWorld(
    result,
    creation,
    "character"
  );

  bubble(
    "🌈 你的角色有自己的 Plus-Plus 世界了！"
  );

  return result;
}

/* =========================================================
   19｜環境路線

   以原始積木環境為基礎，
   延伸成 Plus-Plus 場景，
   並播放三秒特效。
========================================================= */

async function generateEnvironmentWorld(
  creation
) {
  applyCreationRole(
    creation
  );

  bubble(
    "🌳 AI 正在延伸你的積木場景……"
  );

  const result = await callAI(
    "generateWorld",
    {
      mode: "environment",

      image:
        await scaledData(
          creation.originalImage,
          850
        ),

      creation: {
        id: creation.id,

        name: creation.name,

        description:
          creation.description,

        analysis:
          creation.analysis
      },

      world:
        getPlusPlusWorldContext(),

      style:
        PLUSPLUS_STYLE,

      preserveOriginal:
        true,

      accumulate:
        true,

      effectDuration:
        3000
    },
    240000
  );

  await applyGeneratedWorld(
    result,
    creation,
    "environment"
  );

  /*
    環境專屬三秒特效。
  */

  const effect =
    result?.effect ||
    result?.sceneEffect ||
    result?.animation ||
    null;

  if (effect) {
    playPlusPlusEnvironmentEffect(
      effect,
      creation
    );
  }

  bubble(
    "✨ 你的積木環境已經延伸成想像世界！"
  );

  return result;
}

/* =========================================================
   19-A｜解析 AI 生成結果

   允許後端回傳：
   - background
   - environment
   - layers
   - description
   - effect

   但不直接清空現有世界。
========================================================= */

async function applyGeneratedWorld(
  result,
  creation,
  mode
) {
  if (!result) {
    throw new Error(
      "AI 沒有回傳世界生成結果"
    );
  }

  const description =
    String(
      result.description ||
      result.worldDescription ||
      result.scene ||
      ""
    );

  const backgroundSource =
    extractGeneratedImage(
      result
    );

  if (backgroundSource) {
    const background = {
      id: uid(),

      sourceCreationId:
        creation.id,

      mode,

      image:
        backgroundSource,

      description,

      createdAt:
        Date.now()
    };

    state.generatedWorlds.push(
      background
    );

    await addPlusPlusBackground(
      background
    );
  }

  /*
    額外環境圖層：

    AI 可以生成建築、地形、
    植物等獨立物件。
  */

  const layers =
    Array.isArray(result.layers)
      ? result.layers
      : [];

  for (const layer of layers) {
    await addPlusPlusEnvironmentLayer(
      layer,
      creation
    );
  }

  /*
    環境類型作品：
    保留原始積木作為場景的一部分。
  */

  if (
    mode === "environment"
  ) {
    creation.isWorldElement =
      true;
  }

  state.worldRevision++;
}

/* =========================================================
   19-B｜加入背景

   第一個背景可以覆蓋全畫面。

   後續背景以獨立圖層加入，
   不刪除舊背景。
========================================================= */

async function addPlusPlusBackground(
  background
) {
  const container =
    $("generatedBackground");

  if (!container) {
    return;
  }

  const image =
    await imageLoad(
      background.image
    );

  plusPlusWorld.backgroundImages.set(
    background.id,
    image
  );

  const layer =
    document.createElement("div");

  layer.className =
    "plusplus-background-layer";

  layer.dataset.backgroundId =
    background.id;

  layer.style.position =
    "absolute";

  layer.style.inset = "0";

  layer.style.backgroundImage =
    'url("' +
    background.image +
    '")';

  layer.style.backgroundSize =
    "cover";

  layer.style.backgroundPosition =
    "center";

  layer.style.backgroundRepeat =
    "no-repeat";

  layer.style.pointerEvents =
    "none";

  layer.style.opacity = "0";

  layer.style.transition =
    "opacity 1.4s ease";

  /*
    如果是第一個背景，
    直接成為世界主背景。

    如果已經存在背景，
    新背景作為疊加圖層，
    不刪除舊資料。
  */

  if (
    state.activeBackgroundId === null
  ) {
    layer.style.zIndex = "1";

    state.activeBackgroundId =
      background.id;
  } else {
    layer.style.zIndex =
      String(
        state.generatedWorlds.length
      );

    /*
      多個全畫面背景不能直接
      完全不透明覆蓋。

      先採用半透明融合，
      後續 ai-director.js
      可以依 AI 的場景規劃
      控制區域與轉場。
    */

    layer.style.mixBlendMode =
      "normal";

    layer.dataset.composite =
      "overlay";
  }

  container.appendChild(layer);

  requestAnimationFrame(() => {
    layer.style.opacity =
      layer.dataset.composite ===
      "overlay"
        ? "0.45"
        : "1";
  });

  plusPlusWorld.backgroundLayers.push(
    {
      id: background.id,
      element: layer
    }
  );
}

/* =========================================================
   19-C｜加入獨立環境圖層
========================================================= */

async function addPlusPlusEnvironmentLayer(
  layer,
  creation
) {
  if (!layer) {
    return null;
  }

  const source =
    extractGeneratedImage(
      layer
    );

  if (!source) {
    return null;
  }

  const environment = {
    id: uid(),

    sourceCreationId:
      creation.id,

    image: source,

    description:
      String(
        layer.description ||
        ""
      ),

    x:
      clamp(
        Number(
          layer.x ?? 0.5
        ),
        0,
        1
      ),

    y:
      clamp(
        Number(
          layer.y ?? 0.5
        ),
        0,
        1
      ),

    width:
      clamp(
        Number(
          layer.width ?? 0.4
        ),
        0.05,
        1
      ),

    height:
      clamp(
        Number(
          layer.height ?? 0.4
        ),
        0.05,
        1
      ),

    createdAt:
      Date.now()
  };

  state.environments.push(
    environment
  );

  const container =
    $("environmentLayer");

  if (!container) {
    return environment;
  }

  const element =
    document.createElement("img");

  element.src =
    environment.image;

  element.alt =
    environment.description ||
    "Plus-Plus 環境";

  element.dataset.environmentId =
    environment.id;

  element.style.position =
    "absolute";

  element.style.left =
    environment.x * 100 + "%";

  element.style.top =
    environment.y * 100 + "%";

  element.style.width =
    environment.width * 100 + "%";

  element.style.height =
    environment.height * 100 + "%";

  element.style.objectFit =
    "contain";

  element.style.transform =
    "translate(-50%, -50%)";

  element.style.pointerEvents =
    "none";

  element.style.opacity = "0";

  element.style.transition =
    "opacity 1s ease";

  container.appendChild(
    element
  );

  requestAnimationFrame(() => {
    element.style.opacity = "1";
  });

  plusPlusWorld.environmentLayers.push(
    {
      id: environment.id,
      element
    }
  );

  return environment;
}

/* =========================================================
   20｜AI 三秒環境特效

   AI 決定：
   - 特效外觀
   - 顏色
   - 粒子數量
   - 移動方向
   - 動畫速度
   - 是否旋轉

   前端不使用「森林 = 落葉」
   等固定關鍵字判斷。
========================================================= */

function normalizePlusPlusEffect(
  effect,
  creation
) {
  const input =
    typeof effect === "object" &&
    effect !== null
      ? effect
      : {
          description:
            String(effect)
        };

  return {
    id: uid(),

    sourceCreationId:
      creation.id,

    description:
      String(
        input.description ||
        input.name ||
        ""
      ),

    image:
      extractGeneratedImage(
        input
      ),

    count:
      clamp(
        Number(
          input.count ??
          input.particleCount ??
          35
        ),
        1,
        120
      ),

    direction:
      String(
        input.direction ||
        "down"
      ),

    speed:
      clamp(
        Number(
          input.speed ?? 1
        ),
        0.1,
        5
      ),

    rotation:
      Boolean(
        input.rotation ??
        true
      ),

    colors:
      Array.isArray(
        input.colors
      )
        ? input.colors
        : [
            "#ffb5d4",
            "#a7ddff",
            "#ffe49a",
            "#b3efce"
          ],

    duration: 3000,

    startedAt:
      performance.now(),

    particles: []
  };
}

/* =========================================================
   20-A｜播放環境特效
========================================================= */

function playPlusPlusEnvironmentEffect(
  effect,
  creation
) {
  const normalized =
    normalizePlusPlusEffect(
      effect,
      creation
    );

  const size =
    worldSize();

  for (
    let index = 0;
    index < normalized.count;
    index++
  ) {
    normalized.particles.push({
      x:
        Math.random() *
        size.width,

      y:
        Math.random() *
        size.height,

      vx:
        (
          Math.random() - 0.5
        ) * 60,

      vy:
        30 +
        Math.random() * 80,

      size:
        9 +
        Math.random() * 18,

      rotation:
        Math.random() *
        Math.PI * 2,

      rotationSpeed:
        (
          Math.random() - 0.5
        ) * 3,

      color:
        normalized.colors[
          index %
          normalized.colors.length
        ]
    });
  }

  state.effects.push(
    normalized
  );

  status(
    "✨ 正在播放三秒 Plus-Plus 環境特效"
  );

  return normalized;
}

/* =========================================================
   20-B｜畫出 Plus-Plus 積木形狀

   當 AI 沒有提供特效圖片時，
   使用可辨識的十字拼接積木形狀。

   這是通用形狀繪製器，
   不是固定語意技能清單。
========================================================= */

function drawPlusPlusPiece(
  context,
  x,
  y,
  size,
  color,
  rotation = 0
) {
  context.save();

  context.translate(
    x,
    y
  );

  context.rotate(
    rotation
  );

  const unit = size / 3;

  context.fillStyle =
    color;

  context.strokeStyle =
    "rgba(255,255,255,.55)";

  context.lineWidth =
    Math.max(
      1,
      size * 0.05
    );

  context.beginPath();

  context.moveTo(
    -unit / 2,
    -size / 2
  );

  context.lineTo(
    unit / 2,
    -size / 2
  );

  context.lineTo(
    unit / 2,
    -unit / 2
  );

  context.lineTo(
    size / 2,
    -unit / 2
  );

  context.lineTo(
    size / 2,
    unit / 2
  );

  context.lineTo(
    unit / 2,
    unit / 2
  );

  context.lineTo(
    unit / 2,
    size / 2
  );

  context.lineTo(
    -unit / 2,
    size / 2
  );

  context.lineTo(
    -unit / 2,
    unit / 2
  );

  context.lineTo(
    -size / 2,
    unit / 2
  );

  context.lineTo(
    -size / 2,
    -unit / 2
  );

  context.lineTo(
    -unit / 2,
    -unit / 2
  );

  context.closePath();

  context.fill();
  context.stroke();

  context.restore();
}

/* =========================================================
   20-C｜更新與繪製三秒特效
========================================================= */

function drawPlusPlusEffects(
  context,
  deltaTime
) {
  const now =
    performance.now();

  const dt =
    Math.min(
      deltaTime / 1000,
      0.05
    );

  const size =
    worldSize();

  state.effects =
    state.effects.filter(
      effect =>
        now - effect.startedAt <
        effect.duration
    );

  for (
    const effect of
    state.effects
  ) {
    const progress =
      (
        now -
        effect.startedAt
      ) /
      effect.duration;

    const alpha =
      clamp(
        1 -
        Math.max(
          0,
          progress - 0.7
        ) / 0.3,
        0,
        1
      );

    context.save();

    context.globalAlpha =
      alpha;

    for (
      const particle of
      effect.particles
    ) {
      particle.x +=
        particle.vx *
        effect.speed *
        dt;

      particle.y +=
        particle.vy *
        effect.speed *
        dt;

      if (effect.rotation) {
        particle.rotation +=
          particle.rotationSpeed *
          dt;
      }

      if (
        particle.y >
        size.height + 30
      ) {
        particle.y = -30;
      }

      if (
        particle.x >
        size.width + 30
      ) {
        particle.x = -30;
      }

      if (
        particle.x < -30
      ) {
        particle.x =
          size.width + 30;
      }

      drawPlusPlusPiece(
        context,

        particle.x,

        particle.y,

        particle.size,

        particle.color,

        particle.rotation
      );
    }

    context.restore();
  }
}

/* =========================================================
   20-D｜建立特效 Canvas
========================================================= */

function initializeEffectCanvas() {
  const container =
    $("effectLayer");

  if (!container) {
    return;
  }

  let canvas =
    container.querySelector(
      "canvas"
    );

  if (!canvas) {
    canvas =
      document.createElement(
        "canvas"
      );

    canvas.style.position =
      "absolute";

    canvas.style.inset =
      "0";

    canvas.style.width =
      "100%";

    canvas.style.height =
      "100%";

    canvas.style.pointerEvents =
      "none";

    container.appendChild(
      canvas
    );
  }

  plusPlusWorld.canvas =
    canvas;

  resizePlusPlusEffectCanvas();
}

function resizePlusPlusEffectCanvas() {
  const canvas =
    plusPlusWorld.canvas;

  if (!canvas) {
    return;
  }

  const size =
    worldSize();

  const ratio =
    Math.min(
      window.devicePixelRatio || 1,
      2
    );

  canvas.width =
    Math.round(
      size.width * ratio
    );

  canvas.height =
    Math.round(
      size.height * ratio
    );

  const context =
    canvas.getContext("2d");

  context.setTransform(
    ratio,
    0,
    0,
    ratio,
    0,
    0
  );
}

/* =========================================================
   21｜世界動畫主迴圈

   角色、環境特效同時更新。

   後續 ai-director.js
   會加入語音指令事件動畫。
========================================================= */

function startPlusPlusAnimationLoop() {
  if (
    plusPlusWorld.initialized
  ) {
    return;
  }

  plusPlusWorld.initialized =
    true;

  plusPlusWorld.lastTime =
    performance.now();

  function frame(now) {
    const deltaTime =
      Math.min(
        now -
        plusPlusWorld.lastTime,
        60
      );

    plusPlusWorld.lastTime =
      now;

    animatePlusPlusCharacters(
      deltaTime
    );

    const canvas =
      plusPlusWorld.canvas;

    if (canvas) {
      const context =
        canvas.getContext("2d");

      const size =
        worldSize();

      context.clearRect(
        0,
        0,
        size.width,
        size.height
      );

      drawPlusPlusEffects(
        context,
        deltaTime
      );
    }

    requestAnimationFrame(
      frame
    );
  }

  requestAnimationFrame(
    frame
  );
}

/* =========================================================
   21-A｜安裝世界系統
========================================================= */

function initializePlusPlusWorld() {
  initializeEffectCanvas();

  startPlusPlusAnimationLoop();

  window.addEventListener(
    "resize",
    () => {
      resizePlusPlusEffectCanvas();

      for (
        const creation of
        state.creations
      ) {
        updateCreationPosition(
          creation
        );
      }
    }
  );
}

/* ===== sketch.js 第三段結束 ===== */

/* =========================================================
   MINDSPACE PLUS-PLUS
   sketch.js — PART 4

   22｜AI 對話與語音
   23｜錄音與語音辨識
   24｜AI 語音播放
   25｜AI 積木變身
   26｜角色技能
   27｜作品管理
   28｜四顆泡泡按鈕
   29｜工作台與全螢幕
   30｜系統初始化

   接續 PART 3
========================================================= */

/* =========================================================
   22｜AI 對話紀錄
========================================================= */

function appendChat(role, message) {
  const log = $("chatLog");

  if (!log) return;

  const item =
    document.createElement("div");

  item.style.padding =
    "8px 10px";

  item.style.marginBottom =
    "8px";

  item.style.borderRadius =
    "12px";

  item.style.background =
    role === "child"
      ? "#dff1ff"
      : "#fff0d4";

  item.style.whiteSpace =
    "pre-wrap";

  item.textContent =
    (
      role === "child"
        ? "🧒 "
        : "✨ "
    ) + message;

  log.appendChild(item);

  log.scrollTop =
    log.scrollHeight;

  state.history.push({
    role,
    message,
    time: Date.now()
  });

  if (state.history.length > 60) {
    state.history.shift();
  }
}

/* =========================================================
   22-A｜AI 自由對話

   AI 理解孩子的想法，
   不是依照固定技能關鍵字判斷。
========================================================= */

async function sendPlusPlusMessage(
  message
) {
  const text =
    String(message || "").trim();

  if (!text) return;

  const input = $("chatInput");

  if (input) {
    input.value = "";
  }

  appendChat("child", text);

  const creation =
    selectedCreation();

  bubble(
    "🧠 正在理解你的想像……"
  );

  status(
    "✨ OpenAI 正在思考你的創作"
  );

  try {
    /*
      新版 mindspaceDirector：

      AI 自行判斷孩子想要：
      - 角色變身
      - 增加配件
      - 角色技能
      - 生成配角
      - 生成物件
      - 改變環境
      - 故事事件

      以上只是能力範圍，
      不是固定關鍵字清單。
    */

    const result = await callAI(
      "mindspaceDirector",
      {
        message: text,

        creationId:
          creation?.id || null,

        creation:
          creation
            ? {
                id: creation.id,

                name:
                  creation.name,

                role:
                  creation.role,

                description:
                  creation.description,

                personality:
                  creation.personality,

                originalImage:
                  await scaledData(
                    creation.originalImage,
                    650
                  )
              }
            : null,

        world:
          getPlusPlusWorldContext(),

        history:
          state.history.slice(-16),

        style:
          PLUSPLUS_STYLE,

        preserveOriginal:
          true,

        allowCreativeGeneration:
          true
      },
      180000
    );

    const reply =
      String(
        result?.reply ||
        result?.response ||
        result?.message ||
        "我聽見你的想法了！"
      );

    appendChat("ai", reply);

    bubble(reply);

    /*
      ai-director.js 後續會提供
      executePlusPlusAIResponse。

      它負責執行 AI 回傳的
      動畫、物件、配件及事件。
    */

    if (
      typeof window
        .executePlusPlusAIResponse ===
      "function"
    ) {
      await window
        .executePlusPlusAIResponse(
          result,
          {
            creationId:
              creation?.id || null
          }
        );
    }

    if (state.voiceEnabled) {
      await speak(reply);
    }

    return result;
  } catch (error) {
    status(
      "❌ AI 對話失敗：" +
      error.message
    );

    bubble(
      "我暫時沒聽清楚，可以再告訴我一次嗎？"
    );

    throw error;
  }
}

/* =========================================================
   22-B｜送出文字
========================================================= */

async function sendChatInput() {
  const text =
    $("chatInput")?.value?.trim();

  if (!text) {
    return;
  }

  await sendPlusPlusMessage(
    text
  );
}

/* =========================================================
   23｜麥克風錄音

   沿用一評的錄音 → Whisper 辨識。
========================================================= */

async function toggleRecording() {
  if (state.recording) {
    await finishRecording();
    return;
  }

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    throw new Error(
      "瀏覽器不支援麥克風，請使用 HTTPS"
    );
  }

  const stream =
    await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

  const preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ];

  const mimeType =
    preferredTypes.find(
      type =>
        MediaRecorder.isTypeSupported(
          type
        )
    ) || "";

  const recorder =
    mimeType
      ? new MediaRecorder(
          stream,
          {
            mimeType
          }
        )
      : new MediaRecorder(
          stream
        );

  state.audioStream =
    stream;

  state.recorder =
    recorder;

  state.audioChunks = [];

  recorder.addEventListener(
    "dataavailable",
    event => {
      if (
        event.data &&
        event.data.size > 0
      ) {
        state.audioChunks.push(
          event.data
        );
      }
    }
  );

  recorder.start();

  state.recording = true;

  updateMicrophoneButtons();

  bubble(
    "🎙️ 我正在聽你說話……"
  );

  status(
    "🎙️ 正在錄音，再按一次麥克風即可送出"
  );
}

/* =========================================================
   23-A｜停止錄音
========================================================= */

async function finishRecording() {
  if (
    !state.recorder ||
    !state.recording
  ) {
    return;
  }

  const recorder =
    state.recorder;

  state.recording = false;

  updateMicrophoneButtons();

  const blob =
    await new Promise(
      (resolve, reject) => {
        recorder.addEventListener(
          "stop",
          () => {
            resolve(
              new Blob(
                state.audioChunks,
                {
                  type:
                    recorder.mimeType ||
                    "audio/webm"
                }
              )
            );
          },
          {
            once: true
          }
        );

        recorder.addEventListener(
          "error",
          () => {
            reject(
              new Error(
                "錄音失敗"
              )
            );
          },
          {
            once: true
          }
        );

        recorder.stop();
      }
    );

  state.audioStream
    ?.getTracks()
    .forEach(track => {
      track.stop();
    });

  state.audioStream = null;
  state.recorder = null;

  if (!blob.size) {
    throw new Error(
      "沒有錄到聲音"
    );
  }

  bubble(
    "🧠 正在辨識你的聲音……"
  );

  status(
    "🎙️ 正在進行 AI 語音辨識"
  );

  const base64 =
    await blobBase64(blob);

  const result = await callAI(
    "transcribe",
    {
      audio: base64,

      mimeType:
        blob.type,

      language: "zh"
    },
    180000
  );

  const text =
    typeof result === "string"
      ? result
      : (
          result?.text ||
          result?.transcript ||
          ""
        );

  if (!text.trim()) {
    bubble(
      "我沒有聽清楚，可以再說一次嗎？"
    );
    return;
  }

  await sendPlusPlusMessage(
    text
  );
}

/* =========================================================
   23-B｜Blob 轉 base64
========================================================= */

function blobBase64(blob) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onload = () => {
        const result =
          String(
            reader.result || ""
          );

        resolve(
          result.split(",")[1] ||
          ""
        );
      };

      reader.onerror = () => {
        reject(
          new Error(
            "無法轉換錄音資料"
          )
        );
      };

      reader.readAsDataURL(
        blob
      );
    }
  );
}

/* =========================================================
   23-C｜更新麥克風泡泡
========================================================= */

function updateMicrophoneButtons() {
  const bubbleButton =
    $("bubbleMic");

  const workbenchButton =
    $("micButton");

  if (bubbleButton) {
    bubbleButton.classList.toggle(
      "recording",
      state.recording
    );

    bubbleButton.textContent =
      state.recording
        ? "⏹️"
        : "🎙️";

    bubbleButton.title =
      state.recording
        ? "停止錄音並送出"
        : "開始說話";
  }

  if (workbenchButton) {
    workbenchButton.textContent =
      state.recording
        ? "⏹️ 停止並送出"
        : "🎙️ 開始說話";
  }
}

/* =========================================================
   24｜AI 語音回覆

   優先使用一評 GAS 的
   speakNatural。

   無法取得音訊時，
   使用瀏覽器語音作為備援。
========================================================= */

function stopSpeech() {
  state.speechSerial++;

  if (state.audio) {
    state.audio.pause();
    state.audio.src = "";
    state.audio = null;
  }

  if (
    "speechSynthesis" in window
  ) {
    window.speechSynthesis.cancel();
  }
}

function browserSpeech(text) {
  if (
    !("speechSynthesis" in window)
  ) {
    return;
  }

  const utterance =
    new SpeechSynthesisUtterance(
      text
    );

  utterance.lang =
    "zh-TW";

  utterance.rate =
    0.95;

  utterance.pitch =
    1.12;

  window.speechSynthesis.speak(
    utterance
  );
}

async function speak(text) {
  if (
    !state.voiceEnabled ||
    !text
  ) {
    return;
  }

  stopSpeech();

  const serial =
    state.speechSerial;

  try {
    const result = await callAI(
      "speakNatural",
      {
        text,

        voice: "nova"
      },
      120000
    );

    if (
      serial !==
      state.speechSerial
    ) {
      return;
    }

    const audioData =
      typeof result === "string"
        ? result
        : (
            result?.audio ||
            result?.audioBase64 ||
            result?.base64 ||
            result?.url
          );

    if (!audioData) {
      browserSpeech(text);
      return;
    }

    const source =
      audioData.startsWith("data:") ||
      audioData.startsWith("https://")
        ? audioData
        : (
            "data:audio/mpeg;base64," +
            audioData
          );

    const audio =
      new Audio(source);

    state.audio = audio;

    await audio.play();
  } catch (error) {
    if (
      serial ===
      state.speechSerial
    ) {
      browserSpeech(text);
    }
  }
}

/* =========================================================
   25｜AI 積木變身

   保留原始積木圖片。

   AI 只能在原本作品基礎上
   增加或改變造型。

   所有新增部分都是
   Plus-Plus 積木風格。
========================================================= */

async function transformHero() {
  const creation =
    selectedCreation();

  if (!creation) {
    throw new Error(
      "請先選擇積木角色"
    );
  }

  if (
    creation.role !== "character"
  ) {
    throw new Error(
      "請先選擇角色作品"
    );
  }

  const instruction =
    $("transformInput")
      ?.value?.trim();

  if (!instruction) {
    throw new Error(
      "請先描述希望角色如何變身"
    );
  }

  status(
    "✨ OpenAI 正在創造 Plus-Plus 變身……"
  );

  bubble(
    "🧩 你的角色正在變身！"
  );

  const result = await callAI(
    "transform",
    {
      image:
        await scaledData(
          creation.originalImage,
          900
        ),

      instruction,

      style:
        PLUSPLUS_STYLE,

      preserveOriginal:
        true,

      material:
        "Plus-Plus interlocking plastic construction blocks",

      creation: {
        id: creation.id,

        name:
          creation.name,

        description:
          creation.description
      }
    },
    240000
  );

  const image =
    normalizeAIImage(
      result
    );

  /*
    原始圖片永遠不覆蓋。
  */

  creation.transformedImage =
    image;

  creation.displayImage =
    image;

  creation.updatedAt =
    Date.now();

  const hero =
    state.heroes.find(
      item =>
        item.id === creation.id
    );

  if (hero) {
    hero.transformedImage =
      image;

    hero.currentImage =
      image;
  }

  updateCreationVisual(
    creation
  );

  bubble(
    "✨ 變身完成！你還可以繼續改變它！"
  );

  status(
    "🌈 Plus-Plus 變身完成"
  );

  return result;
}

/* =========================================================
   25-A｜恢復原始積木
========================================================= */

function showOriginal() {
  const creation =
    selectedCreation();

  if (!creation) {
    return;
  }

  creation.displayImage =
    creation.originalImage;

  const hero =
    state.heroes.find(
      item =>
        item.id === creation.id
    );

  if (hero) {
    hero.currentImage =
      creation.originalImage;
  }

  updateCreationVisual(
    creation
  );

  bubble(
    "🧩 已恢復你原本的積木造型！"
  );
}

/* =========================================================
   25-B｜顯示 AI 變身造型
========================================================= */

function showTransform() {
  const creation =
    selectedCreation();

  if (
    !creation ||
    !creation.transformedImage
  ) {
    bubble(
      "目前還沒有 AI 變身造型喔！"
    );
    return;
  }

  creation.displayImage =
    creation.transformedImage;

  updateCreationVisual(
    creation
  );

  bubble(
    "✨ 這是你的 AI 積木變身！"
  );
}

/* =========================================================
   26｜AI 技能

   由 AI 自行規劃技能效果，
   不是依照固定關鍵字。
========================================================= */

async function activateHeroSkill() {
  const creation =
    selectedCreation();

  if (!creation) {
    throw new Error(
      "請先選擇角色"
    );
  }

  if (
    creation.role !== "character"
  ) {
    throw new Error(
      "環境作品不使用角色技能按鈕"
    );
  }

  const result = await callAI(
    "mindspaceDirector",
    {
      message:
        "請讓目前選擇的角色表演它已經擁有的一項能力。若尚未設定能力，請先用語音詢問孩子想賦予什麼能力，不要擅自替孩子決定。",

      creationId:
        creation.id,

      creation: {
        id: creation.id,

        name:
          creation.name,

        abilities:
          creation.abilities,

        description:
          creation.description
      },

      world:
        getPlusPlusWorldContext(),

      style:
        PLUSPLUS_STYLE
    },
    120000
  );

  const reply =
    String(
      result?.reply ||
      result?.response ||
      "看看我的積木能力！"
    );

  bubble(reply);

  if (
    typeof window
      .executePlusPlusAIResponse ===
    "function"
  ) {
    await window
      .executePlusPlusAIResponse(
        result,
        {
          creationId:
            creation.id
        }
      );
  }

  if (state.voiceEnabled) {
    await speak(reply);
  }

  return result;
}

/* =========================================================
   27｜作品管理
========================================================= */

async function editSelectedCreation() {
  const creation =
    selectedCreation();

  if (!creation) {
    throw new Error(
      "請先選擇作品"
    );
  }

  await openEditor(
    creation.originalImage,
    creation.id
  );
}

function removeHero() {
  const creation =
    selectedCreation();

  if (!creation) {
    return;
  }

  if (
    !window.confirm(
      "確定要移除這件積木作品嗎？"
    )
  ) {
    return;
  }

  const id =
    creation.id;

  state.creations =
    state.creations.filter(
      item =>
        item.id !== id
    );

  state.heroes =
    state.heroes.filter(
      item =>
        item.id !== id
    );

  const element =
    $("actors")?.querySelector(
      '[data-creation-id="' +
      id +
      '"]'
    );

  element?.remove();

  /*
    不刪除其他作品，
    不清空共同世界。
  */

  state.selectedId =
    state.creations[0]?.id ||
    null;

  refreshHeroes();

  bubble(
    "🧩 已移除選擇的積木作品"
  );
}

/* =========================================================
   27-A｜AI 重新辨識
========================================================= */

async function inspectHero() {
  const creation =
    selectedCreation();

  if (!creation) {
    throw new Error(
      "請先選擇作品"
    );
  }

  await analyzePlusPlusCreation(
    creation.id
  );
}

/* =========================================================
   27-B｜開始新創作

   只有孩子主動按重設，
   才清空整個世界。
========================================================= */

function resetMindspace() {
  if (
    !window.confirm(
      "確定要清空所有積木作品，開始新的想像世界嗎？"
    )
  ) {
    return;
  }

  stopSpeech();

  state.creations = [];
  state.heroes = [];

  state.selectedId = null;

  state.generatedWorlds = [];
  state.environments = [];

  state.generatedObjects = [];
  state.accessories = [];

  state.effects = [];
  state.eventQueue = [];

  state.activeBackgroundId =
    null;

  state.worldInitialized =
    false;

  state.history = [];

  state.worldRevision++;

  state.generationJobs.clear();

  const layers = [
    "actors",
    "environmentLayer",
    "generatedBackground"
  ];

  for (const id of layers) {
    const element = $(id);

    if (element) {
      element.innerHTML = "";
    }
  }

  const log = $("chatLog");

  if (log) {
    log.innerHTML = "";
  }

  refreshHeroes();

  bubble(
    "🌈 一起創造新的 Plus-Plus 世界吧！"
  );

  status(
    "🌱 已開始新的創作"
  );
}

/* =========================================================
   28｜四顆懸浮泡泡按鈕

   📸 拍照
   🎙️ 麥克風
   🧺 工作台
   ⛶ 全螢幕
========================================================= */

function installFloatingButtons() {
  /*
    拍照泡泡已在第二段綁定，
    這裡不重複綁定，
    避免點一次開啟兩次攝影機。
  */

  click(
    "bubbleMic",
    toggleRecording
  );

  /*
    工作台泡泡
  */

  click(
    "bubbleWorkbench",
    toggleWorkbench
  );

  /*
    全螢幕泡泡
  */

  click(
    "bubbleFullscreen",
    toggleFullscreen
  );
}

/* =========================================================
   29｜右側工作台
========================================================= */

function setWorkbenchOpen(open) {
  state.workbenchOpen =
    Boolean(open);

  const sidebar =
    $("sidebar");

  const overlay =
    $("toolBasketOverlay");

  const button =
    $("bubbleWorkbench");

  if (sidebar) {
    sidebar.classList.toggle(
      "is-open",
      state.workbenchOpen
    );
  }

  if (overlay) {
    overlay.classList.toggle(
      "hidden",
      !state.workbenchOpen
    );
  }

  if (button) {
    button.textContent =
      state.workbenchOpen
        ? "✕"
        : "🧺";

    button.setAttribute(
      "aria-expanded",
      String(
        state.workbenchOpen
      )
    );
  }
}

function toggleWorkbench() {
  setWorkbenchOpen(
    !state.workbenchOpen
  );
}

/* =========================================================
   29-A｜全螢幕
========================================================= */

async function toggleFullscreen() {
  if (!document.fullscreenElement) {
    await document.documentElement
      .requestFullscreen();
  } else {
    await document.exitFullscreen();
  }
}

function updateFullscreenButton() {
  const button =
    $("bubbleFullscreen");

  if (!button) return;

  button.textContent =
    document.fullscreenElement
      ? "⤢"
      : "⛶";

  button.title =
    document.fullscreenElement
      ? "離開全螢幕"
      : "進入全螢幕";
}

/* =========================================================
   29-B｜工作台與全螢幕事件
========================================================= */

function installWorkbenchAndFullscreen() {
  let overlay =
    $("toolBasketOverlay");

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

  overlay.addEventListener(
    "click",
    () => {
      setWorkbenchOpen(false);
    }
  );

  document.addEventListener(
    "keydown",
    event => {
      if (event.key === "Escape") {
        setWorkbenchOpen(false);
      }
    }
  );

  document.addEventListener(
    "fullscreenchange",
    updateFullscreenButton
  );

  /*
    保留一評的隱藏全螢幕按鈕。
  */

  click(
    "fullscreenButton",
    toggleFullscreen
  );
}

/* =========================================================
   30｜安裝一評及二評操作按鈕
========================================================= */

function setupButtons() {
  /*
    第二段：
    攝影機與編輯器。
  */

  installCameraAndEditorButtons();

  /*
    第二段：
    角色 / 環境分類。
  */

  installClassificationButtons();

  /*
    第四段：
    四顆懸浮泡泡。
  */

  installFloatingButtons();

  /*
    第四段：
    工作台與全螢幕。
  */

  installWorkbenchAndFullscreen();

  /*
    語音與對話。
  */

  click(
    "micButton",
    toggleRecording
  );

  click(
    "sendButton",
    sendChatInput
  );

  $("chatInput")?.addEventListener(
    "keydown",
    event => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.isComposing
      ) {
        event.preventDefault();

        sendChatInput().catch(
          error => {
            status(
              "❌ " +
              error.message
            );
          }
        );
      }
    }
  );

  click(
    "voiceButton",
    () => {
      state.voiceEnabled =
        !state.voiceEnabled;

      const button =
        $("voiceButton");

      if (button) {
        button.textContent =
          state.voiceEnabled
            ? "🔊 語音：開"
            : "🔇 語音：關";
      }

      if (!state.voiceEnabled) {
        stopSpeech();
      }
    }
  );

  click(
    "stopVoice",
    stopSpeech
  );

  /*
    角色變身。
  */

  click(
    "transformButton",
    transformHero
  );

  click(
    "restoreButton",
    showOriginal
  );

  click(
    "showTransform",
    showTransform
  );

  click(
    "skillButton",
    activateHeroSkill
  );

  /*
    作品管理。
  */

  click(
    "editHero",
    editSelectedCreation
  );

  click(
    "deleteHero",
    removeHero
  );

  click(
    "inspectHero",
    inspectHero
  );

  /*
    手動重新生成世界。
  */

  click(
    "generateCreationWorld",
    async () => {
      const creation =
        selectedCreation();

      if (!creation) {
        throw new Error(
          "請先選擇作品"
        );
      }

      if (
        creation.role === "pending"
      ) {
        await analyzePlusPlusCreation(
          creation.id
        );

        return;
      }

      await generateCreationWorld(
        creation.id
      );
    }
  );

  /*
    AI 連線測試。
  */

  click(
    "testBridge",
    async () => {
      const result =
        await callAI(
          "ping",
          {}
        );

      status(
        "✅ AI 連線成功：" +
        JSON.stringify(result)
      );
    }
  );

  /*
    開始新創作。
  */

  click(
    "resetButton",
    resetMindspace
  );

  /*
    選擇角色。
  */

  $("selectedHero")?.addEventListener(
    "change",
    event => {
      state.selectedId =
        event.target.value ||
        null;

      refreshHeroes();
    }
  );
}

/* =========================================================
   30-A｜啟動 p5.js 世界

   一評原有的海底背景
   可以保留作為 AI 背景尚未生成時
   的預設場景。
========================================================= */

function startP5World() {
  const container =
    $("scene");

  if (!container) {
    return;
  }

  if (
    typeof p5 !== "function"
  ) {
    status(
      "⚠️ p5.js 尚未載入"
    );
    return;
  }

  if (
    plusPlusWorld.p5Instance
  ) {
    return;
  }

  plusPlusWorld.p5Instance =
    new p5(p => {
      const bubbles = [];

      p.setup = () => {
        const size =
          worldSize();

        p.createCanvas(
          size.width,
          size.height
        );

        for (
          let i = 0;
          i < 55;
          i++
        ) {
          bubbles.push({
            x:
              Math.random() *
              size.width,

            y:
              Math.random() *
              size.height,

            r:
              3 +
              Math.random() * 10,

            speed:
              0.3 +
              Math.random() * 1.4
          });
        }
      };

      p.draw = () => {
        const size =
          worldSize();

        p.background(
          16,
          64,
          105
        );

        p.noStroke();

        for (
          const item of bubbles
        ) {
          p.fill(
            180,
            230,
            255,
            65
          );

          p.circle(
            item.x,
            item.y,
            item.r * 2
          );

          item.y -=
            item.speed;

          if (item.y < -20) {
            item.y =
              size.height + 20;

            item.x =
              Math.random() *
              size.width;
          }
        }
      };

      p.windowResized = () => {
        const size =
          worldSize();

        p.resizeCanvas(
          size.width,
          size.height
        );
      };
    }, container);
}

/* =========================================================
   30-B｜歡迎畫面
========================================================= */


function initializeStartScreen() {
  click("startButton", async () => {
    modal("startScreen", false);

    const welcome =
      "歡迎來到想像有形！" +
      "你可以先用積木拼出任何你想像的東西，" +
      "再按下拍照按鈕，" +
      "讓它進入我們的想像世界！";

    bubble("🧩 " + welcome);

    // 使用者按下開始後，立即嘗試播放語音。
    // 先使用瀏覽器語音，不必等待 GAS。
    if (state.voiceEnabled) {
      stopSpeech();
      browserSpeech(welcome);
    }
  });
}


/* =========================================================
   30-C｜系統初始化
========================================================= */

function initializeMindspace() {
  if (
    window.__mindspaceInitialized
  ) {
    return;
  }

  window.__mindspaceInitialized =
    true;

  initializeBridge();

  initializePlusPlusWorld();

  startP5World();

  setupButtons();

  initializeStartScreen();

  refreshHeroes();

  status(
    "🧩 Mindspace Plus-Plus 已啟動"
  );
}

/* =========================================================
   30-D｜DOM 載入後啟動
========================================================= */

if (
  document.readyState === "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeMindspace
  );
} else {
  initializeMindspace();
}

/* ===== sketch.js 第四段結束 ===== */
