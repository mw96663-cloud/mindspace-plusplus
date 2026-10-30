
/**
 * Plus-Plus 想像有形
 * Frontend v2
 *
 * 三階段：
 * 1. 拍照回饋 + AI 去背 + 作品進場
 * 2. AI 辨識 + 世界生成
 * 3. 角色活動 + 主動語音邀請
 */

// ★ 請貼上新的 GAS 網頁應用程式 /exec 網址
const GAS_URL = "PASTE_YOUR_NEW_GAS_EXEC_URL_HERE";

const APP_ID = "plusplus-world-v2";

const $ = id => document.getElementById(id);

const S = {
  started: false,
  canvas: null,

  bridgeReady: false,
  bridgeToken: "",
  pending: new Map(),
  requestNumber: 0,

  busy: false,
  busyLabel: "",
  status: "等待啟動",
  stage: "idle",

  cameraStream: null,
  soundEnabled: true,
  recognition: null,
  listening: false,

  worldImage: null,
  worldImageData: null,
  worldName: "我的想像世界",
  worldPrompt: "",

  heroes: [],
  selectedId: null,

  creationImage: null,
  creationCutout: null,
  creationInfo: null,

  sceneOriginal: null,
  sceneOriginalData: null,
  sceneReveal: null,

  arrival: null,
  particles: [],
  ambient: [],

  lastSpeech: "",
  lastError: "",
  effectUntil: 0,
  effectName: "",

  cameraOpen: false,
  cameraFacing: "environment",

  audioContext: null
};

function uid() {
  return "pp-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 9);
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setStatus(message) {
  S.status = message;

  const el = $("statusBox");

  if (el) {
    el.textContent =
      "階段：" + stageLabel(S.stage) + "\n" +
      "狀態：" + message + "\n" +
      "AI Bridge：" +
      (S.bridgeReady ? "已連線" : "尚未連線") +
      "\n角色數量：" + S.heroes.length +
      "\n世界：" + S.worldName +
      (S.lastError
        ? "\n最近錯誤：" + S.lastError
        : "");
  }

  console.log("[PlusPlus]", message);
}

function stageLabel(stage) {
  return ({
    idle: "等待創作",
    received: "拍照完成",
    cutout: "AI 去背",
    arrival: "作品進場",
    analyze: "AI 辨識",
    create: "AI 創造",
    active: "主動互動",
    error: "需要檢查"
  })[stage] || stage;
}

function showNotice(message, loading = false) {
  $("noticeText").textContent = message;
  $("noticeProgress").hidden = !loading;
  $("notice").hidden = false;
}

function hideNotice() {
  $("notice").hidden = true;
}

function setBusy(value, message = "") {
  S.busy = value;
  S.busyLabel = message;

  $("photoBtn").disabled = value;
  $("voiceBtn").disabled = value;

  if (value && message) {
    showNotice(message, true);
  }

  if (!value) {
    $("noticeProgress").hidden = true;
  }
}

function reportError(label, error) {
  const message = error && error.message
    ? error.message
    : String(error);

  S.lastError = label + "：" + message;
  S.stage = "error";

  console.error("[PlusPlus]", label, error);

  setStatus(label + "失敗：" + message);

  showNotice(
    "⚠️ " + label + "失敗。請打開工作台查看錯誤。",
    false
  );
}

function makeToken() {
  if (
    window.crypto &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(v => v.toString(16).padStart(2, "0"))
    .join("");
}

/* ==================================================
   GAS BRIDGE
================================================== */

function initBridge() {
  if (!GAS_URL.includes("/exec")) {
    setStatus(
      "請先在 sketch.js 填入 GAS_URL 的 /exec 網址"
    );
    return;
  }

  S.bridgeToken = makeToken();

  const url = new URL(GAS_URL);

  url.searchParams.set("bridge", "1");
  url.searchParams.set(
    "parentOrigin",
    location.origin
  );
  url.searchParams.set(
    "token",
    S.bridgeToken
  );

  window.addEventListener(
    "message",
    handleBridgeMessage
  );

  $("bridgeFrame").src = url.toString();

  setStatus("正在建立 AI Bridge 連線……");
}

function handleBridgeMessage(event) {
  const msg = event.data;

  if (!msg || typeof msg !== "object") return;
  if (msg.app !== APP_ID) return;
  if (msg.token !== S.bridgeToken) return;

  // GAS HtmlService 的訊息來源可能是
  // script.googleusercontent.com 沙箱網域。
  // 這裡同時驗證應用程式識別碼與隨機 token。
  const origin = String(event.origin || "");

  const trusted =
    origin === "https://script.google.com" ||
    /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com$/i
      .test(origin);

  if (!trusted) {
    console.warn(
      "[PlusPlus] 忽略未知 Bridge 來源",
      origin
    );
    return;
  }

  if (msg.type === "ready") {
    S.bridgeReady = true;
    setStatus("AI Bridge 已連線");

    for (const entry of S.pending.values()) {
      if (entry.waitingToSend) {
        entry.waitingToSend = false;
        postBridgeRequest(entry.message);
      }
    }

    return;
  }

  if (msg.type !== "response") return;

  const entry = S.pending.get(msg.id);

  if (!entry) return;

  clearTimeout(entry.timer);
  S.pending.delete(msg.id);

  if (msg.ok) {
    entry.resolve(msg.result);
  } else {
    entry.reject(
      new Error(msg.error || "AI 請求失敗")
    );
  }
}

function postBridgeRequest(message) {
  const frame = $("bridgeFrame");

  if (!frame || !frame.contentWindow) {
    throw new Error("找不到 AI Bridge iframe");
  }

  // GAS iframe 的實際沙箱網域可能與 /exec 不同，
  // 使用 token 驗證雙向訊息。
  frame.contentWindow.postMessage(
    message,
    "*"
  );
}

function callAI(route, payload = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    if (!GAS_URL.includes("/exec")) {
      reject(
        new Error("GAS_URL 尚未設定")
      );
      return;
    }

    const id = "req-" + (++S.requestNumber);

    const message = {
      app: APP_ID,
      token: S.bridgeToken,
      type: "request",
      id: id,
      route: route,
      payload: payload
    };

    const timer = setTimeout(() => {
      S.pending.delete(id);

      reject(
        new Error(
          route +
          " 等待超過 " +
          Math.round(timeout / 1000) +
          " 秒。請檢查 GAS 執行記錄。"
        )
      );
    }, timeout);

    const entry = {
      resolve,
      reject,
      timer,
      message,
      waitingToSend: !S.bridgeReady
    };

    S.pending.set(id, entry);

    if (S.bridgeReady) {
      try {
        postBridgeRequest(message);
      } catch (error) {
        clearTimeout(timer);
        S.pending.delete(id);
        reject(error);
      }
    }
  });
}

