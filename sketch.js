
"use strict";

/* =====================================================
   MINDSPACE PLUS-PLUS — SKETCH.JS
   基於一評 Mindspace V2

   核心原則：
   1. 原始積木作品永遠保留
   2. AI 延伸內容使用獨立圖層
   3. Character / Environment 共用攝影機與編輯器
   4. 語音由 AI 自由理解，不以關鍵字 if 限制創作
   5. 沿用 mindspace-v2 GAS Bridge 協定
===================================================== */

/*
  請將下方網址換成你已經部署成功的新版
  Plus-Plus Code.gs / Bridge.html 網址。

  這裡沿用先前對話中的新版部署網址，
  但仍需要你確認該部署目前指向 V5。
*/

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxVswrdmiv0CjmI2Na13dEFDGKIjjB-Sb3pG57Nj6j_hf3blMEWenCUoFn2rsLNsQXx/exec";

/* =====================================================
   01. 基礎工具
===================================================== */

const $ = id =>
  document.getElementById(id);

const clamp = (n, a, b) =>
  Math.max(a, Math.min(b, n));

const uid = () =>
  Date.now().toString(36) +
  Math.random().toString(36).slice(2, 9);

const sleep = ms =>
  new Promise(resolve =>
    setTimeout(resolve, ms)
  );

/* =====================================================
   02. 系統狀態

   保留一評原有 state 欄位，
   只新增 Plus-Plus 專用資料。
===================================================== */

const state = {

  /* ===== 一評角色 ===== */

  heroes: [],

  selectedId: null,

  world: "ocean",

  history: [],

  scenes: [],

  voiceEnabled: true,

  /* ===== GAS Bridge ===== */

  bridgeReady: false,

  bridgeWindow: null,

  bridgeOrigin: "",

  bridgeToken: uid() + uid(),

  bridgeInitialized: false,

  pending: new Map(),

  /* ===== 攝影機 ===== */

  cameraStream: null,

  cameraFacing: "environment",

  cameraRequestId: 0,

  /* ===== 錄音 ===== */

  recorder: null,

  audioStream: null,

  audioChunks: [],

  recording: false,

  busy: false,

  /* ===== 去背編輯器 ===== */

  editorOriginal: null,

  editorHeroId: null,

  editorHistory: [],

  editorMode: "erase",

  editorPainting: false,

  editorLastPoint: null,

  /* ===== 語音 ===== */

  audio: null,

  speechSerial: 0,

  /* ===== Plus-Plus ===== */

  creationMode: "character",

  creationDescription: "",

  creationAnalysis: null,

  generatedWorld: null,

  generatedWorldName: "",

  worldGenerating: false,

  /*
    每個原始積木角色的延伸配件。
    key = hero.id
    value = 配件陣列
  */

  plusPlusAccessories: new Map(),

  /*
    AI 生成的場景物件。
  */

  plusPlusObjects: [],

  /*
    AI 生成的其他角色。
    原始掃描角色仍存放在 heroes。
  */

  plusPlusGeneratedHeroes: [],

  /*
    Environment 模式的原始作品。
    這是對原始圖片的引用，
    不是 AI 重新生成的圖片。
  */

  environmentCenterpieceId: null,

  /*
    AI 回傳的多步驟操作。
  */

  operationQueue: [],

  operationRunning: false,

  /*
    保留 AI 對話上下文。
  */

  creationHistory: [],

  /*
    避免同一按鈕重複綁定。
  */

  boundButtons: new Set()

};

/* =====================================================
   03. 訊息顯示
===================================================== */

function status(message) {
  const el = $("status");

  if (el) {
    el.textContent =
      String(message || "");
  }

  console.log(
    "[Mindspace Plus-Plus]",
    message
  );
}

function bubble(message) {
  const el = $("speechBubble");

  if (el) {
    el.textContent =
      String(message || "");
  }
}

function creationProgress(message) {
  const el =
    $("creationProgress");

  if (el) {
    el.textContent =
      String(message || "");
  }

  status(message);
}

/* =====================================================
   04. 視窗與元素操作
===================================================== */

function modal(id, show) {
  const el = $(id);

  if (!el) return;

  el.classList.toggle(
    "hidden",
    !show
  );
}

function heroNow() {
  return state.heroes.find(
    hero =>
      hero.id === state.selectedId
  ) || null;
}

/*
  按鈕初始化採獨立綁定。

  某個按鈕不存在時，
  不會中斷其他按鈕的功能。
*/

function click(id, fn) {
  const el = $(id);

  if (!el) {
    console.warn(
      "[Mindspace] 找不到按鈕：",
      id
    );

    return false;
  }

  if (state.boundButtons.has(id)) {
    return true;
  }

  state.boundButtons.add(id);

  el.addEventListener(
    "click",
    async event => {
      try {
        await fn(event);

      } catch (error) {
        console.error(
          "[Mindspace] 按鈕執行失敗：",
          id,
          error
        );

        status(
          "❌ " +
          (error.message ||
           "操作失敗")
        );
      }
    }
  );

  return true;
}

/* =====================================================
   05. 圖片讀取
===================================================== */

function imageLoad(src) {
  return new Promise(
    (resolve, reject) => {

      if (!src) {
        reject(
          new Error(
            "沒有提供圖片來源"
          )
        );
        return;
      }

      const image = new Image();

      image.onload = () =>
        resolve(image);

      image.onerror = () =>
        reject(
          new Error(
            "圖片載入失敗"
          )
        );

      image.src = src;
    }
  );
}

function fileData(file) {
  return new Promise(
    (resolve, reject) => {

      if (!file) {
        reject(
          new Error(
            "沒有選擇檔案"
          )
        );
        return;
      }

      const reader =
        new FileReader();

      reader.onload = () =>
        resolve(reader.result);

      reader.onerror = () =>
        reject(
          new Error(
            "無法讀取檔案"
          )
        );

      reader.readAsDataURL(
        file
      );
    }
  );
}

/* =====================================================
   06. 圖片縮放

   注意：
   縮放只用於傳送 AI 分析。
   原始積木照片不會因此被覆蓋。
===================================================== */

async function scaledData(
  src,
  max = 650,
  format = "image/png"
) {
  const image =
    await imageLoad(src);

  const ratio = Math.min(
    1,
    max / Math.max(
      image.width,
      image.height
    )
  );

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width = Math.max(
    1,
    Math.round(
      image.width * ratio
    )
  );

  canvas.height = Math.max(
    1,
    Math.round(
      image.height * ratio
    )
  );

  const ctx =
    canvas.getContext("2d");

  ctx.drawImage(
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

/* =====================================================
   07. 原始積木資料保護

   原始掃描圖片是唯一基準。

   AI 不可以把 generated image
   寫回 original。
===================================================== */

function originalHeroImage(hero) {
  if (!hero) {
    return "";
  }

  return hero.original || "";
}

function preserveOriginalHero(hero) {
  if (!hero) {
    return;
  }

  /*
    第一次建立時記錄原圖。
    後續 AI 操作不能覆蓋它。
  */

  if (!hero.plusPlusOriginal) {
    hero.plusPlusOriginal =
      hero.original || "";
  }

  if (!hero.plusPlusMode) {
    hero.plusPlusMode =
      state.creationMode;
  }

  if (!Array.isArray(
    hero.plusPlusExtensions
  )) {
    hero.plusPlusExtensions = [];
  }
}

/*
  顯示原始角色時，
  不使用 AI 生成的 transformed。
*/

function showOriginalPlusPlus(hero) {
  if (!hero) return;

  preserveOriginalHero(hero);

  if (hero.originalElement) {
    hero.originalElement.src =
      hero.plusPlusOriginal ||
      hero.original;

    hero.originalElement.style.display =
      "block";
  }

  if (hero.transformedElement) {
    hero.transformedElement.style.display =
      "none";
  }
}

/* =====================================================
   08. Character / Environment 模式
===================================================== */

function setCreationMode(mode) {
  if (
    mode !== "character" &&
    mode !== "environment"
  ) {
    return;
  }

  state.creationMode = mode;

  const characterButton =
    $("characterModeButton");

  const environmentButton =
    $("environmentModeButton");

  if (characterButton) {
    characterButton.setAttribute(
      "aria-pressed",
      String(
        mode === "character"
      )
    );
  }

  if (environmentButton) {
    environmentButton.setAttribute(
      "aria-pressed",
      String(
        mode === "environment"
      )
    );
  }

  const hint =
    $("creationModeHint");

  if (hint) {
    hint.textContent =
      mode === "character"
        ? "角色模式：原始積木角色會進入世界，並接受 AI 語音延伸造型。"
        : "背景模式：原始積木作品會成為場景中央的核心，AI 將向四周延伸世界。";
  }

  creationProgress(
    mode === "character"
      ? "🧸 已選擇 Character 角色模式"
      : "🌍 已選擇 Environment 背景模式"
  );
}

/* =====================================================
   09. Plus-Plus 圖層

   背景、原始積木、AI 延伸物件、
   技能效果分層顯示。
===================================================== */

function plusPlusBackgroundElement() {
  return $("plusPlusBackground");
}

function plusPlusEnvironmentElement() {
  return $("plusPlusEnvironmentLayer");
}

function plusPlusEffectElement() {
  return $("plusPlusEffectLayer");
}

/*
  AI 世界背景只更新背景圖片，
  不更改原始角色。
*/

function displayPlusPlusWorld(
  image,
  name
) {
  if (!image) {
    throw new Error(
      "AI 沒有回傳世界圖片"
    );
  }

  const background =
    plusPlusBackgroundElement();

  if (!background) {
    throw new Error(
      "找不到 Plus-Plus 背景圖層"
    );
  }

  state.generatedWorld = image;

  state.generatedWorldName =
    name || "Plus-Plus 想像世界";

  background.src = image;

  background.classList.remove(
    "hidden"
  );

  const title =
    $("worldTitle");

  if (title) {
    title.textContent =
      "🧩 " +
      state.generatedWorldName;
  }
}

/*
  後續的生成式配件和場景物件
  都會掛載在獨立圖層，
  不會寫回原始圖片。
*/

/* =====================================================
   第一段結束

   下一段接續：
   10. GAS Bridge 初始化
   11. AI 請求與版本檢查
   12. 語音播放與辨識
   13. 攝影機、照片上傳與去背
===================================================== */

/* =====================================================
   10. GAS BRIDGE
   GitHub Pages ↔ Google Apps Script

   保留一評 mindspace-v2 通訊協定。
===================================================== */

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

/*
  將所有尚未完成的 AI 請求結束，
  避免重新連線後仍持續等待舊回應。
*/

function rejectPendingRequests(message) {
  for (
    const [id, pending]
    of state.pending.entries()
  ) {
    clearTimeout(
      pending.timer
    );

    pending.reject(
      new Error(message)
    );

    state.pending.delete(id);
  }
}

/*
  GAS iframe 重新載入時，
  可以重新建立握手狀態。
*/

function initializeBridge(force = false) {
  if (
    !/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:[?#]|$)/
      .test(GAS_URL)
  ) {
    status(
      "❌ GAS_URL 不是有效的 Apps Script 部署網址"
    );
    return;
  }

  const frame =
    $("bridgeFrame");

  if (!frame) {
    status(
      "❌ 找不到 bridgeFrame，無法建立 AI 連線"
    );
    return;
  }

  if (
    state.bridgeInitialized &&
    !force
  ) {
    return;
  }

  if (force) {
    rejectPendingRequests(
      "AI 連線已重新建立，請重試剛才的操作"
    );
  }

  state.bridgeReady = false;
  state.bridgeWindow = null;
  state.bridgeOrigin = "";

  /*
    只註冊一次 message 監聽器，
    避免重複收到同一個 AI 回應。
  */

  if (!state.bridgeInitialized) {
    window.addEventListener(
      "message",
      handleBridgeMessage
    );
  }

  state.bridgeInitialized = true;

  /*
    每次重新載入 iframe，
    都更新握手 token。
  */

  state.bridgeToken =
    uid() + uid();

  const url =
    new URL(GAS_URL);

  url.searchParams.set(
    "bridgeToken",
    state.bridgeToken
  );

  url.searchParams.set(
    "parentOrigin",
    window.location.origin
  );

  /*
    由 iframe 的 ready 訊息取得
    真正的回覆來源。
  */

  frame.src =
    url.toString();

  status(
    "🔌 正在連線新版 Plus-Plus AI……"
  );

  const currentToken =
    state.bridgeToken;

  setTimeout(() => {
    if (
      currentToken ===
        state.bridgeToken &&
      !state.bridgeReady
    ) {
      status(
        "⚠️ 尚未收到 GAS Bridge 握手訊息。" +
        "請檢查新版部署網址、存取權限及 Bridge.html。"
      );
    }
  }, 15000);
}

/* =====================================================
   11. BRIDGE 訊息處理
===================================================== */

function handleBridgeMessage(event) {
  const message =
    event.data;

  if (
    !message ||
    typeof message !== "object"
  ) {
    return;
  }

  if (
    message.app !==
    "mindspace-v2"
  ) {
    return;
  }

  if (
    !googleOrigin(
      event.origin
    )
  ) {
    return;
  }

  if (
    message.token !==
    state.bridgeToken
  ) {
    return;
  }

  if (
    message.kind === "ready"
  ) {
    if (!event.source) {
      return;
    }

    /*
      記錄目前真正的 iframe
      WindowProxy 與來源網域。
    */

    state.bridgeWindow =
      event.source;

    state.bridgeOrigin =
      event.origin;

    state.bridgeReady =
      true;

    event.source.postMessage(
      {
        app: "mindspace-v2",
        kind: "ack",
        token: state.bridgeToken
      },
      event.origin
    );

    status(
      "✅ AI Bridge 已連線，正在等待 AI 功能測試"
    );

    return;
  }

  if (
    message.kind !==
    "response"
  ) {
    return;
  }

  /*
    不接受其他視窗偽造的回應。
  */

  if (
    event.source !==
    state.bridgeWindow
  ) {
    return;
  }

  if (
    event.origin !==
    state.bridgeOrigin
  ) {
    return;
  }

  const pending =
    state.pending.get(
      message.id
    );

  if (!pending) {
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
        "AI 後端執行失敗"
      )
    );
  }
}

/* =====================================================
   12. AI 請求

   所有 AI 功能共用同一個入口。
===================================================== */

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
            "AI Bridge 尚未連線，請先按「測試 AI 連線」"
          )
        );
        return;
      }

      const id = uid();

      const timer =
        setTimeout(() => {
          state.pending.delete(
            id
          );

          reject(
            new Error(
              "AI 回應逾時：" +
              type
            )
          );
        }, timeout);

      state.pending.set(
        id,
        {
          resolve,
          reject,
          timer,
          type
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

        state.pending.delete(
          id
        );

        reject(error);
      }
    }
  );
}