/* ==================================================
   p5.js 世界
================================================== */

function setup() {
  const canvas = createCanvas(
    windowWidth,
    windowHeight
  );

  canvas.parent("worldHost");

  S.canvas = canvas;

  pixelDensity(1);
  imageMode(CENTER);
  rectMode(CENTER);
  textAlign(CENTER, CENTER);

  initAmbient();
}

function windowResized() {
  resizeCanvas(
    windowWidth,
    windowHeight
  );

  initAmbient();
}

function initAmbient() {
  S.ambient = [];

  for (let i = 0; i < 45; i++) {
    S.ambient.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 2 + Math.random() * 6,
      phase: Math.random() * Math.PI * 2,
      speed: .2 + Math.random() * .5
    });
  }
}

function draw() {
  const t = millis();

  drawWorldBackground(t);
  drawAmbient(t);
  drawSceneOriginal(t);
  drawHeroes(t);
  drawArrival(t);
  drawParticles(t);
  drawCreationOverlay(t);
}

function drawWorldBackground(t) {
  if (S.worldImage) {
    drawCoverImage(
      S.worldImage,
      width / 2,
      height / 2,
      width,
      height
    );

    noStroke();
    fill(255, 255, 255, 14);
    rect(
      width / 2,
      height / 2,
      width,
      height
    );

    return;
  }

  const ctx = drawingContext;

  const gradient = ctx.createLinearGradient(
    0, 0, 0, height
  );

  gradient.addColorStop(0, "#d8eff6");
  gradient.addColorStop(.55, "#e8f5ee");
  gradient.addColorStop(1, "#fff0d9");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  noStroke();

  for (let i = 0; i < 9; i++) {
    const x = width * (i / 8);
    const y =
      height * .8 +
      Math.sin(t * .0003 + i) * 8;

    fill(188, 222, 207, 65);

    ellipse(
      x,
      y,
      180,
      95
    );
  }
}

function drawCoverImage(
  img, cx, cy, targetW, targetH
) {
  if (!img || !img.width || !img.height) return;

  const scale = Math.max(
    targetW / img.width,
    targetH / img.height
  );

  image(
    img,
    cx,
    cy,
    img.width * scale,
    img.height * scale
  );
}

function drawContainImage(
  img, cx, cy, maxW, maxH
) {
  if (!img || !img.width || !img.height) return;

  const scale = Math.min(
    maxW / img.width,
    maxH / img.height
  );

  image(
    img,
    cx,
    cy,
    img.width * scale,
    img.height * scale
  );
}

function drawAmbient(t) {
  noStroke();

  for (const dot of S.ambient) {
    const alpha =
      35 +
      Math.sin(t * .001 + dot.phase) * 20;

    fill(255, 255, 255, alpha);

    circle(
      dot.x +
        Math.sin(t * .0005 + dot.phase) * 15,
      dot.y -
        (t * .005 * dot.speed) % height,
      dot.size
    );
  }
}

function drawSceneOriginal(t) {
  if (!S.sceneOriginal) return;

  // 原始去背積木作品始終保留為前景，
  // 不讓 AI 延伸圖取代實體作品。
  const x = width * .5;
  const y =
    height * .68 +
    Math.sin(t * .0011) * 2;

  const size = Math.min(
    width * .46,
    height * .53,
    490
  );

  drawingContext.save();
  drawingContext.shadowColor =
    "rgba(50,70,90,.25)";
  drawingContext.shadowBlur = 25;

  drawContainImage(
    S.sceneOriginal,
    x,
    y,
    size,
    size
  );

  drawingContext.restore();
}

function drawHeroes(t) {
  for (const hero of S.heroes) {
    if (!hero.image) continue;

    if (hero.entering) {
      continue;
    }

    updateHeroMovement(hero, t);

    const x = hero.x * width;
    const y = hero.y * height;

    const base = Math.min(
      hero.size * (width / 1100),
      height * .38
    );

    const size = Math.max(
      95,
      base * (hero.scale || 1)
    );

    const bounce =
      Math.sin(t * .002 + hero.phase) * 3;

    push();

    translate(x, y + bounce);

    if (hero.direction < 0) {
      scale(-1, 1);
    }

    drawingContext.shadowColor =
      "rgba(35,54,76,.2)";
    drawingContext.shadowBlur = 15;

    drawContainImage(
      hero.image,
      0,
      0,
      size,
      size
    );

    pop();

    if (
      hero.speech &&
      t < hero.speechUntil
    ) {
      drawSpeechBubble(
        hero.speech,
        x,
        y - size * .55
      );
    }
  }
}

function updateHeroMovement(hero, t) {
  const dt = Math.min(
    deltaTime || 16,
    40
  );

  const speed =
    (hero.speed || .00005) *
    dt *
    (hero.speedMultiplier || 1);

  const movement = hero.movement || "float";

  if (
    movement === "walk" ||
    movement === "swim" ||
    movement === "fly" ||
    movement === "glide"
  ) {
    hero.x += speed * hero.direction;

    if (hero.x > .88) {
      hero.x = .88;
      hero.direction = -1;
    }

    if (hero.x < .12) {
      hero.x = .12;
      hero.direction = 1;
    }
  }

  if (movement === "fly") {
    hero.y =
      hero.baseY +
      Math.sin(t * .0013 + hero.phase) * .065;
  } else if (movement === "swim") {
    hero.y =
      hero.baseY +
      Math.sin(t * .001 + hero.phase) * .03;
  } else if (movement === "bounce") {
    hero.y =
      hero.baseY -
      Math.abs(
        Math.sin(t * .0022 + hero.phase)
      ) * .07;
  } else if (movement === "float") {
    hero.y =
      hero.baseY +
      Math.sin(t * .0012 + hero.phase) * .025;
  } else {
    hero.y = hero.baseY;
  }
}

function drawSpeechBubble(message, x, y) {
  const textValue =
    String(message).slice(0, 40);

  push();

  textSize(15);

  const w = Math.min(
    340,
    Math.max(125, textWidth(textValue) + 32)
  );

  const bubbleY = Math.max(105, y - 22);

  rectMode(CENTER);
  noStroke();

  fill(255, 255, 255, 230);

  rect(
    clamp(x, w / 2 + 12, width - w / 2 - 12),
    bubbleY,
    w,
    47,
    16
  );

  fill(60, 76, 91);

  text(
    textValue,
    clamp(x, w / 2 + 12, width - w / 2 - 12),
    bubbleY
  );

  pop();
}

function drawArrival(t) {
  const a = S.arrival;

  if (!a || !a.image) return;

  const progress = clamp(
    (t - a.start) / a.duration,
    0,
    1
  );

  const ease =
    1 - Math.pow(1 - progress, 3);

  const size =
    a.targetSize *
    (.12 + ease * .88);

  const x =
    width / 2 +
    Math.sin(progress * Math.PI) * 10;

  const y =
    height * (.34 + ease * .3);

  push();

  imageMode(CENTER);

  tint(
    255,
    Math.min(255, progress * 700)
  );

  drawContainImage(
    a.image,
    x,
    y,
    size,
    size
  );

  noTint();

  noFill();
  stroke(255, 255, 255, 160 * (1 - progress));
  strokeWeight(3);

  circle(
    x,
    y,
    size * (1.3 + progress)
  );

  pop();

  if (progress >= 1) {
    const completed = S.arrival;
    S.arrival = null;

    if (completed.onDone) {
      completed.onDone();
    }
  }
}