/* =====================================================
   13. AI 連線測試

   ping：
   確認 GAS 後端可回應。

   version：
   確認實際部署版本。

   注意：
   Bridge 成功不代表 OpenAI
   圖像生成及語音功能都成功。
===================================================== */

async function testAIConnection() {
  const button =
    $("testBridge");

  if (button) {
    button.disabled = true;
  }

  try {
    if (!state.bridgeReady) {
      initializeBridge(true);

      /*
        讓 iframe 有時間完成握手。
      */

      const started =
        Date.now();

      while (
        !state.bridgeReady &&
        Date.now() - started <
          16000
      ) {
        await sleep(250);
      }
    }

    if (!state.bridgeReady) {
      throw new Error(
        "Bridge 未連線。請確認 GAS 部署為網頁應用程式，" +
        "並允許使用者存取。"
      );
    }

    status(
      "🔍 正在檢查新版 AI 後端……"
    );

    const ping =
      await callAI(
        "ping",
        {},
        20000
      );

    let version = null;

    try {
      version =
        await callAI(
          "version",
          {},
          20000
        );

    } catch (error) {
      console.warn(
        "版本檢查失敗：",
        error
      );
    }

    console.log(
      "AI ping:",
      ping
    );

    console.log(
      "AI version:",
      version
    );

    const versionText =
      typeof version === "string"
        ? version
        : (
          version?.version ||
          version?.name ||
          version?.build ||
          ""
        );

    status(
      "✅ GAS 後端已回應" +
      (
        versionText
          ? "｜版本：" +
            versionText
          : ""
      )
    );

    return {
      ping,
      version
    };

  } catch (error) {
    status(
      "❌ AI 連線測試失敗：" +
      error.message
    );

    throw error;

  } finally {
    if (button) {
      button.disabled = false;
    }
  }
}

/* =====================================================
   14. 停止語音
===================================================== */

function stopSpeech() {
  state.speechSerial++;

  if (state.audio) {
    try {
      state.audio.pause();
      state.audio.src = "";
      state.audio.load();

    } catch (error) {
      console.warn(
        "停止音訊時發生問題：",
        error
      );
    }

    state.audio = null;
  }

  if (
    "speechSynthesis" in window
  ) {
    speechSynthesis.cancel();
  }
}

/* =====================================================
   15. 瀏覽器語音備援
===================================================== */

function browserSpeech(text) {
  if (
    !state.voiceEnabled ||
    !text ||
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
    0.94;

  utterance.pitch =
    1.02;

  const voices =
    speechSynthesis.getVoices();

  utterance.voice =
    voices.find(
      voice =>
        voice.lang === "zh-TW"
    ) ||
    voices.find(
      voice =>
        voice.lang.startsWith(
          "zh"
        )
    ) ||
    null;

  speechSynthesis.speak(
    utterance
  );
}

/* =====================================================
   16. AI 自然語音

   使用新版後端 speakNatural。

   原本一評前端使用：
   result.audio

   格式：
   MP3 Base64
===================================================== */

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

  if (!state.bridgeReady) {
    browserSpeech(text);
    return;
  }

  try {
    const result =
      await callAI(
        "speakNatural",
        {
          text:
            String(text).slice(
              0,
              550
            )
        },
        60000
      );

    if (
      serial !==
        state.speechSerial ||
      !state.voiceEnabled
    ) {
      return;
    }

    if (
      !result ||
      !result.audio
    ) {
      throw new Error(
        "後端沒有回傳語音音訊"
      );
    }

    const audio =
      new Audio(
        "data:audio/mpeg;base64," +
        result.audio
      );

    state.audio =
      audio;

    await audio.play();

  } catch (error) {
    console.warn(
      "AI 自然語音失敗，改用瀏覽器語音：",
      error
    );

    if (
      serial ===
      state.speechSerial
    ) {
      browserSpeech(text);
    }
  }
}

/* =====================================================
   17. 語音開關
===================================================== */

function setVoiceEnabled(enabled) {
  state.voiceEnabled =
    Boolean(enabled);

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

/* =====================================================
   18. 對話紀錄
===================================================== */

function chat(
  name,
  text,
  ai = false
) {
  const log =
    $("chatLog");

  if (!log) {
    return;
  }

  const element =
    document.createElement(
      "div"
    );

  element.style.cssText =
    "padding:10px;" +
    "margin:6px 0;" +
    "border-radius:12px;" +
    "line-height:1.6;" +
    "background:" +
    (
      ai
        ? "#ffe4ef"
        : "#e4f1ff"
    );

  element.textContent =
    String(name || "") +
    "：" +
    String(text || "");

  log.appendChild(
    element
  );

  log.scrollTop =
    log.scrollHeight;
}

/* =====================================================
   19. 原始角色歡迎語

   保留一評角色進場後
   可以主動說話的功能。
===================================================== */

function welcomeHero(hero) {
  if (!hero) {
    return;
  }

  const message =
    "你好！我是" +
    hero.name +
    "！我已經來到你的積木世界了。" +
    "你想讓我變成什麼樣子，" +
    "或是一起做什麼事情呢？";

  chat(
    "🧩 " + hero.name,
    message,
    true
  );

  bubble(
    "🧩 " +
    hero.name +
    "：" +
    message
  );

  speak(message);
}

/* =====================================================
   20. 停止攝影機
===================================================== */

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream
      .getTracks()
      .forEach(track => {
        track.stop();
      });
  }

  state.cameraStream =
    null;

  const video =
    $("cameraVideo");

  if (video) {
    video.pause();
    video.srcObject = null;
  }

  const captureButton =
    $("captureButton");

  if (captureButton) {
    captureButton.disabled =
      true;
  }
}

/* =====================================================
   21. 關閉攝影機
===================================================== */

function closeCamera() {
  state.cameraRequestId++;

  stopCamera();

  modal(
    "cameraModal",
    false
  );
}

/* =====================================================
   22. 開啟攝影機
===================================================== */

async function openCamera() {
  const requestId =
    ++state.cameraRequestId;

  stopCamera();

  modal(
    "cameraModal",
    true
  );

  const message =
    $("cameraMessage");

  if (message) {
    message.textContent =
      "正在開啟攝影機……";
  }

  try {
    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices
        .getUserMedia
    ) {
      throw new Error(
        "瀏覽器不支援攝影機，或網站不是 HTTPS"
      );
    }

    const stream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: false,

          video: {
            facingMode: {
              ideal:
                state.cameraFacing
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
        .forEach(track => {
          track.stop();
        });

      return;
    }

    state.cameraStream =
      stream;

    const video =
      $("cameraVideo");

    if (!video) {
      throw new Error(
        "找不到 cameraVideo"
      );
    }

    video.srcObject =
      stream;

    await video.play();

    const captureButton =
      $("captureButton");

    if (captureButton) {
      captureButton.disabled =
        false;
    }

    if (message) {
      message.textContent =
        "📸 攝影機已啟動，可以拍攝積木作品";
    }

    status(
      "📸 攝影機已啟動"
    );

  } catch (error) {
    if (
      requestId ===
      state.cameraRequestId
    ) {
      stopCamera();

      if (message) {
        message.textContent =
          "⚠️ " +
          error.message;
      }

      status(
        "❌ 攝影機：" +
        error.message
      );
    }
  }
}

/* =====================================================
   23. 切換前後鏡頭
===================================================== */

async function switchCameraFacing() {
  state.cameraFacing =
    state.cameraFacing ===
      "environment"
      ? "user"
      : "environment";

  await openCamera();
}

/* =====================================================
   24. 拍攝照片

   拍照後進入一評原有
   去背編輯器。

   不使用生成式 AI
   重新繪製積木作品。
===================================================== */

async function capturePhoto() {
  const video =
    $("cameraVideo");

  if (
    !video ||
    !video.videoWidth ||
    !video.videoHeight
  ) {
    throw new Error(
      "攝影機尚未準備完成"
    );
  }

  const ratio =
    Math.min(
      1,
      1200 /
        Math.max(
          video.videoWidth,
          video.videoHeight
        )
    );

  const canvas =
    document.createElement(
      "canvas"
    );

  canvas.width =
    Math.max(
      1,
      Math.round(
        video.videoWidth *
        ratio
      )
    );

  canvas.height =
    Math.max(
      1,
      Math.round(
        video.videoHeight *
        ratio
      )
    );

  const ctx =
    canvas.getContext(
      "2d"
    );

  ctx.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const photo =
    canvas.toDataURL(
      "image/png"
    );

  closeCamera();

  state.editorHeroId =
    null;

  /*
    openEditor 將在下一段定義。
  */

  await openEditor(photo);
}

/* =====================================================
   25. 照片上傳

   與拍照使用同一個
   去背與儲存流程。
===================================================== */

async function uploadPlusPlusPhoto(file) {
  if (!file) {
    return;
  }

  if (
    !file.type.startsWith(
      "image/"
    )
  ) {
    throw new Error(
      "請選擇圖片檔案"
    );
  }

  const data =
    await fileData(file);

  state.editorHeroId =
    null;

  await openEditor(data);
}

/* =====================================================
   26. 上傳輸入框綁定

   避免重複註冊 change 事件。
===================================================== */

function setupPhotoInputs() {
  const ids = [
    "photoFile",
    "cameraUpload"
  ];

  for (const id of ids) {
    const input =
      $(id);

    if (!input) {
      continue;
    }

    if (
      input.dataset
        .mindspaceBound ===
      "true"
    ) {
      continue;
    }

    input.dataset
      .mindspaceBound =
      "true";

    input.addEventListener(
      "change",
      async () => {
        const file =
          input.files?.[0];

        if (!file) {
          return;
        }

        try {
          await uploadPlusPlusPhoto(
            file
          );

        } catch (error) {
          status(
            "❌ 圖片上傳失敗：" +
            error.message
          );

        } finally {
          input.value = "";
        }
      }
    );
  }
}

/* =====================================================
   第 2 段結束

   下一段：
   27. 去背編輯器
   28. AI 去背
   29. 手動擦除與還原
   30. 裁切
   31. 儲存原始積木作品
   32. Character / Environment 進場
===================================================== */

/* =====================================================
   27. 去背編輯器
===================================================== */