function drawCreationOverlay(t) {
  if (!S.busy) return;

  const x = width / 2;
  const y = height * .3;

  push();

  noStroke();

  for (let i = 0; i < 8; i++) {
    const angle =
      t * .0013 +
      i * TWO_PI / 8;

    const radius =
      42 +
      Math.sin(t * .002 + i) * 5;

    const alpha =
      70 +
      90 * (
        .5 + .5 * Math.sin(t * .003 + i)
      );

    fill(255, 255, 255, alpha);

    circle(
      x + Math.cos(angle) * radius,
      y + Math.sin(angle) * radius,
      7
    );
  }

  pop();
}

function drawParticles(t) {
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];

    p.x += p.vx;
    p.y += p.vy;
    p.life -= deltaTime || 16;

    if (p.life <= 0) {
      S.particles.splice(i, 1);
      continue;
    }

    const alpha = clamp(
      p.life / p.maxLife,
      0,
      1
    );

    push();

    noStroke();

    const c = color(p.color);
    c.setAlpha(alpha * 230);

    fill(c);

    if (p.shape === "plus") {
      rect(p.x, p.y, p.size * .38, p.size);
      rect(p.x, p.y, p.size, p.size * .38);
    } else {
      circle(p.x, p.y, p.size);
    }

    pop();
  }
}

function emitParticles(
  x,
  y,
  count = 24,
  effect = "sparkle"
) {
  const colors = [
    "#ffffff",
    "#ffe0a4",
    "#b6e9d4",
    "#d6c9ff",
    "#ffc7c1"
  ];

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * TWO_PI;
    const power = 1 + Math.random() * 3;

    S.particles.push({
      x,
      y,
      vx: Math.cos(angle) * power,
      vy: Math.sin(angle) * power -
        (effect === "snow" ? .4 : 1),
      size: 4 + Math.random() * 9,
      life: 700 + Math.random() * 1800,
      maxLife: 2500,
      color: colors[
        Math.floor(Math.random() * colors.length)
      ],
      shape:
        Math.random() > .6
          ? "plus"
          : "circle"
    });
  }

  if (S.particles.length > 350) {
    S.particles.splice(
      0,
      S.particles.length - 350
    );
  }
}

/* ==================================================
   圖片處理
================================================== */

function loadImageAsync(dataUrl) {
  return new Promise((resolve, reject) => {
    if (
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/")
    ) {
      reject(
        new Error("沒有收到有效圖片資料")
      );
      return;
    }

    loadImage(
      dataUrl,
      img => resolve(img),
      error => reject(
        new Error(
          "p5 圖片載入失敗：" + String(error)
        )
      )
    );
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(
      reader.result
    );

    reader.onerror = () => reject(
      new Error("照片讀取失敗")
    );

    reader.readAsDataURL(file);
  });
}

function resizePhoto(dataUrl, maxSide = 1200) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const ratio = Math.min(
        1,
        maxSide / Math.max(
          img.width,
          img.height
        )
      );

      const canvas =
        document.createElement("canvas");

      canvas.width = Math.max(
        1,
        Math.round(img.width * ratio)
      );

      canvas.height = Math.max(
        1,
        Math.round(img.height * ratio)
      );

      const ctx = canvas.getContext("2d");

      ctx.drawImage(
        img,
        0,
        0,
        canvas.width,
        canvas.height
      );

      resolve(
        canvas.toDataURL("image/jpeg", .86)
      );
    };

    img.onerror = () => reject(
      new Error("照片縮放失敗")
    );

    img.src = dataUrl;
  });
}

/* ==================================================
   相機
================================================== */

async function openCamera() {
  $("cameraModal").classList.add("open");
  S.cameraOpen = true;

  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    setStatus(
      "此瀏覽器無法使用相機，可改用選擇照片"
    );
    return;
  }

  try {
    S.cameraStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {
            ideal: S.cameraFacing
          },
          width: { ideal: 1280 },
          height: { ideal: 960 }
        },
        audio: false
      });

    $("cameraVideo").srcObject =
      S.cameraStream;

    await $("cameraVideo").play();

  } catch (error) {
    setStatus(
      "無法啟動相機：" + error.message +
      "，可以使用選擇照片。"
    );
  }
}

function closeCamera() {
  $("cameraModal").classList.remove("open");
  S.cameraOpen = false;

  if (S.cameraStream) {
    S.cameraStream
      .getTracks()
      .forEach(track => track.stop());

    S.cameraStream = null;
  }

  $("cameraVideo").srcObject = null;
}

async function capturePhoto() {
  const video = $("cameraVideo");

  if (
    !video.videoWidth ||
    !video.videoHeight
  ) {
    showNotice(
      "相機尚未準備好，請稍候或選擇照片。"
    );
    return;
  }

  const canvas =
    document.createElement("canvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");

  // 使用原始相機影像，不鏡像翻轉作品
  ctx.drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  const dataUrl =
    canvas.toDataURL("image/jpeg", .88);

  closeCamera();

  await processCreation(dataUrl);
}

/* ==================================================
   音效與語音
================================================== */

function playConfirmSound() {
  try {
    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) return;

    if (!S.audioContext) {
      S.audioContext =
        new AudioContextClass();
    }

    const ctx = S.audioContext;

    if (ctx.state === "suspended") {
      ctx.resume();
    }

    const now = ctx.currentTime;

    [523.25, 659.25, 783.99].forEach(
      (frequency, index) => {
        const oscillator =
          ctx.createOscillator();

        const gain = ctx.createGain();

        oscillator.type = "sine";
        oscillator.frequency.value = frequency;

        gain.gain.setValueAtTime(
          .0001,
          now + index * .11
        );

        gain.gain.exponentialRampToValueAtTime(
          .09,
          now + index * .11 + .02
        );

        gain.gain.exponentialRampToValueAtTime(
          .0001,
          now + index * .11 + .27
        );

        oscillator.connect(gain);
        gain.connect(ctx.destination);

        oscillator.start(
          now + index * .11
        );

        oscillator.stop(
          now + index * .11 + .3
        );
      }
    );
  } catch (error) {
    console.warn(
      "音效無法播放",
      error
    );
  }
}

function speak(message, hero = null) {
  const textValue = String(message || "").trim();

  if (!textValue) return;

  S.lastSpeech = textValue;

  if (hero) {
    hero.speech = textValue;
    hero.speechUntil =
      millis() + Math.max(
        3500,
        textValue.length * 180
      );
  }

  if (
    !S.soundEnabled ||
    !("speechSynthesis" in window)
  ) {
    return;
  }

  speechSynthesis.cancel();

  const utterance =
    new SpeechSynthesisUtterance(textValue);

  utterance.lang = "zh-TW";
  utterance.rate = .9;
  utterance.pitch = 1.03;
  utterance.volume = 1;

  const voices =
    speechSynthesis.getVoices();

  const chineseVoice = voices.find(
    v => v.lang === "zh-TW"
  ) || voices.find(
    v => v.lang.startsWith("zh")
  );

  if (chineseVoice) {
    utterance.voice = chineseVoice;
  }

  speechSynthesis.speak(utterance);
}

function setupSpeechRecognition() {
  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) {
    setStatus(
      "瀏覽器不支援語音辨識，建議使用 Chrome 或 Edge。"
    );
    return;
  }

  const recognition = new Recognition();

  recognition.lang = "zh-TW";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    S.listening = true;

    $("voiceBtn").classList.add(
      "listening"
    );

    showNotice(
      "🎤 我正在聽，請說出你的想法……",
      false
    );
  };

  recognition.onend = () => {
    S.listening = false;

    $("voiceBtn").classList.remove(
      "listening"
    );
  };

  recognition.onerror = event => {
    setStatus(
      "語音辨識：" + event.error
    );
  };

  recognition.onresult = async event => {
    const transcript =
      event.results[0][0].transcript;

    showNotice(
      "你說：「" + transcript + "」",
      false
    );

    await handleVoiceCommand(
      transcript
    );
  };

  S.recognition = recognition;
}

function toggleListening() {
  if (!S.recognition) {
    showNotice(
      "目前瀏覽器不支援語音辨識。"
    );
    return;
  }

  if (S.listening) {
    S.recognition.stop();
    return;
  }

  if (
    "speechSynthesis" in window
  ) {
    speechSynthesis.cancel();
  }

  try {
    S.recognition.start();
  } catch (error) {
    setStatus(
      "無法啟動麥克風：" + error.message
    );
  }
}

/* ==================================================
   作品進場動畫
================================================== */

function animateArrival(img, kind) {
  return new Promise(resolve => {
    const targetSize = Math.min(
      width * .45,
      height * .48,
      kind === "environment" ? 440 : 320
    );

    S.arrival = {
      image: img,
      start: millis(),
      duration: 1700,
      targetSize,
      onDone: () => {
        emitParticles(
          width / 2,
          height * .64,
          45,
          "sparkle"
        );

        resolve();
      }
    };
  });
}

/* ==================================================
   拍照後完整三階段流程
================================================== */