async function openEditor(src) {
  const image = await imageLoad(src);
  const canvas = $("editCanvas");

  if (!canvas) {
    throw new Error("找不到去背編輯畫布 editCanvas");
  }

  const ratio = Math.min(
    1,
    1000 / Math.max(image.width, image.height)
  );

  canvas.width = Math.max(
    1,
    Math.round(image.width * ratio)
  );

  canvas.height = Math.max(
    1,
    Math.round(image.height * ratio)
  );

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  ctx.clearRect(
    0,
    0,
    canvas.width,
    canvas.height
  );

  ctx.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  );

  state.editorOriginal = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  state.editorHistory = [];
  state.editorMode = "erase";
  state.editorPainting = false;
  state.editorLastPoint = null;

  modal("editorModal", true);

  status(
    "🧩 已載入積木照片。可使用 AI 去背或手動修整。"
  );
}

/* =====================================================
   28. 編輯歷史
===================================================== */

function editorHistory() {
  const canvas = $("editCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  state.editorHistory.push(
    ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )
  );

  if (state.editorHistory.length > 12) {
    state.editorHistory.shift();
  }
}

function undoEditor() {
  const previous = state.editorHistory.pop();

  if (!previous) {
    status("目前沒有可復原的步驟");
    return;
  }

  const canvas = $("editCanvas");

  canvas
    .getContext("2d")
    .putImageData(previous, 0, 0);

  status("↶ 已復原上一步");
}

function resetEditor() {
  if (!state.editorOriginal) return;

  editorHistory();

  $("editCanvas")
    .getContext("2d")
    .putImageData(
      state.editorOriginal,
      0,
      0
    );

  status("↺ 已恢復這次拍攝的原始照片");
}

/* =====================================================
   29. 快速去背

   以照片邊緣相近的顏色做連通區域去背。
   不重新生成物體，也不修改 RGB 色彩。

   適合單色背景；複雜背景建議使用 AI 去背。
===================================================== */

function quickRemoveBg() {
  const canvas = $("editCanvas");

  if (!canvas) {
    throw new Error("找不到去背畫布");
  }

  const width = canvas.width;
  const height = canvas.height;

  if (!width || !height) {
    throw new Error("請先載入照片");
  }

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const image = ctx.getImageData(
    0,
    0,
    width,
    height
  );

  const data = image.data;

  const bg = [0, 0, 0];

  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1]
  ];

  for (const [x, y] of corners) {
    const i = (y * width + x) * 4;

    for (let c = 0; c < 3; c++) {
      bg[c] += data[i + c] / 4;
    }
  }

  const seen = new Uint8Array(
    width * height
  );

  const queue = new Int32Array(
    width * height
  );

  let head = 0;
  let tail = 0;

  function enqueue(x, y) {
    if (
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height
    ) {
      return;
    }

    const key = y * width + x;

    if (seen[key]) return;

    const i = key * 4;

    const difference =
      (data[i] - bg[0]) ** 2 +
      (data[i + 1] - bg[1]) ** 2 +
      (data[i + 2] - bg[2]) ** 2;

    if (difference > 4900) return;

    seen[key] = 1;
    queue[tail++] = key;
  }

  editorHistory();

  for (let x = 0; x < width; x++) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }

  for (let y = 0; y < height; y++) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }

  while (head < tail) {
    const key = queue[head++];

    const x = key % width;
    const y = Math.floor(key / width);

    data[key * 4 + 3] = 0;

    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  ctx.putImageData(image, 0, 0);

  status(
    "✨ 快速去背完成。可用筆刷擦除或還原細節。"
  );
}

/* =====================================================
   30. AI 自動去背

   使用新版 GAS：
   removeBackgroundAI

   為避免生成式去背改變原始積木細節，
   只取 AI 結果的透明度遮罩，
   RGB 仍使用原始照片的像素。
===================================================== */

async function aiRemoveBg() {
  const button = $("removeBgAI");
  const canvas = $("editCanvas");

  if (!canvas || !state.editorOriginal) {
    throw new Error("請先載入積木照片");
  }

  if (button) button.disabled = true;

  status("🤖 AI 正在辨識積木輪廓並移除背景……");

  try {
    const sourceImage = await scaledData(
      canvas.toDataURL("image/png"),
      650
    );

    const result = await callAI(
      "removeBackgroundAI",
      {
        image: sourceImage,
        preserveOriginal: true,
        subject: "Plus-Plus interlocking blocks"
      },
      180000
    );

    if (!result?.image) {
      throw new Error("AI 沒有回傳去背圖片");
    }

    const removed = await imageLoad(
      result.image
    );

    /*
      AI 的去背圖可能經過縮放。
      先將其透明度遮罩映射回原始畫布尺寸。
    */

    const maskCanvas =
      document.createElement("canvas");

    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;

    const maskCtx = maskCanvas.getContext(
      "2d",
      { willReadFrequently: true }
    );

    maskCtx.drawImage(
      removed,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const mask = maskCtx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    /*
      以「本次拍攝的原始像素」重建圖片。
      只使用 AI 結果的 alpha。
    */

    const output = new ImageData(
      new Uint8ClampedArray(
        state.editorOriginal.data
      ),
      canvas.width,
      canvas.height
    );

    for (
      let i = 0;
      i < output.data.length;
      i += 4
    ) {
      output.data[i + 3] =
        Math.min(
          output.data[i + 3],
          mask.data[i + 3]
        );
    }

    editorHistory();

    canvas
      .getContext("2d")
      .putImageData(output, 0, 0);

    status(
      "✅ AI 去背完成。積木原始色彩已保留，可繼續手動修整。"
    );

  } finally {
    if (button) button.disabled = false;
  }
}

/* =====================================================
   31. 手動擦除與還原
===================================================== */

function editorPoint(event) {
  const canvas = $("editCanvas");
  const rect = canvas.getBoundingClientRect();

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
  if (!state.editorPainting) return;

  event.preventDefault();

  const canvas = $("editCanvas");

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const image = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const data = image.data;
  const original = state.editorOriginal.data;

  const point = editorPoint(event);

  const previous =
    state.editorLastPoint || point;

  const brushInput = $("brushSize");

  const radius = Math.max(
    1,
    Number(brushInput?.value || 28) / 2
  );

  const distance = Math.hypot(
    point.x - previous.x,
    point.y - previous.y
  );

  const steps = Math.max(
    1,
    Math.ceil(
      distance /
      Math.max(1, radius / 2)
    )
  );

  for (
    let step = 0;
    step <= steps;
    step++
  ) {
    const x =
      previous.x +
      (point.x - previous.x) *
      step / steps;

    const y =
      previous.y +
      (point.y - previous.y) *
      step / steps;

    const minY = Math.max(
      0,
      Math.floor(y - radius)
    );

    const maxY = Math.min(
      canvas.height - 1,
      Math.ceil(y + radius)
    );

    const minX = Math.max(
      0,
      Math.floor(x - radius)
    );

    const maxX = Math.min(
      canvas.width - 1,
      Math.ceil(x + radius)
    );

    for (
      let yy = minY;
      yy <= maxY;
      yy++
    ) {
      for (
        let xx = minX;
        xx <= maxX;
        xx++
      ) {
        const inside =
          (xx - x) ** 2 +
          (yy - y) ** 2 <=
          radius ** 2;

        if (!inside) continue;

        const i =
          (yy * canvas.width + xx) * 4;

        if (
          state.editorMode === "erase"
        ) {
          data[i + 3] = 0;

        } else {
          /*
            還原筆刷：
            從原始照片恢復完整 RGBA。
          */

          for (let c = 0; c < 4; c++) {
            data[i + c] =
              original[i + c];
          }
        }
      }
    }
  }

  ctx.putImageData(image, 0, 0);

  state.editorLastPoint = point;
}

/* =====================================================
   32. 筆刷事件

   支援滑鼠、觸控筆、觸控螢幕。
===================================================== */

function setupEditorPainting() {
  const canvas = $("editCanvas");

  if (!canvas) return;

  if (
    canvas.dataset.mindspacePaintBound ===
    "true"
  ) {
    return;
  }

  canvas.dataset.mindspacePaintBound =
    "true";

  canvas.addEventListener(
    "pointerdown",
    event => {
      if (!state.editorOriginal) return;

      event.preventDefault();

      editorHistory();

      state.editorPainting = true;
      state.editorLastPoint = null;

      try {
        canvas.setPointerCapture(
          event.pointerId
        );
      } catch (error) {
        console.warn(error);
      }

      paintEditor(event);
    }
  );

  canvas.addEventListener(
    "pointermove",
    paintEditor
  );

  const stopPainting = () => {
    state.editorPainting = false;
    state.editorLastPoint = null;
  };

  canvas.addEventListener(
    "pointerup",
    stopPainting
  );

  canvas.addEventListener(
    "pointercancel",
    stopPainting
  );

  canvas.addEventListener(
    "lostpointercapture",
    stopPainting
  );
}

/* =====================================================
   33. 裁切透明圖片

   只裁切透明邊界，
   不變更積木本身的形狀。
===================================================== */

function cropEditor() {
  const canvas = $("editCanvas");

  if (!canvas) {
    throw new Error("找不到去背畫布");
  }

  const width = canvas.width;
  const height = canvas.height;

  const ctx = canvas.getContext("2d", {
    willReadFrequently: true
  });

  const data = ctx.getImageData(
    0,
    0,
    width,
    height
  ).data;

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha =
        data[
          (y * width + x) * 4 + 3
        ];

      if (alpha > 10) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right < left || bottom < top) {
    throw new Error(
      "整張照片都變透明了，請先還原部分積木內容"
    );
  }

  const padding = 8;

  left = Math.max(
    0,
    left - padding
  );

  top = Math.max(
    0,
    top - padding
  );

  right = Math.min(
    width - 1,
    right + padding
  );

  bottom = Math.min(
    height - 1,
    bottom + padding
  );

  const cropped =
    document.createElement("canvas");

  cropped.width =
    right - left + 1;

  cropped.height =
    bottom - top + 1;

  cropped
    .getContext("2d")
    .drawImage(
      canvas,
      left,
      top,
      cropped.width,
      cropped.height,
      0,
      0,
      cropped.width,
      cropped.height
    );

  return cropped.toDataURL(
    "image/png"
  );
}

/* =====================================================
   34. 原始積木角色 DOM

   AI 新造型使用獨立容器。
   原始作品不會被取代。
===================================================== */

function createHeroElement(hero) {
  if (!hero) return;

  preserveOriginalHero(hero);

  const actors = $("actors");

  if (!actors) {
    throw new Error(
      "找不到角色容器 actors"
    );
  }

  hero.element?.remove();

  const el =
    document.createElement("div");

  el.className =
    "mindspace-hero";

  el.dataset.heroId =
    hero.id;

  el.style.cssText =
    "position:absolute;" +
    "width:145px;" +
    "height:145px;" +
    "transform-origin:center;" +
    "pointer-events:auto;" +
    "cursor:pointer;" +
    "will-change:left,top,transform;";

  const original =
    document.createElement("img");

  original.src =
    hero.plusPlusOriginal ||
    hero.original;

  original.draggable = false;

  original.style.cssText =
    "position:absolute;" +
    "inset:0;" +
    "width:100%;" +
    "height:100%;" +
    "object-fit:contain;" +
    "z-index:2;" +
    "filter:drop-shadow(0 5px 7px #2345);";

  /*
    保留一評 transformedElement 欄位，
    但不允許它取代原始積木。
  */

  const transformed =
    document.createElement("img");

  transformed.draggable = false;

  transformed.style.cssText =
    "position:absolute;" +
    "inset:0;" +
    "width:100%;" +
    "height:100%;" +
    "object-fit:contain;" +
    "display:none;" +
    "pointer-events:none;";

  /*
    Plus-Plus AI 延伸造型：
    獨立圖層。
  */

  const extensions =
    document.createElement("div");

  extensions.className =
    "plus-plus-extensions";

  extensions.style.cssText =
    "position:absolute;" +
    "inset:0;" +
    "z-index:3;" +
    "pointer-events:none;" +
    "overflow:visible;";

  const label =
    document.createElement("span");

  label.textContent =
    hero.name;

  label.style.cssText =
    "position:absolute;" +
    "bottom:-23px;" +
    "left:50%;" +
    "transform:translateX(-50%);" +
    "white-space:nowrap;" +
    "background:#ffffffed;" +
    "border-radius:15px;" +
    "padding:4px 10px;" +
    "font-size:12px;" +
    "font-weight:bold;" +
    "z-index:8;";

  /*
    Environment 中央作品
    不顯示角色名稱標籤。
  */

  if (
    hero.plusPlusMode ===
    "environment"
  ) {
    label.style.display = "none";
  }

  el.append(
    original,
    transformed,
    extensions,
    label
  );

  actors.appendChild(el);

  hero.element = el;
  hero.originalElement = original;
  hero.transformedElement = transformed;
  hero.nameElement = label;
  hero.plusPlusExtensionElement = extensions;

  el.addEventListener(
    "click",
    () => {
      state.selectedId = hero.id;
      refreshHeroes();
    }
  );

  /*
    新作品進場動畫。
    不修改原始圖片。
  */

  el.animate(
    [
      {
        opacity: 0,
        scale: 0.65
      },
      {
        opacity: 1,
        scale: 1.08,
        offset: 0.7
      },
      {
        opacity: 1,
        scale: 1
      }
    ],
    {
      duration: 1100,
      easing: "ease-out"
    }
  );
}