async function processCreation(sourceDataUrl) {
  if (S.busy) return;

  S.lastError = "";
  S.creationInfo = null;
  S.creationCutout = null;

  try {
    const photo = await resizePhoto(
      sourceDataUrl,
      1200
    );

    S.creationImage = photo;

    // 第一階段：立即回饋
    S.stage = "received";

    playConfirmSound();

    showNotice(
      "📷 拍照成功！你的積木作品已經收到。",
      true
    );

    setStatus(
      "拍照成功，準備移除背景"
    );

    emitParticles(
      width / 2,
      height * .48,
      35
    );

    await wait(450);

    // 去背在作品進場前完成
    S.stage = "cutout";

    setBusy(
      true,
      "✨ 正在保留積木造型並去除背景……"
    );

    setStatus(
      "正在呼叫 AI 去背"
    );

    const cutoutResult = await callAI(
      "removeBackgroundAI",
      { image: photo },
      180000
    );

    if (
      !cutoutResult ||
      !cutoutResult.image
    ) {
      throw new Error(
        "去背 API 沒有回傳圖片"
      );
    }

    const cutoutImage =
      await loadImageAsync(
        cutoutResult.image
      );

    S.creationCutout =
      cutoutResult.image;

    // AI 去背成功，讓透明作品進場
    S.stage = "arrival";

    setBusy(
      true,
      "🌈 你的積木正在走進想像世界……"
    );

    setStatus(
      "AI 去背成功，播放進場動畫"
    );

    playConfirmSound();

    await animateArrival(
      cutoutImage,
      "character"
    );

    // 第二階段：辨識與創造
    S.stage = "analyze";

    setBusy(
      true,
      "🧠 AI 正在認識你的積木作品……"
    );

    const info = await callAI(
      "analyzeCreation",
      {
        image: photo
      },
      120000
    );

    S.creationInfo = info;

    console.log(
      "[PlusPlus] AI 辨識結果",
      info
    );

    setStatus(
      "辨識成功：" +
      info.name +
      "，類型：" +
      info.kind
    );

    S.stage = "create";

    if (info.kind === "environment") {
      await createEnvironment(
        cutoutResult.image,
        photo,
        info
      );
    } else {
      await createCharacter(
        cutoutResult.image,
        info
      );
    }

    // 第三階段：主動互動
    S.stage = "active";

    setBusy(false);

    showNotice(
      "✨ " + info.name +
      " 已經來到你的想像世界！",
      false
    );

    setStatus(
      "作品已加入，現在可以繼續拍照或說話"
    );

    setTimeout(() => {
      if (!S.busy) hideNotice();
    }, 5500);

  } catch (error) {
    setBusy(false);
    reportError("作品建立", error);
  }
}

/* ==================================================
   Character｜角色
================================================== */

async function createCharacter(
  cutoutDataUrl,
  info
) {
  const img =
    await loadImageAsync(
      cutoutDataUrl
    );

  const hero = {
    id: uid(),
    name: info.name || "我的角色",
    description: info.description || "",
    image: img,
    imageData: cutoutDataUrl,

    x: .5,
    y: .67,
    baseY: .67,

    size: 280,
    scale: 1,
    direction: 1,
    speed: .000075,
    speedMultiplier: 1,

    movement: info.movement || "float",
    phase: Math.random() * TWO_PI,

    entering: true,
    speech: "",
    speechUntil: 0,

    created: performance.now()
  };

  // 先確實加入 p5 角色陣列
  S.heroes.push(hero);
  S.selectedId = hero.id;

  updateCharacterList();

  hero.entering = false;

  setStatus(
    "角色已加入畫面：" + hero.name
  );

  // 已有世界時保留世界，
  // 不覆蓋長者之前的創作。
  if (!S.worldImage) {
    setBusy(
      true,
      "🏞️ 正在為「" +
      hero.name +
      "」創造適合的積木世界……"
    );

    try {
      const result = await callAI(
        "generateWorld",
        { info },
        180000
      );

      await setWorldImage(
        result.image,
        info.worldName
      );

      S.worldPrompt =
        info.worldPrompt || "";

    } catch (error) {
      // 角色仍保留在畫面
      console.error(
        "角色背景生成失敗",
        error
      );

      S.lastError =
        "角色背景生成失敗：" +
        error.message;

      setStatus(
        "角色已加入，但背景生成失敗"
      );
    }
  }

  startSceneEffect(
    info.effect || "sparkle"
  );

  speak(
    info.greeting ||
    "你好！你想讓我做什麼呢？",
    hero
  );
}

/* ==================================================
   Environment｜背景
================================================== */