/* =====================================================
   35. 作品清單
===================================================== */

function refreshHeroes() {
  const list = $("heroList");
  const select = $("selectedHero");

  if (!list || !select) return;

  list.replaceChildren();
  select.replaceChildren();

  for (const hero of state.heroes) {
    const row =
      document.createElement("div");

    row.style.cssText =
      "display:flex;" +
      "align-items:center;" +
      "gap:7px;" +
      "padding:7px;" +
      "margin-bottom:6px;" +
      "border-radius:12px;" +
      "background:" +
      (
        hero.id === state.selectedId
          ? "#e6d7ff"
          : "#f3ecff"
      );

    const image =
      document.createElement("img");

    image.src =
      hero.plusPlusOriginal ||
      hero.original;

    image.style.cssText =
      "width:43px;" +
      "height:43px;" +
      "object-fit:contain;";

    const choose =
      document.createElement("button");

    choose.textContent =
      hero.name;

    choose.style.flex = "1";

    choose.onclick = () => {
      state.selectedId = hero.id;
      refreshHeroes();
    };

    const rename =
      document.createElement("button");

    rename.textContent = "✏️";
    rename.title = "重新命名積木作品";

    rename.onclick = () => {
      const name = prompt(
        "幫積木作品取名字",
        hero.name
      );

      if (!name?.trim()) return;

      hero.name =
        name.trim().slice(0, 30);

      if (hero.nameElement) {
        hero.nameElement.textContent =
          hero.name;
      }

      refreshHeroes();
    };

    row.append(
      image,
      choose,
      rename
    );

    list.appendChild(row);

    const option =
      document.createElement("option");

    option.value = hero.id;
    option.textContent = hero.name;

    select.appendChild(option);

    if (hero.element) {
      hero.element.style.zIndex =
        hero.id === state.selectedId
          ? "12"
          : "5";
    }
  }

  if (!state.heroes.length) {
    list.textContent =
      "🌱 還沒有 Plus-Plus 積木作品";
  }

  select.value =
    state.selectedId || "";

  const hero = heroNow();
  const appearance = $("appearance");

  if (appearance) {
    appearance.textContent =
      hero?.appearance
        ? "🧠 " +
          hero.appearance +
          (
            hero.personality
              ? "｜💭 " +
                hero.personality
              : ""
          )
        : "";
  }
}

/* =====================================================
   36. 儲存積木作品

   Character：
   保存成可移動角色。

   Environment：
   保存成場景中央核心物件。

   兩者都保留原始圖片。
===================================================== */

function saveHero() {
  const image = cropEditor();

  let hero = state.heroes.find(
    item =>
      item.id === state.editorHeroId
  );

  const isNew = !hero;

  if (hero) {
    /*
      使用者手動重新編輯原作品時，
      才允許更新原始圖。

      AI 造型延伸不會經過這個流程。
    */

    hero.original = image;
    hero.plusPlusOriginal = image;
    hero.transformed = null;

    hero.originalElement.src = image;

    showOriginalPlusPlus(hero);

  } else {
    hero = {
      id: uid(),

      name:
        state.creationMode === "environment"
          ? "積木場景" +
            (state.heroes.length + 1)
          : "積木朋友" +
            (state.heroes.length + 1),

      original: image,
      plusPlusOriginal: image,

      transformed: null,

      plusPlusMode:
        state.creationMode,

      plusPlusExtensions: [],

      appearance: "",
      personality: "",

      skills: [],
      aiSkills: [],

      x:
        state.creationMode === "environment"
          ? 0.5
          : 0.23 +
            (
              state.heroes.length % 3
            ) * 0.23,

      y:
        state.creationMode === "environment"
          ? 0.5
          : 0.37 +
            (
              state.heroes.length % 2
            ) * 0.17,

      vx:
        state.creationMode === "environment"
          ? 0
          : 0.00025,

      face: 1,

      phase:
        Math.random() *
        Math.PI * 2,

      action: null,

      skillUntil: 0,

      activeSkillEffects: []
    };

    state.heroes.push(hero);

    createHeroElement(hero);
  }

  if (
    hero.plusPlusMode ===
    "environment"
  ) {
    state.environmentCenterpieceId =
      hero.id;

    hero.x = 0.5;
    hero.y = 0.5;
    hero.vx = 0;

    if (hero.nameElement) {
      hero.nameElement.style.display =
        "none";
    }
  }

  state.selectedId = hero.id;
  state.editorHeroId = null;

  modal(
    "editorModal",
    false
  );

  refreshHeroes();

  if (
    hero.plusPlusMode ===
    "environment"
  ) {
    status(
      "🌍 原始積木作品已放入世界中央，接下來可以讓 AI 向四周延伸場景。"
    );

    bubble(
      "🌍 這是你的世界中心！想讓它的周圍出現什麼呢？"
    );

  } else {
    status(
      "🧩 " +
      hero.name +
      " 已進入 Plus-Plus 世界！"
    );

    if (isNew) {
      welcomeHero(hero);
    }
  }

  return hero;
}

/* =====================================================
   37. 移除作品
===================================================== */

function removeHero() {
  const hero = heroNow();

  if (!hero) {
    status("請先選擇積木作品");
    return;
  }

  const confirmed = confirm(
    "確定移除「" +
    hero.name +
    "」嗎？"
  );

  if (!confirmed) return;

  hero.element?.remove();

  state.heroes =
    state.heroes.filter(
      item =>
        item.id !== hero.id
    );

  state.plusPlusAccessories.delete(
    hero.id
  );

  if (
    state.environmentCenterpieceId ===
    hero.id
  ) {
    state.environmentCenterpieceId =
      null;
  }

  state.selectedId =
    state.heroes[0]?.id ||
    null;

  refreshHeroes();

  status(
    "🗑️ 已移除：" +
    hero.name
  );
}

/* =====================================================
   第 3 段結束

   下一段：
   38. AI 分析積木作品
   39. Character 世界生成
   40. Environment 場景融合
   41. AI 積木配件生成
   42. 自由語音創作與多步驟操作
===================================================== */

/* =====================================================
   38. AI 分析 Plus-Plus 積木作品

   後端：analyzeCreation

   AI 觀察真實積木的：
   - 外觀
   - 顏色
   - 結構
   - 身分
   - 適合的世界
   - 場景融合方式

   不會重新生成原始積木。
===================================================== */

async function inspectHero() {
  const hero = heroNow();

  if (!hero) {
    throw new Error(
      "請先拍攝或選擇積木作品"
    );
  }

  preserveOriginalHero(hero);

  status(
    "🧠 AI 正在觀察原始 Plus-Plus 積木……"
  );

  const description =
    $("creationDescription")?.value?.trim() ||
    state.creationDescription ||
    "";

  const image = await scaledData(
    hero.plusPlusOriginal,
    650
  );

  const result = await callAI(
    "analyzeCreation",
    {
      image,
      description,
      type: hero.plusPlusMode,
      mode: hero.plusPlusMode
    },
    120000
  );

  if (!result || typeof result !== "object") {
    throw new Error(
      "AI 沒有回傳有效的作品分析"
    );
  }

  hero.plusPlusAnalysis = result;

  hero.appearance =
    result.appearance ||
    result.structure ||
    "";

  hero.personality =
    result.personality ||
    "";

  hero.identity =
    result.identity ||
    "";

  /*
    不自動改名。
    長輩自己取的名字應優先保留。
  */

  state.creationAnalysis = result;

  refreshHeroes();

  const summary = [
    result.identity,
    result.appearance,
    result.structure
  ].filter(Boolean).join("。");

  bubble(
    "🧩 " +
    (
      summary ||
      "我看見你的積木創作了！"
    )
  );

  status(
    "✅ AI 已完成積木作品分析"
  );

  return result;
}

/* =====================================================
   39. 取得 AI 圖像結果

   新版 Code.gs 回傳：
   {
     image: "data:image/png;base64,..."
   }

   如果後端回傳純 Base64，
   也可以轉換成圖片來源。
===================================================== */

function plusPlusImageSource(result) {
  if (!result) {
    throw new Error(
      "AI 沒有回傳圖片"
    );
  }

  const value =
    typeof result === "string"
      ? result
      : (
        result.image ||
        result.imageBase64 ||
        result.dataUrl ||
        ""
      );

  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    throw new Error(
      "AI 圖片資料為空"
    );
  }

  if (
    value.startsWith("data:image/")
  ) {
    return value;
  }

  if (
    value.startsWith("https://")
  ) {
    return value;
  }

  /*
    純 Base64 圖像。
  */

  if (
    /^[A-Za-z0-9+/=\s]+$/.test(value)
  ) {
    return (
      "data:image/png;base64," +
      value.replace(/\s/g, "")
    );
  }

  throw new Error(
    "AI 回傳的圖片格式不正確"
  );
}

/* =====================================================
   40. 取得原始積木分析

   已分析過的作品不重複呼叫 AI。
===================================================== */

async function ensurePlusPlusAnalysis(hero) {
  if (!hero) {
    throw new Error(
      "尚未選擇積木作品"
    );
  }

  if (hero.plusPlusAnalysis) {
    return hero.plusPlusAnalysis;
  }

  const previousId =
    state.selectedId;

  state.selectedId = hero.id;

  try {
    return await inspectHero();

  } finally {
    state.selectedId = previousId;
    refreshHeroes();
  }
}

/* =====================================================
   41. 建立 Character 世界

   AI 只生成世界背景。
   原始積木角色使用獨立圖層顯示。
===================================================== */

async function generateCharacterWorld(
  hero,
  description = ""
) {
  if (!hero) {
    throw new Error(
      "請先建立積木角色"
    );
  }

  const analysis =
    await ensurePlusPlusAnalysis(hero);

  const info = {
    ...analysis,

    name: hero.name,

    description:
      description ||
      analysis.description ||
      "",

    worldPrompt:
      [
        analysis.worldPrompt || "",
        description || ""
      ].filter(Boolean).join("\n"),

    originalDescription:
      analysis.appearance || "",

    type: "character"
  };

  creationProgress(
    "🌈 AI 正在為原始積木角色創造 Plus-Plus 世界……"
  );

  const result = await callAI(
    "generateWorld",
    {
      info,
      analysis: info
    },
    180000
  );

  const image =
    plusPlusImageSource(result);

  await imageLoad(image);

  displayPlusPlusWorld(
    image,
    result.worldName ||
    hero.name + "的積木世界"
  );

  state.generatedWorldMode =
    "character";

  hero.plusPlusMode =
    "character";

  showOriginalPlusPlus(hero);

  /*
    保留角色的可活動屬性。
  */

  hero.vx =
    hero.vx || 0.00025;

  hero.plusPlusMovement =
    analysis.movement ||
    "float";

  creationProgress(
    "✅ Plus-Plus 角色世界生成完成"
  );

  bubble(
    "🧩 " +
    hero.name +
    "的世界完成了！你想讓它做什麼呢？"
  );

  return result;
}

/* =====================================================
   42. 建立 Environment 世界

   生成的場景必須：
   1. 以原始積木為中心
   2. 向四周延伸
   3. 與原作品顏色及結構融合
   4. 不複製或重新生成原作品
===================================================== */

async function generateEnvironmentWorld(
  hero,
  description = ""
) {
  if (!hero) {
    throw new Error(
      "請先拍攝場景核心積木"
    );
  }

  const analysis =
    await ensurePlusPlusAnalysis(hero);

  const info = {
    ...analysis,

    name: hero.name,

    type: "environment",

    description:
      description ||
      analysis.description ||
      "",

    worldPrompt:
      [
        analysis.worldPrompt || "",
        description || ""
      ].filter(Boolean).join("\n"),

    integration:
      [
        analysis.integration || "",
        "The original handmade object must remain at the center.",
        "Extend matching Plus-Plus construction scenery around it.",
        "Do not duplicate or redraw the centerpiece.",
        "Connect surrounding paths, terrain and structures visually."
      ].join("\n")
  };

  creationProgress(
    "🌍 AI 正在依照原始積木向四周延伸 Plus-Plus 場景……"
  );

  const result = await callAI(
    "generateEnvironmentLayer",
    {
      info,
      analysis: info
    },
    180000
  );

  const image =
    plusPlusImageSource(result);

  await imageLoad(image);

  displayPlusPlusWorld(
    image,
    result.worldName ||
    hero.name + "的積木世界"
  );

  state.generatedWorldMode =
    "environment";

  state.environmentCenterpieceId =
    hero.id;

  hero.plusPlusMode =
    "environment";

  hero.x = 0.5;
  hero.y = 0.5;
  hero.vx = 0;

  showOriginalPlusPlus(hero);

  /*
    Environment 核心作品在世界中央。
    後續動畫引擎不得讓它自主游動。
  */

  if (hero.element) {
    hero.element.style.left =
      "50%";

    hero.element.style.top =
      "50%";

    hero.element.style.width =
      "min(30vw,260px)";

    hero.element.style.height =
      "min(30vw,260px)";

    hero.element.style.transform =
      "translate(-50%,-50%)";

    hero.element.style.zIndex =
      "6";
  }

  /*
    場景完成後播放約 3 秒特效。
    效果內容由 AI 回傳，
    前端不透過長輩說話的關鍵字決定。
  */

  await playPlusPlusWorldEffect({
    description:
      result.effect ||
      analysis.effect ||
      "colorful Plus-Plus celebration",

    duration: 3000
  });

  creationProgress(
    "✅ Plus-Plus 場景完成"
  );

  const invitation =
    "你的積木世界完成了！" +
    "你還想在這個世界裡加入什麼呢？";

  bubble(invitation);

  chat(
    "🧩 AI 夥伴",
    invitation,
    true
  );

  await speak(invitation);

  return result;
}

/* =====================================================
   43. 生成世界主按鈕

   不重新拍照。
   直接使用已儲存的原始積木。
===================================================== */

async function generateCreationWorld() {
  if (state.worldGenerating) {
    return;
  }

  const hero = heroNow();

  if (!hero) {
    throw new Error(
      "請先拍攝、去背並儲存積木作品"
    );
  }

  const description =
    $("creationDescription")?.value?.trim() ||
    "";

  state.creationDescription =
    description;

  state.worldGenerating = true;

  const button =
    $("generateCreationWorld");

  if (button) {
    button.disabled = true;
  }

  try {
    /*
      模式由長輩選擇，
      而不是 AI 擅自改變。
    */

    hero.plusPlusMode =
      state.creationMode;

    if (
      state.creationMode ===
      "environment"
    ) {
      await generateEnvironmentWorld(
        hero,
        description
      );

    } else {
      await generateCharacterWorld(
        hero,
        description
      );
    }

  } catch (error) {
    creationProgress(
      "❌ 世界生成失敗：" +
      error.message
    );

    throw error;

  } finally {
    state.worldGenerating = false;

    if (button) {
      button.disabled = false;
    }
  }
}

/* =====================================================
   44. 配件附著位置

   這些是通用的幾何位置，
   不是語音關鍵字判斷。

   AI 決定 placement，
   前端只負責渲染。
===================================================== */

const PLUSPLUS_PLACEMENTS = {
  head: {
    x: 50,
    y: -15
  },

  top: {
    x: 50,
    y: -12
  },

  left: {
    x: 4,
    y: 48
  },

  right: {
    x: 96,
    y: 48
  },

  back: {
    x: 50,
    y: 45
  },

  front: {
    x: 50,
    y: 52
  },

  tail: {
    x: 88,
    y: 72
  },

  bottom: {
    x: 50,
    y: 103
  },

  center: {
    x: 50,
    y: 50
  }
};

/* =====================================================
   45. 建立獨立 Plus-Plus 配件圖層

   原始積木的 original
   和 plusPlusOriginal 都不修改。
===================================================== */

function attachPlusPlusAccessory(
  hero,
  accessory
) {
  if (!hero) {
    throw new Error(
      "找不到配件所屬的角色"
    );
  }

  if (!accessory?.image) {
    throw new Error(
      "配件沒有圖片"
    );
  }

  const layer =
    hero.plusPlusExtensionElement;

  if (!layer) {
    throw new Error(
      "角色缺少延伸造型圖層"
    );
  }

  const placement =
    PLUSPLUS_PLACEMENTS[
      accessory.placement
    ] ||
    PLUSPLUS_PLACEMENTS.center;

  const wrapper =
    document.createElement("div");

  wrapper.className =
    "plus-plus-accessory";

  wrapper.dataset.accessoryId =
    accessory.id;

  wrapper.dataset.accessoryName =
    accessory.name || "";

  wrapper.style.cssText =
    "position:absolute;" +
    "left:" + placement.x + "%;" +
    "top:" + placement.y + "%;" +
    "width:80%;" +
    "height:80%;" +
    "transform:translate(-50%,-50%);" +
    "pointer-events:none;" +
    "z-index:4;";

  const image =
    document.createElement("img");

  image.src =
    accessory.image;

  image.alt =
    accessory.name ||
    "Plus-Plus 積木延伸造型";

  image.draggable = false;

  image.style.cssText =
    "display:block;" +
    "width:100%;" +
    "height:100%;" +
    "object-fit:contain;" +
    "filter:drop-shadow(0 3px 4px #2345);";

  wrapper.appendChild(image);

  layer.appendChild(wrapper);

  accessory.element =
    wrapper;

  wrapper.animate(
    [
      {
        opacity: 0,
        scale: 0.25
      },
      {
        opacity: 1,
        scale: 1.12,
        offset: 0.7
      },
      {
        opacity: 1,
        scale: 1
      }
    ],
    {
      duration: 950,
      easing: "ease-out"
    }
  );

  return wrapper;
}

/* =====================================================
   46. AI 自由生成積木配件

   AI 依照長輩描述產生圖片。
   不使用 if("翅膀") 等關鍵字。

   後端：generateAccessory
===================================================== */

async function generatePlusPlusAccessory(
  hero,
  operation
) {
  if (!hero) {
    throw new Error(
      "請先選擇角色"
    );
  }

  const description =
    operation.description ||
    operation.name ||
    "";

  if (!description) {
    throw new Error(
      "AI 沒有提供延伸造型描述"
    );
  }

  preserveOriginalHero(hero);

  creationProgress(
    "🧩 AI 正在生成：" +
    description
  );

  const analysis =
    hero.plusPlusAnalysis || {};

  const result = await callAI(
    "generateAccessory",
    {
      name:
        operation.name ||
        "積木延伸造型",

      description,

      originalDescription:
        [
          analysis.appearance || "",
          analysis.structure || "",
          hero.appearance || ""
        ].filter(Boolean).join("。"),

      placement:
        operation.placement ||
        "center"
    },
    180000
  );

  const image =
    plusPlusImageSource(result);

  await imageLoad(image);

  const accessory = {
    id: uid(),

    name:
      operation.name ||
      result.name ||
      "積木延伸造型",

    description,

    image,

    placement:
      operation.placement ||
      "center",

    createdAt:
      Date.now()
  };

  hero.plusPlusExtensions.push(
    accessory
  );

  const existing =
    state.plusPlusAccessories.get(
      hero.id
    ) || [];

  existing.push(accessory);

  state.plusPlusAccessories.set(
    hero.id,
    existing
  );

  attachPlusPlusAccessory(
    hero,
    accessory
  );

  status(
    "✅ 已為「" +
    hero.name +
    "」加入：" +
    accessory.name
  );

  return accessory;
}

/* =====================================================
   47. 移除 AI 延伸造型

   只移除 AI 生成的配件。
   原始積木圖片完全不變。
===================================================== */

function removePlusPlusAccessory(
  hero,
  operation = {}
) {
  if (!hero) {
    return false;
  }

  const accessories =
    hero.plusPlusExtensions || [];

  const requestedName =
    String(
      operation.name ||
      operation.description ||
      ""
    ).trim();

  /*
    AI 可以指定名稱或 id。
    未指定時，移除最後加入的配件。
  */

  let index = -1;

  if (operation.id) {
    index =
      accessories.findIndex(
        item =>
          item.id === operation.id
      );
  }

  if (
    index < 0 &&
    requestedName
  ) {
    index =
      accessories.findLastIndex(
        item =>
          item.name ===
            requestedName ||
          item.description ===
            requestedName
      );
  }

  if (
    index < 0 &&
    !requestedName
  ) {
    index =
      accessories.length - 1;
  }

  if (index < 0) {
    return false;
  }

  const [removed] =
    accessories.splice(
      index,
      1
    );

  removed.element?.remove();

  const saved =
    state.plusPlusAccessories.get(
      hero.id
    ) || [];

  state.plusPlusAccessories.set(
    hero.id,
    saved.filter(
      item =>
        item.id !== removed.id
    )
  );

  status(
    "↩️ 已移除 AI 延伸造型：" +
    removed.name
  );

  return true;
}

/* =====================================================
   48. 顯示或隱藏 AI 延伸造型

   這裡只改變顯示狀態。
   不修改原始積木照片。
===================================================== */

function setPlusPlusExtensionsVisible(
  hero,
  visible
) {
  if (!hero) {
    return;
  }

  const layer =
    hero.plusPlusExtensionElement;

  if (!layer) {
    return;
  }

  layer.style.display =
    visible
      ? "block"
      : "none";

  hero.plusPlusExtensionsVisible =
    Boolean(visible);
}

/* =====================================================
   49. 還原角色原貌

   保留一評 restoreButton 的功能。
===================================================== */

function restorePlusPlusOriginal() {
  const hero = heroNow();

  if (!hero) {
    throw new Error(
      "請先選擇角色"
    );
  }

  setPlusPlusExtensionsVisible(
    hero,
    false
  );

  showOriginalPlusPlus(hero);

  status(
    "↩️ 已顯示原始 Plus-Plus 積木造型"
  );
}

/* =====================================================
   50. 顯示延伸造型

   保留一評 showTransform 按鈕。
===================================================== */

function showPlusPlusTransform() {
  const hero = heroNow();

  if (!hero) {
    throw new Error(
      "請先選擇角色"
    );
  }

  showOriginalPlusPlus(hero);

  setPlusPlusExtensionsVisible(
    hero,
    true
  );

  status(
    "✨ 已顯示 AI 延伸的 Plus-Plus 造型"
  );
}

/* =====================================================
   51. 保留一評 transformHero 函式名稱

   但不再用 AI 生成圖片取代原角色。
   改成生成獨立 Plus-Plus 配件。
===================================================== */

async function transformHero(
  hero,
  description
) {
  if (!hero) {
    hero = heroNow();
  }

  if (!hero) {
    throw new Error(
      "請先選擇積木角色"
    );
  }

  const text =
    String(
      description ||
      $("transformInput")?.value ||
      ""
    ).trim();

  if (!text) {
    throw new Error(
      "請先描述想加入的積木造型"
    );
  }

  /*
    不自行拆解長輩語意。
    交給 AI Director 判斷是否需要
    多個配件、技能或動作。

    這裡的 fallback 只處理
    單一造型生成需求。
  */

  if (
    window.MindspacePlusPlusDirector?.command
  ) {
    return await window
      .MindspacePlusPlusDirector
      .command(text);
  }

  return await generatePlusPlusAccessory(
    hero,
    {
      name: "AI 積木延伸造型",
      description: text,
      placement: "center"
    }
  );
}

/* =====================================================
   52. AI 自由語音指令入口

   不分析任何固定中文關鍵字。
   將完整語意交給後端 directWorld。

   AI 決定 operations 的內容與順序。
===================================================== */

async function requestPlusPlusDirection(
  message
) {
  const text =
    String(message || "").trim();

  if (!text) {
    throw new Error(
      "請先說出或輸入想法"
    );
  }

  const hero = heroNow();

  const heroes =
    state.heroes.map(item => ({
      id: item.id,
      name: item.name,
      type:
        item.plusPlusMode ||
        "character",
      appearance:
        item.appearance || "",
      personality:
        item.personality || "",
      accessories:
        (
          item.plusPlusExtensions ||
          []
        ).map(accessory => ({
          id: accessory.id,
          name: accessory.name,
          description:
            accessory.description
        }))
    }));

  const result = await callAI(
    "directWorld",
    {
      message: text,

      selectedHeroId:
        hero?.id || "",

      heroes,

      objects:
        state.plusPlusObjects.map(
          object => ({
            id: object.id,
            name: object.name,
            description:
              object.description
          })
        ),

      worldName:
        state.generatedWorldName ||
        "",

      worldPrompt:
        state.creationDescription ||
        "",

      history:
        state.creationHistory.slice(
          -12
        )
    },
    120000
  );

  if (
    !result ||
    typeof result !== "object"
  ) {
    throw new Error(
      "AI 沒有回傳有效的創作指令"
    );
  }

  const operations =
    Array.isArray(result.operations)
      ? result.operations
      : [];

  state.creationHistory.push({
    role: "user",
    content: text
  });

  state.creationHistory.push({
    role: "assistant",
    content:
      result.reply || ""
  });

  if (
    state.creationHistory.length > 24
  ) {
    state.creationHistory =
      state.creationHistory.slice(-24);
  }

  return {
    reply:
      result.reply || "",

    operations
  };
}