async function createEnvironment(
  cutoutDataUrl,
  originalPhoto,
  info
) {
  // 原始作品必須保留為透明圖層
  const originalCutout =
    await loadImageAsync(
      cutoutDataUrl
    );

  S.sceneOriginal = originalCutout;
  S.sceneOriginalData = cutoutDataUrl;

  setStatus(
    "原始積木背景已加入前景圖層"
  );

  setBusy(
    true,
    "🏰 正在以原始作品為核心，延伸 Plus-Plus 世界……"
  );

  try {
    const result = await callAI(
      "generateScene",
      {
        image: originalPhoto,
        info
      },
      180000
    );

    await setWorldImage(
      result.image,
      info.worldName || info.name
    );

    S.worldPrompt =
      info.worldPrompt || "";

    setStatus(
      "AI 場景延伸完成，原始作品仍保留"
    );

  } catch (error) {
    // 即使生成失敗，透明原始作品
    // 也會留在世界中央。
    console.error(
      "場景延伸失敗",
      error
    );

    S.lastError =
      "場景延伸失敗：" +
      error.message;

    setStatus(
      "原始作品已加入，但場景延伸失敗"
    );
  }

  startSceneEffect(
    info.effect || "sparkle"
  );

  speak(
    info.greeting ||
    "這個世界已經展開了！你想再加入什麼呢？"
  );
}

async function setWorldImage(
  dataUrl,
  name
) {
  if (
    typeof dataUrl !== "string" ||
    !dataUrl.startsWith("data:image/")
  ) {
    throw new Error(
      "背景 API 沒有回傳有效圖片"
    );
  }

  const img =
    await loadImageAsync(
      dataUrl
    );

  S.worldImage = img;
  S.worldImageData = dataUrl;

  S.worldName =
    name || "我的想像世界";

  $("worldTitle").textContent =
    "✨ " + S.worldName;

  console.log(
    "[PlusPlus] 世界圖片已載入",
    img.width,
    img.height
  );

  setStatus(
    "世界圖片載入成功：" +
    img.width +
    " × " +
    img.height
  );
}

/* ==================================================
   場景特效
================================================== */

function startSceneEffect(
  effect = "sparkle"
) {
  S.effectName = effect;
  S.effectUntil = millis() + 3000;

  const start = performance.now();

  const timer = setInterval(() => {
    if (
      performance.now() - start > 3000
    ) {
      clearInterval(timer);
      return;
    }

    const x =
      Math.random() * width;

    const y =
      Math.random() * height * .8;

    emitParticles(
      x,
      y,
      7,
      effect
    );
  }, 130);
}

/* ==================================================
   語音控制世界
================================================== */

async function handleVoiceCommand(message) {
  if (S.busy) return;

  try {
    setBusy(
      true,
      "💬 正在理解你的想法……"
    );

    const context = {
      worldName: S.worldName,
      worldPrompt: S.worldPrompt,
      characters: S.heroes.map(h => ({
        name: h.name,
        description: h.description,
        movement: h.movement
      })),
      selectedCharacter:
        getSelectedHero()?.name || ""
    };

    const decision = await callAI(
      "directWorld",
      {
        message,
        context
      },
      120000
    );

    console.log(
      "[PlusPlus] 語音導演",
      decision
    );

    if (
      !window.PPDirector ||
      !PPDirector.execute
    ) {
      throw new Error(
        "ai-director.js 未載入"
      );
    }

    await PPDirector.execute(
      decision
    );

    S.stage = "active";

    setBusy(false);

    setStatus(
      "已處理語音指令：" +
      message
    );

    showNotice(
      "✨ " +
      (decision.reply ||
        "世界已收到你的想法"),
      false
    );

    setTimeout(() => {
      if (!S.busy) hideNotice();
    }, 5000);

  } catch (error) {
    setBusy(false);
    reportError("語音互動", error);
  }
}

function getSelectedHero() {
  return S.heroes.find(
    h => h.id === S.selectedId
  ) || S.heroes[
    S.heroes.length - 1
  ] || null;
}

function updateCharacterList() {
  const host = $("characterList");

  host.replaceChildren();

  if (!S.heroes.length) {
    host.textContent = "尚未加入角色";
    return;
  }

  for (const hero of S.heroes) {
    const item =
      document.createElement("button");

    item.className =
      "characterRow" +
      (hero.id === S.selectedId
        ? " active"
        : "");

    item.textContent =
      "🧩 " + hero.name +
      "｜" + hero.movement;

    item.addEventListener(
      "click",
      () => {
        S.selectedId = hero.id;
        updateCharacterList();

        showNotice(
          "已選擇「" + hero.name + "」"
        );
      }
    );

    host.appendChild(item);
  }
}

/* ==================================================
   測試、重新生成、清空
================================================== */

async function testConnection() {
  try {
    setBusy(
      true,
      "🔌 正在測試 AI 連線……"
    );

    const result = await callAI(
      "ping",
      {},
      30000
    );

    setBusy(false);

    showNotice(
      "✅ " + result.message
    );

    setStatus(
      result.message +
      "｜圖片模型：" +
      result.imageModel
    );

  } catch (error) {
    setBusy(false);
    reportError("AI 連線測試", error);
  }
}