/* =====================================================
   第 4 段結束

   下一段：
   53. AI 多步驟操作執行器
   54. AI 生成環境物件與新角色
   55. Plus-Plus 技能與特效
   56. 角色動作、移動及尺寸
   57. 對接原本語音按鈕
===================================================== */

/* =====================================================
   53. AI OPERATIONS 執行器

   長輩的語音不在前端進行關鍵字判斷。

   AI 後端負責：
   1. 理解語意
   2. 決定需要哪些操作
   3. 決定操作順序
   4. 描述要生成的 Plus-Plus 視覺內容

   前端只執行 AI 回傳的結構化操作。
===================================================== */

const PLUSPLUS_OPERATION_TYPES = new Set([
  "addAccessory",
  "removeAccessory",
  "addEnvironmentObject",
  "addCharacter",
  "regenerateWorld",
  "changeMovement",
  "move",
  "changeSize",
  "activateSkill",
  "effect",
  "none"
]);

function normalizePlusPlusOperation(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const type = String(
    raw.type ||
    raw.operation ||
    raw.action ||
    ""
  ).trim();

  if (!PLUSPLUS_OPERATION_TYPES.has(type)) {
    console.warn(
      "不支援的 AI 操作：",
      type,
      raw
    );

    return null;
  }

  return {
    id: uid(),
    type,

    target:
      raw.target || "",

    name:
      raw.name || "",

    description:
      raw.description || "",

    placement:
      raw.placement || "center",

    movement:
      raw.movement || "",

    skill:
      raw.skill || "",

    effect:
      raw.effect || "",

    worldPrompt:
      raw.worldPrompt || "",

    duration: clamp(
      Number(raw.duration) || 3000,
      300,
      15000
    ),

    /*
      AI 可以提供額外的位置、
      尺寸與動畫參數。
    */

    x:
      Number.isFinite(Number(raw.x)) &&
      raw.x !== undefined &&
      raw.x !== null
        ? Number(raw.x)
        : null,

    y:
      Number.isFinite(Number(raw.y)) &&
      raw.y !== undefined &&
      raw.y !== null
        ? Number(raw.y)
        : null,

    size:
      Number.isFinite(Number(raw.size)) &&
      raw.size !== undefined &&
      raw.size !== null
        ? Number(raw.size)
        : null
  };
}

/* =====================================================
   54. AI 操作目標

   AI 可以指定角色 ID 或名稱。
   未指定時使用目前選取的角色。
===================================================== */

function findPlusPlusTarget(target) {
  if (!target) {
    return heroNow();
  }

  const text = String(target).trim();

  return (
    state.heroes.find(
      hero =>
        hero.id === text ||
        hero.name === text
    ) ||
    heroNow()
  );
}

/* =====================================================
   55. 執行單一步驟
===================================================== */

async function executePlusPlusOperation(
  operation
) {
  const op =
    normalizePlusPlusOperation(operation);

  if (!op) {
    return null;
  }

  const hero =
    findPlusPlusTarget(op.target);

  switch (op.type) {

    case "addAccessory": {
      if (!hero) {
        throw new Error(
          "AI 要新增造型，但目前沒有角色"
        );
      }

      return await generatePlusPlusAccessory(
        hero,
        op
      );
    }

    case "removeAccessory": {
      return removePlusPlusAccessory(
        hero,
        op
      );
    }

    case "addEnvironmentObject": {
      return await generatePlusPlusEnvironmentObject(
        op
      );
    }

    case "addCharacter": {
      return await generatePlusPlusCharacter(
        op
      );
    }

    case "regenerateWorld": {
      return await regeneratePlusPlusWorld(
        op
      );
    }

    case "changeMovement": {
      return changePlusPlusMovement(
        hero,
        op
      );
    }

    case "move": {
      return movePlusPlusHero(
        hero,
        op
      );
    }

    case "changeSize": {
      return changePlusPlusSize(
        hero,
        op
      );
    }

    case "activateSkill": {
      return await activatePlusPlusSkill(
        hero,
        op
      );
    }

    case "effect": {
      return await playPlusPlusWorldEffect(
        op
      );
    }

    case "none": {
      return null;
    }

    default: {
      return null;
    }
  }
}

/* =====================================================
   56. 多步驟依序執行

   例如：
   1. addAccessory
   2. changeMovement
   3. move
   4. effect

   一個步驟失敗時會記錄錯誤，
   其餘步驟仍可繼續。
===================================================== */

async function executePlusPlusOperations(
  operations = []
) {
  if (!Array.isArray(operations)) {
    return [];
  }

  const results = [];

  for (const raw of operations) {
    const op =
      normalizePlusPlusOperation(raw);

    if (!op) {
      continue;
    }

    creationProgress(
      "✨ 正在執行 AI 創作：" +
      (
        op.description ||
        op.name ||
        op.type
      )
    );

    try {
      const result =
        await executePlusPlusOperation(op);

      results.push({
        type: op.type,
        ok: true,
        result
      });

    } catch (error) {
      console.error(
        "AI 操作失敗：",
        op,
        error
      );

      results.push({
        type: op.type,
        ok: false,
        error: error.message
      });
    }
  }

  const failures =
    results.filter(
      result => !result.ok
    );

  if (failures.length) {
    status(
      "⚠️ 已完成 " +
      (results.length - failures.length) +
      " 個操作，另有 " +
      failures.length +
      " 個操作失敗。"
    );

  } else if (results.length) {
    status(
      "✅ AI 已完成 " +
      results.length +
      " 個積木創作操作"
    );
  }

  return results;
}

/* =====================================================
   57. AI 生成 Environment 物件

   後端：
   generateEnvironmentObject

   生成結果是獨立圖層，
   可以加入世界中。
===================================================== */

async function generatePlusPlusEnvironmentObject(
  operation
) {
  const description =
    operation.description ||
    operation.name;

  if (!description) {
    throw new Error(
      "缺少場景物件描述"
    );
  }

  const result = await callAI(
    "generateEnvironmentObject",
    {
      name:
        operation.name ||
        "積木場景物件",

      description,

      worldPrompt:
        state.creationDescription ||
        "",

      placement:
        operation.placement ||
        "center"
    },
    180000
  );

  const image =
    plusPlusImageSource(result);

  await imageLoad(image);

  const layer =
    plusPlusEnvironmentElement();

  if (!layer) {
    throw new Error(
      "找不到場景物件圖層"
    );
  }

  const object = {
    id: uid(),

    name:
      operation.name ||
      result.name ||
      "積木場景物件",

    description,

    image,

    placement:
      operation.placement ||
      "center",

    createdAt: Date.now()
  };

  const element =
    document.createElement("img");

  element.src = image;
  element.alt = object.name;

  element.draggable = false;

  element.dataset.objectId =
    object.id;

  element.style.cssText =
    "position:absolute;" +
    "width:22%;" +
    "height:30%;" +
    "object-fit:contain;" +
    "pointer-events:none;" +
    "filter:drop-shadow(0 5px 7px #2345);";

  /*
    AI 可以直接提供歸一化位置。
    沒有提供時採用通用場景定位。
  */

  const position =
    plusPlusWorldPosition(
      operation
    );

  element.style.left =
    (position.x * 100) + "%";

  element.style.top =
    (position.y * 100) + "%";

  element.style.transform =
    "translate(-50%,-50%)";

  layer.appendChild(element);

  object.element = element;

  state.plusPlusObjects.push(
    object
  );

  element.animate(
    [
      {
        opacity: 0,
        scale: 0.2
      },
      {
        opacity: 1,
        scale: 1.08,
        offset: 0.75
      },
      {
        opacity: 1,
        scale: 1
      }
    ],
    {
      duration: 1200,
      easing: "ease-out"
    }
  );

  return object;
}

/* =====================================================
   58. 場景位置計算

   這裡只處理幾何定位。
   不判斷長輩的語音內容。
===================================================== */

function plusPlusWorldPosition(operation = {}) {
  if (
    operation.x !== null &&
    operation.x !== undefined &&
    operation.y !== null &&
    operation.y !== undefined
  ) {
    return {
      x: clamp(
        Number(operation.x),
        0.08,
        0.92
      ),

      y: clamp(
        Number(operation.y),
        0.12,
        0.88
      )
    };
  }

  const positions = {
    left: {
      x: 0.2,
      y: 0.55
    },

    right: {
      x: 0.8,
      y: 0.55
    },

    top: {
      x: 0.5,
      y: 0.2
    },

    bottom: {
      x: 0.5,
      y: 0.8
    },

    center: {
      x: 0.5,
      y: 0.5
    },

    back: {
      x: 0.65,
      y: 0.38
    },

    front: {
      x: 0.38,
      y: 0.72
    }
  };

  return (
    positions[
      operation.placement
    ] ||
    positions.center
  );
}

/* =====================================================
   59. AI 生成新的積木配角

   原始角色不會被取代。

   後端：
   generateCharacter
===================================================== */

async function generatePlusPlusCharacter(
  operation
) {
  const description =
    operation.description ||
    operation.name;

  if (!description) {
    throw new Error(
      "AI 沒有提供新角色描述"
    );
  }

  const result = await callAI(
    "generateCharacter",
    {
      name:
        operation.name ||
        "積木朋友",

      description,

      worldPrompt:
        state.creationDescription ||
        ""
    },
    180000
  );

  const image =
    plusPlusImageSource(result);

  await imageLoad(image);

  const position =
    plusPlusWorldPosition(
      operation
    );

  const hero = {
    id: uid(),

    name:
      operation.name ||
      result.name ||
      "積木朋友",

    original: image,

    plusPlusOriginal: image,

    /*
      這個角色由 AI 生成，
      與長輩親手拼出的原始角色區分。
    */

    plusPlusGenerated: true,

    plusPlusMode:
      "character",

    plusPlusExtensions: [],

    transformed: null,

    appearance:
      description,

    personality: "",

    skills: [],
    aiSkills: [],

    x: position.x,
    y: position.y,

    vx: 0.0002,

    face: 1,

    phase:
      Math.random() *
      Math.PI * 2,

    action: null,

    skillUntil: 0,

    activeSkillEffects: []
  };

  state.heroes.push(hero);

  state.plusPlusGeneratedHeroes.push(
    hero.id
  );

  createHeroElement(hero);

  refreshHeroes();

  status(
    "🧩 AI 已創造新的 Plus-Plus 角色：" +
    hero.name
  );

  return hero;
}

/* =====================================================
   60. 重新生成世界

   只重新生成背景，
   不重新繪製原始積木作品。
===================================================== */

async function regeneratePlusPlusWorld(
  operation
) {
  const hero =
    heroNow();

  if (!hero) {
    throw new Error(
      "請先選擇積木作品"
    );
  }

  const description =
    operation.worldPrompt ||
    operation.description ||
    state.creationDescription ||
    "";

  state.creationDescription =
    description;

  if (
    state.creationMode ===
    "environment"
  ) {
    return await generateEnvironmentWorld(
      hero,
      description
    );
  }

  return await generateCharacterWorld(
    hero,
    description
  );
}

/* =====================================================
   61. AI 決定角色移動方式

   AI 回傳 movement 描述。
   前端保存參數，
   由後續 p5 動畫更新角色位置。

   不使用語音關鍵字判斷。
===================================================== */

function changePlusPlusMovement(
  hero,
  operation
) {
  if (!hero) {
    throw new Error(
      "沒有可改變動作的角色"
    );
  }

  if (
    hero.plusPlusMode ===
    "environment"
  ) {
    /*
      Environment 的原始核心作品
      固定在中央。
    */

    return false;
  }

  hero.plusPlusMovement =
    operation.movement ||
    operation.description ||
    "gentle floating";

  hero.plusPlusMovementStarted =
    performance.now();

  hero.plusPlusMovementDuration =
    operation.duration || 3000;

  status(
    "✨ " +
    hero.name +
    " 的移動方式已更新"
  );

  return true;
}

/* =====================================================
   62. 移動原始角色

   不修改原始圖片。
   只更新角色在世界中的座標。
===================================================== */

function movePlusPlusHero(
  hero,
  operation
) {
  if (!hero) {
    throw new Error(
      "沒有可移動的角色"
    );
  }

  if (
    hero.plusPlusMode ===
    "environment"
  ) {
    return false;
  }

  const position =
    plusPlusWorldPosition(
      operation
    );

  const startX =
    Number(hero.x) || 0.5;

  const startY =
    Number(hero.y) || 0.5;

  hero.plusPlusMove = {
    startX,
    startY,

    endX: position.x,
    endY: position.y,

    started:
      performance.now(),

    duration:
      operation.duration ||
      3000
  };

  return true;
}

/* =====================================================
   63. 改變角色顯示尺寸

   原始圖片像素不變。
===================================================== */

function changePlusPlusSize(
  hero,
  operation
) {
  if (!hero) {
    throw new Error(
      "沒有可調整尺寸的角色"
    );
  }

  const size =
    operation.size !== null
      ? operation.size
      : 1.2;

  hero.plusPlusScale =
    clamp(
      Number(size) || 1,
      0.3,
      3
    );

  return hero.plusPlusScale;
}

/* =====================================================
   64. Plus-Plus 世界特效

   特效圖像由 AI 生成，
   前端只負責顯示與播放時間。

   不用固定「火焰、雷射、冰霜」
   等中文關鍵字判斷。
===================================================== */

async function playPlusPlusWorldEffect(
  operation = {}
) {
  const layer =
    plusPlusEffectElement();

  if (!layer) {
    throw new Error(
      "找不到技能特效圖層"
    );
  }

  const duration = clamp(
    Number(operation.duration) ||
    3000,
    300,
    15000
  );

  const description =
    operation.effect ||
    operation.description ||
    "colorful Plus-Plus magical effect";

  /*
    使用後端的通用圖像生成能力。
    不依賴固定技能圖片。
  */

  const result = await callAI(
    "generateEnvironmentObject",
    {
      name:
        operation.name ||
        "Plus-Plus 動態特效",

      description:
        "A transparent-background Plus-Plus " +
        "construction toy visual effect: " +
        description,

      worldPrompt:
        state.creationDescription ||
        "",

      placement: "center"
    },
    180000
  );

  const image =
    plusPlusImageSource(result);

  await imageLoad(image);

  const element =
    document.createElement("img");

  element.src = image;
  element.alt = "Plus-Plus 積木特效";

  element.style.cssText =
    "position:absolute;" +
    "left:50%;" +
    "top:50%;" +
    "width:min(65vw,650px);" +
    "height:min(65vh,550px);" +
    "object-fit:contain;" +
    "transform:translate(-50%,-50%);" +
    "pointer-events:none;";

  layer.appendChild(element);

  try {
    const animation =
      element.animate(
        [
          {
            opacity: 0,
            scale: 0.35,
            rotate: "-12deg"
          },
          {
            opacity: 1,
            scale: 1.05,
            rotate: "5deg",
            offset: 0.4
          },
          {
            opacity: 0.95,
            scale: 1.12,
            rotate: "0deg",
            offset: 0.75
          },
          {
            opacity: 0,
            scale: 1.35,
            rotate: "10deg"
          }
        ],
        {
          duration,
          easing: "ease-in-out",
          fill: "forwards"
        }
      );

    await animation.finished;

  } catch (error) {
    console.warn(
      "特效動畫被中斷：",
      error
    );

  } finally {
    element.remove();
  }

  return true;
}

/* =====================================================
   65. AI 自由技能

   AI 決定技能的視覺內容。

   不是固定技能清單。
===================================================== */

async function activatePlusPlusSkill(
  hero,
  operation
) {
  if (!hero) {
    throw new Error(
      "請先選擇要施展技能的角色"
    );
  }

  const description =
    operation.skill ||
    operation.description ||
    operation.effect ||
    "";

  if (!description) {
    throw new Error(
      "AI 沒有提供技能描述"
    );
  }

  const skill = {
    id: uid(),

    name:
      operation.name ||
      "Plus-Plus 特殊能力",

    description,

    createdAt:
      Date.now()
  };

  if (!Array.isArray(hero.aiSkills)) {
    hero.aiSkills = [];
  }

  hero.aiSkills.push(skill);

  hero.skillUntil =
    performance.now() +
    (
      operation.duration ||
      3000
    );

  await playPlusPlusWorldEffect({
    name: skill.name,

    description:
      "Visualize the ability of " +
      hero.name +
      ": " +
      description,

    duration:
      operation.duration ||
      3000
  });

  return skill;
}

/* =====================================================
   66. 從 AI 回應到畫面呈現

   對話文字與操作結果分開處理。
===================================================== */

async function performPlusPlusCommand(
  message
) {
  const text =
    String(message || "").trim();

  if (!text) {
    return null;
  }

  if (state.operationRunning) {
    throw new Error(
      "AI 正在執行上一個創作，請稍候"
    );
  }

  state.operationRunning = true;

  try {
    chat(
      "👤 創作者",
      text,
      false
    );

    bubble(
      "🧩 AI 正在理解你的想像……"
    );

    const direction =
      await requestPlusPlusDirection(
        text
      );

    const results =
      await executePlusPlusOperations(
        direction.operations
      );

    const reply =
      direction.reply ||
      "你的想法已經加入積木世界了！";

    chat(
      "🧩 AI 夥伴",
      reply,
      true
    );

    bubble(reply);

    await speak(reply);

    return {
      reply,
      operations:
        direction.operations,
      results
    };

  } finally {
    state.operationRunning = false;
  }
}

/* =====================================================
   67. 輸入框送出

   與語音辨識共用同一個 AI 指令入口。
===================================================== */

async function sendPlusPlusMessage() {
  const input =
    $("chatInput");

  if (!input) {
    throw new Error(
      "找不到聊天輸入框"
    );
  }

  const text =
    input.value.trim();

  if (!text) {
    return;
  }

  input.value = "";

  try {
    await performPlusPlusCommand(
      text
    );

  } catch (error) {
    input.value = text;
    throw error;
  }
}

/* =====================================================
   68. Plus-Plus Director 對外介面

   後續 ai-director.js 可以使用。
===================================================== */

window.MindspacePlusPlusDirector = {
  command:
    performPlusPlusCommand,

  executeOperations:
    executePlusPlusOperations,

  generateWorld:
    generateCreationWorld,

  generateAccessory:
    generatePlusPlusAccessory,

  activateSkill:
    activatePlusPlusSkill,

  get mode() {
    return state.creationMode;
  },

  get objects() {
    return state.plusPlusObjects;
  }
};

/* =====================================================
   第 5 段結束

   下一段：
   69. p5.js 世界與角色動畫
   70. Environment 核心定位
   71. AI 移動參數與動畫整合
   72. 所有按鈕初始化
   73. 系統啟動
===================================================== */

/* =====================================================
   69. Plus-Plus 動畫工具
===================================================== */

function plusPlusEase(t) {
  const x = clamp(t, 0, 1);

  return x * x * (3 - 2 * x);
}

function plusPlusLerp(a, b, t) {
  return a + (b - a) * t;
}

/* =====================================================
   70. AI 移動指令更新

   由 AI 指定目標位置。
   前端負責平滑插值。
===================================================== */

function updatePlusPlusMove(hero, now) {
  const move = hero.plusPlusMove;

  if (!move) {
    return false;
  }

  const duration = Math.max(
    1,
    move.duration || 3000
  );

  const progress = clamp(
    (now - move.started) / duration,
    0,
    1
  );

  const eased =
    plusPlusEase(progress);

  hero.x = plusPlusLerp(
    move.startX,
    move.endX,
    eased
  );

  hero.y = plusPlusLerp(
    move.startY,
    move.endY,
    eased
  );

  if (progress >= 1) {
    hero.plusPlusMove = null;
  }

  return true;
}

/* =====================================================
   71. 角色動作更新

   Character：
   保留自主移動與輕微浮動。

   Environment：
   原始積木固定在世界中央。

   AI 的 movement 描述會保存在角色資料，
   但不透過中文關鍵字對照固定動作。
===================================================== */

function animateHeroes(p, t) {
  const now =
    performance.now();

  for (const hero of state.heroes) {
    if (!hero.element) {
      continue;
    }

    const environment =
      hero.plusPlusMode ===
      "environment";

    let angle = 0;
    let bounce = 0;

    if (environment) {
      hero.x = 0.5;
      hero.y = 0.5;
      hero.vx = 0;
      hero.plusPlusMove = null;

    } else {
      const moving =
        updatePlusPlusMove(
          hero,
          now
        );

      if (!moving) {
        hero.x +=
          hero.vx || 0;

        hero.y +=
          Math.sin(
            t * 2 +
            (hero.phase || 0)
          ) * 0.00025;
      }

      if (hero.x > 0.93) {
        hero.x = 0.93;

        hero.vx =
          -Math.abs(
            hero.vx || 0.0002
          );

        hero.face = -1;
      }

      if (hero.x < 0.07) {
        hero.x = 0.07;

        hero.vx =
          Math.abs(
            hero.vx || 0.0002
          );

        hero.face = 1;
      }

      hero.y = clamp(
        hero.y,
        0.12,
        0.88
      );

      bounce =
        Math.sin(
          t * 2.4 +
          (hero.phase || 0)
        ) * 4;

      /*
        AI 可指定 movement 文字，
        但目前沒有通用文字轉動畫模型。

        保留自主移動作為預設，
        由後續 ai-director.js
        將 AI 指令轉成可執行的
        位置、速度、旋轉等數值。
      */

      const action =
        hero.action;

      if (
        action &&
        action.until > now
      ) {
        const type =
          action.type || "";

        switch (type) {
          case "stop":
            hero.vx = 0;
            break;

          case "dance":
            angle =
              Math.sin(t * 6) * 13;
            break;

          case "spin":
            angle =
              t * 120;
            break;

          case "jump":
            bounce -=
              Math.abs(
                Math.sin(t * 5)
              ) * 35;
            break;

          case "fly":
            bounce -=
              Math.abs(
                Math.sin(t * 2)
              ) * 24;
            break;

          case "shake":
            angle =
              Math.sin(t * 14) * 10;
            break;

          default:
            break;
        }
      }
    }

    const scale =
      clamp(
        Number(
          hero.plusPlusScale
        ) || 1,
        0.3,
        3
      );

    const face =
      hero.face || 1;

    hero.element.style.left =
      (hero.x * 100) + "%";

    hero.element.style.top =
      (hero.y * 100) + "%";

    hero.element.style.transform =
      "translate(-50%,-50%) " +
      "translateY(" +
      bounce +
      "px) " +
      "rotate(" +
      angle +
      "deg) " +
      "scale(" +
      (environment ? scale : face * scale) +
      "," +
      scale +
      ")";

    if (environment) {
      hero.element.style.width =
        "min(30vw,260px)";

      hero.element.style.height =
        "min(30vw,260px)";

    } else {
      hero.element.style.width =
        "145px";

      hero.element.style.height =
        "145px";
    }

    if (hero.nameElement) {
      hero.nameElement.style.display =
        environment
          ? "none"
          : "block";

      hero.nameElement.style.transform =
        "translateX(-50%) " +
        (
          face < 0 && !environment
            ? "scaleX(-1)"
            : "scaleX(1)"
        );
    }
  }
}

/* =====================================================
   72. p5.js 世界背景

   沒有生成 Plus-Plus 世界時，
   顯示簡單的預設背景。

   AI 背景圖片使用獨立 DOM 圖層，
   不會被 p5.js 畫布覆蓋。
===================================================== */

function drawEnvironment(p, t) {
  if (state.generatedWorld) {
    return;
  }

  const width = p.width;
  const height = p.height;

  p.push();

  p.noStroke();

  if (state.world === "forest") {
    p.fill(
      210,
      241,
      206
    );

    p.rect(
      0,
      0,
      width,
      height
    );

    p.fill(
      147,
      205,
      151,
      120
    );

    for (let i = 0; i < 9; i++) {
      const x =
        width * i / 8;

      const y =
        height * 0.73;

      p.ellipse(
        x,
        y,
        width * 0.27,
        height * 0.5
      );
    }

  } else if (
    state.world === "space"
  ) {
    p.fill(
      19,
      25,
      64
    );

    p.rect(
      0,
      0,
      width,
      height
    );

    for (let i = 0; i < 70; i++) {
      const x =
        (i * 97) % width;

      const y =
        (i * 53) % height;

      const glow =
        160 +
        Math.sin(
          t * 2 + i
        ) * 75;

      p.fill(
        255,
        255,
        255,
        glow
      );

      p.circle(
        x,
        y,
        2 + (i % 3)
      );
    }

  } else {
    p.fill(
      167,
      225,
      248
    );

    p.rect(
      0,
      0,
      width,
      height
    );

    p.fill(
      92,
      190,
      218,
      90
    );

    for (let i = 0; i < 5; i++) {
      const y =
        height *
        (0.3 + i * 0.15);

      p.ellipse(
        width / 2,
        y,
        width * 1.4,
        35 +
        Math.sin(
          t + i
        ) * 8
      );
    }
  }

  p.pop();
}