async function regenerateWorld() {
  if (S.busy) return;

  const info = S.creationInfo;

  if (!info) {
    showNotice(
      "請先拍攝一件積木作品。"
    );
    return;
  }

  try {
    setBusy(
      true,
      "🌈 正在重新創造世界……"
    );

    if (
      info.kind === "environment" &&
      S.creationImage
    ) {
      const result = await callAI(
        "generateScene",
        {
          image: S.creationImage,
          info
        },
        180000
      );

      await setWorldImage(
        result.image,
        info.worldName
      );

    } else {
      const result = await callAI(
        "generateWorld",
        { info },
        180000
      );

      await setWorldImage(
        result.image,
        info.worldName
      );
    }

    startSceneEffect(
      info.effect
    );

    setBusy(false);

    showNotice(
      "✨ 世界已重新生成"
    );

  } catch (error) {
    setBusy(false);
    reportError("重新生成世界", error);
  }
}

function clearWorld() {
  if (
    "speechSynthesis" in window
  ) {
    speechSynthesis.cancel();
  }

  S.heroes = [];
  S.selectedId = null;

  S.worldImage = null;
  S.worldImageData = null;
  S.worldName = "我的想像世界";
  S.worldPrompt = "";

  S.sceneOriginal = null;
  S.sceneOriginalData = null;

  S.creationImage = null;
  S.creationCutout = null;
  S.creationInfo = null;

  S.arrival = null;
  S.particles = [];

  S.lastError = "";
  S.stage = "idle";

  $("worldTitle").textContent =
    "Plus-Plus｜想像有形";

  updateCharacterList();

  setStatus(
    "世界已清空，可以重新創作"
  );

  showNotice(
    "🌱 新的想像世界準備好了！"
  );
}

/* ==================================================
   介面事件
================================================== */

function setupUI() {
  $("beginBtn").addEventListener(
    "click",
    async () => {
      $("intro").style.display = "none";

      S.started = true;

      playConfirmSound();

      showNotice(
        "歡迎來到想像世界！先拍攝一件積木作品吧。"
      );

      setStatus(
        "已開始創作，等待拍照"
      );

      speak(
        "歡迎來到想像世界！" +
        "把你拼好的積木拍下來，" +
        "我們一起看看它會變成什麼。"
      );
    }
  );

  $("photoBtn").addEventListener(
    "click",
    openCamera
  );

  $("cameraCloseBtn").addEventListener(
    "click",
    closeCamera
  );

  $("captureBtn").addEventListener(
    "click",
    capturePhoto
  );

  $("uploadBtn").addEventListener(
    "click",
    () => $("photoInput").click()
  );

  $("photoInput").addEventListener(
    "change",
    async event => {
      const file =
        event.target.files &&
        event.target.files[0];

      if (!file) return;

      try {
        const dataUrl =
          await fileToDataURL(file);

        closeCamera();

        await processCreation(
          dataUrl
        );
      } catch (error) {
        reportError(
          "讀取照片",
          error
        );
      }

      event.target.value = "";
    }
  );

  $("voiceBtn").addEventListener(
    "click",
    toggleListening
  );

  $("soundBtn").addEventListener(
    "click",
    () => {
      S.soundEnabled =
        !S.soundEnabled;

      $("soundBtn").textContent =
        S.soundEnabled
          ? "🔊"
          : "🔇";

      if (
        !S.soundEnabled &&
        "speechSynthesis" in window
      ) {
        speechSynthesis.cancel();
      }

      showNotice(
        S.soundEnabled
          ? "已開啟語音"
          : "已關閉語音"
      );
    }
  );

  const togglePanel = () => {
    $("panel").classList.toggle(
      "open"
    );
  };

  $("moreBtn").addEventListener(
    "click",
    togglePanel
  );

  $("panelBtn").addEventListener(
    "click",
    togglePanel
  );

  $("fullscreenBtn").addEventListener(
    "click",
    async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement
            .requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch (error) {
        setStatus(
          "無法切換全螢幕：" +
          error.message
        );
      }
    }
  );

  $("testBtn").addEventListener(
    "click",
    testConnection
  );

  $("retryBtn").addEventListener(
    "click",
    regenerateWorld
  );

  $("clearBtn").addEventListener(
    "click",
    () => {
      if (
        confirm(
          "確定清空目前的角色與世界嗎？"
        )
      ) {
        clearWorld();
      }
    }
  );
}

window.addEventListener(
  "DOMContentLoaded",
  () => {
    setupUI();
    setupSpeechRecognition();
    initBridge();
    updateCharacterList();
  }
);