/* =====================================================
   73. 場景粒子

   保留一評 scenes 資料結構。
===================================================== */

function drawScenes(p, t) {
  const now =
    performance.now();

  for (
    let i = state.scenes.length - 1;
    i >= 0;
    i--
  ) {
    const scene =
      state.scenes[i];

    const duration =
      Math.max(
        1,
        scene.duration || 3000
      );

    const progress =
      (now - scene.start) /
      duration;

    if (progress >= 1) {
      state.scenes.splice(
        i,
        1
      );

      continue;
    }

    p.push();
    p.noStroke();

    for (
      let j = 0;
      j < 18;
      j++
    ) {
      const angle =
        j * Math.PI / 9 + t;

      const radius =
        30 + progress * 150;

      p.fill(
        255,
        220,
        160,
        160 * (1 - progress)
      );

      p.circle(
        p.width / 2 +
        Math.cos(angle) *
        radius,

        p.height / 2 +
        Math.sin(angle) *
        radius,

        6
      );
    }

    p.pop();
  }
}

/* =====================================================
   74. 啟動 p5.js

   只啟動一次，
   避免產生多張畫布。
===================================================== */

let plusPlusP5Instance = null;

function startP5World() {
  if (
    typeof p5 ===
    "undefined"
  ) {
    status(
      "❌ p5.js 尚未載入"
    );

    return;
  }

  if (plusPlusP5Instance) {
    return;
  }

  plusPlusP5Instance =
    new p5(p => {
      p.setup = () => {
        const world =
          $("world");

        const canvas =
          p.createCanvas(
            Math.max(
              1,
              world.clientWidth
            ),
            Math.max(
              1,
              world.clientHeight
            )
          );

        canvas.parent(
          "scene"
        );

        p.frameRate(60);
      };

      p.draw = () => {
        const t =
          performance.now() /
          1000;

        p.clear();

        drawEnvironment(
          p,
          t
        );

        animateHeroes(
          p,
          t
        );

        drawScenes(
          p,
          t
        );
      };

      p.windowResized = () => {
        const world =
          $("world");

        if (!world) {
          return;
        }

        p.resizeCanvas(
          Math.max(
            1,
            world.clientWidth
          ),
          Math.max(
            1,
            world.clientHeight
          )
        );
      };
    });
}

/* =====================================================
   75. 重新調整世界尺寸
===================================================== */

function resizeWorld() {
  setTimeout(() => {
    window.dispatchEvent(
      new Event("resize")
    );
  }, 280);
}

/* =====================================================
   76. 預設背景
===================================================== */

const defaultBackgrounds = {
  ocean:
    "linear-gradient(#66c5eb,#aee9f5 75%,#73c8cb)",

  forest:
    "linear-gradient(#c2e9fa,#d4edba 75%,#90c988)",

  space:
    "linear-gradient(#101733,#323c78)"
};

let customBackgroundUrl = null;

function applyWorldBackground() {
  const world =
    $("world");

  if (!world) {
    return;
  }

  if (customBackgroundUrl) {
    world.style.background =
      'url("' +
      customBackgroundUrl +
      '") center / cover no-repeat';

    return;
  }

  world.style.background =
    defaultBackgrounds[
      state.world
    ] ||
    defaultBackgrounds.ocean;
}

/* =====================================================
   77. 更換背景按鈕
===================================================== */

function setupBackgroundButtons() {
  const input =
    $("teacherBg");

  if (
    input &&
    input.dataset
      .mindspaceBound !==
      "true"
  ) {
    input.dataset
      .mindspaceBound =
      "true";

    input.addEventListener(
      "change",
      async () => {
        const file =
          input.files?.[0];

        if (!file) {
          return;
        }

        try {
          const data =
            await fileData(
              file
            );

          await imageLoad(
            data
          );

          customBackgroundUrl =
            data;

          applyWorldBackground();

          status(
            "🖼️ 自訂背景已更新"
          );

        } catch (error) {
          status(
            "❌ 背景載入失敗：" +
            error.message
          );
        }
      }
    );
  }

  click(
    "clearTeacherBg",
    () => {
      customBackgroundUrl =
        null;

      if ($("teacherBg")) {
        $("teacherBg").value =
          "";
      }

      applyWorldBackground();

      status(
        "↩️ 已恢復預設背景"
      );
    }
  );
}

/* =====================================================
   78. 側欄收合
===================================================== */

function togglePlusPlusSidebar() {
  const sidebar =
    $("sidebar");

  const button =
    $("mobileToggle");

  if (!sidebar) {
    return;
  }

  const collapsed =
    sidebar.classList.toggle(
      "collapsed"
    );

  if (button) {
    button.textContent =
      collapsed
        ? "☰ 開啟操作面板"
        : "☰ 收合操作面板";

    button.setAttribute(
      "aria-expanded",
      String(!collapsed)
    );
  }

  resizeWorld();
}

/* =====================================================
   79. 全螢幕
===================================================== */

async function togglePlusPlusFullscreen() {
  if (
    document.fullscreenElement
  ) {
    await document.exitFullscreen();

  } else {
    await document.documentElement
      .requestFullscreen();
  }

  resizeWorld();
}

/* =====================================================
   80. 新創作

   清除目前作品與 AI 生成圖層。
===================================================== */

function resetPlusPlusCreation() {
  const confirmed =
    confirm(
      "確定開始新創作嗎？目前畫面中的作品會被清除。"
    );

  if (!confirmed) {
    return;
  }

  stopSpeech();
  closeCamera();

  for (const hero of state.heroes) {
    hero.element?.remove();
  }

  state.heroes = [];
  state.selectedId = null;

  state.history = [];
  state.scenes = [];

  state.plusPlusAccessories.clear();

  state.plusPlusObjects = [];
  state.plusPlusGeneratedHeroes = [];

  state.environmentCenterpieceId =
    null;

  state.creationAnalysis = null;
  state.creationDescription = "";

  state.generatedWorld = null;
  state.generatedWorldName = "";
  state.generatedWorldMode = "";

  state.creationHistory = [];

  state.operationQueue = [];
  state.operationRunning = false;

  plusPlusEnvironmentElement()
    ?.replaceChildren();

  plusPlusEffectElement()
    ?.replaceChildren();

  const background =
    plusPlusBackgroundElement();

  if (background) {
    background.removeAttribute(
      "src"
    );

    background.classList.add(
      "hidden"
    );
  }

  const description =
    $("creationDescription");

  if (description) {
    description.value = "";
  }

  const chatLog =
    $("chatLog");

  if (chatLog) {
    chatLog.replaceChildren();
  }

  const title =
    $("worldTitle");

  if (title) {
    title.textContent =
      "🧩 Mindspace｜Plus-Plus 想像世界";
  }

  refreshHeroes();

  applyWorldBackground();

  bubble(
    "🌈 一起開始新的 Plus-Plus 積木創作！"
  );

  status(
    "🌱 已開始新創作"
  );
}

/* =====================================================
   81. 去背編輯器按鈕
===================================================== */

function setupPlusPlusEditorButtons() {
  click(
    "removeBgAI",
    aiRemoveBg
  );

  click(
    "removeBg",
    quickRemoveBg
  );

  click(
    "eraseMode",
    () => {
      state.editorMode =
        "erase";

      status(
        "🧽 已切換擦除筆刷"
      );
    }
  );

  click(
    "restoreMode",
    () => {
      state.editorMode =
        "restore";

      status(
        "🖌️ 已切換還原筆刷"
      );
    }
  );

  click(
    "undoEdit",
    undoEditor
  );

  click(
    "resetEdit",
    resetEditor
  );

  click(
    "saveEditor",
    saveHero
  );

  click(
    "closeEditor",
    () => {
      modal(
        "editorModal",
        false
      );

      state.editorPainting =
        false;
    }
  );

  setupEditorPainting();
}

/* =====================================================
   82. 主要按鈕初始化

   不重複綁定：
   sendButton
   micButton
   skillButton

   這三個按鈕交由新版
   ai-director.js 統一管理。
===================================================== */

function setupButtons() {
  /* ===== 創作模式 ===== */

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

  click(
    "generateCreationWorld",
    generateCreationWorld
  );

  /* ===== 攝影機 ===== */

  click(
    "openCamera",
    openCamera
  );

  click(
    "captureButton",
    capturePhoto
  );

  click(
    "switchCamera",
    switchCameraFacing
  );

  click(
    "retryCamera",
    openCamera
  );

  click(
    "closeCamera",
    closeCamera
  );

  /* ===== 照片上傳 ===== */

  click(
    "uploadPhoto",
    () => {
      const input =
        $("photoFile");

      if (!input) {
        throw new Error(
          "找不到照片上傳欄位"
        );
      }

      input.click();
    }
  );

  setupPhotoInputs();

  /* ===== 編輯作品 ===== */

  click(
    "editHero",
    async () => {
      const hero =
        heroNow();

      if (!hero) {
        throw new Error(
          "請先選擇積木作品"
        );
      }

      state.editorHeroId =
        hero.id;

      await openEditor(
        hero.plusPlusOriginal ||
        hero.original
      );
    }
  );

  click(
    "deleteHero",
    removeHero
  );

  click(
    "inspectHero",
    inspectHero
  );

  setupPlusPlusEditorButtons();

  /* ===== AI 延伸造型 ===== */

  click(
    "transformButton",
    async () => {
      const hero =
        heroNow();

      if (!hero) {
        throw new Error(
          "請先選擇積木角色"
        );
      }

      await transformHero(
        hero,
        $("transformInput")?.value ||
        ""
      );
    }
  );

  click(
    "restoreButton",
    restorePlusPlusOriginal
  );

  click(
    "showTransform",
    showPlusPlusTransform
  );

  /* ===== 語音開關 ===== */

  click(
    "voiceButton",
    () => {
      setVoiceEnabled(
        !state.voiceEnabled
      );
    }
  );

  click(
    "stopVoice",
    stopSpeech
  );

  /* ===== 選取角色 ===== */

  const selected =
    $("selectedHero");

  if (
    selected &&
    selected.dataset
      .mindspaceBound !==
      "true"
  ) {
    selected.dataset
      .mindspaceBound =
      "true";

    selected.addEventListener(
      "change",
      () => {
        state.selectedId =
          selected.value;

        refreshHeroes();
      }
    );
  }

  /* ===== 世界選擇 ===== */

  const worldSelect =
    $("worldSelect");

  if (
    worldSelect &&
    worldSelect.dataset
      .mindspaceBound !==
      "true"
  ) {
    worldSelect.dataset
      .mindspaceBound =
      "true";

    worldSelect.addEventListener(
      "change",
      () => {
        state.world =
          worldSelect.value;

        applyWorldBackground();
      }
    );
  }

  setupBackgroundButtons();

  /* ===== 連線測試 ===== */

  click(
    "testBridge",
    testAIConnection
  );

  /* ===== 重設 ===== */

  click(
    "resetButton",
    resetPlusPlusCreation
  );

  /* ===== 側欄 ===== */

  click(
    "mobileToggle",
    togglePlusPlusSidebar
  );

  /* ===== 全螢幕 ===== */

  click(
    "fullscreenButton",
    togglePlusPlusFullscreen
  );
}

/* =====================================================
   83. 初始化

   保留一評 initializeMindspace 名稱。
===================================================== */

let mindspaceInitialized = false;

function initializeMindspace() {
  if (mindspaceInitialized) {
    return;
  }

  mindspaceInitialized = true;

  setupButtons();

  refreshHeroes();

  applyWorldBackground();

  startP5World();

  initializeBridge();

  setCreationMode(
    "character"
  );

  status(
    "🧩 Mindspace Plus-Plus 已啟動，正在連線 AI……"
  );
}

/* =====================================================
   84. DOM 準備完成後啟動
===================================================== */

if (
  document.readyState ===
  "loading"
) {
  document.addEventListener(
    "DOMContentLoaded",
    initializeMindspace,
    {
      once: true
    }
  );

} else {
  initializeMindspace();
}

/* =====================================================
   SKETCH.JS END
===================================================== */
