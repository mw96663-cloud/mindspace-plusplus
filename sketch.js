
/**
 * Plus-Plus Layered World v3
 * sketch.js
 */

// ★ 填入你的 Google Apps Script /exec 網址
const GAS_URL = "https://script.google.com/macros/s/AKfycbxVswrdmiv0CjmI2Na13dEFDGKIjjB-Sb3pG57Nj6j_hf3blMEWenCUoFn2rsLNsQXx/exec";

const APP_ID = "plusplus-layered-v3";
const $ = id => document.getElementById(id);

const S = {
  bridgeReady: false,
  token: "",
  requests: new Map(),
  serial: 0,

  busy: false,
  stage: "等待創作",
  error: "",

  heroes: [],
  selectedId: null,

  worldImage: null,
  worldName: "我的想像世界",
  worldPrompt: "",

  originalScene: null,
  environmentObjects: [],

  lastPhoto: null,
  lastInfo: null,

  arrival: null,
  particles: [],
  ambient: [],

  soundOn: true,
  recognition: null,
  listening: false,
  cameraStream: null,
  audioContext: null
};

function uid() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 9);
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function pause(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function status(message) {
  S.stage = message;

  $("status").textContent =
    "狀態：" + message +
    "\nAI Bridge：" +
    (S.bridgeReady ? "已連線" : "未連線") +
    "\n角色數：" + S.heroes.length +
    "\n背景物件：" + S.environmentObjects.length +
    "\n世界：" + S.worldName +
    (S.error ? "\n錯誤：" + S.error : "");

  console.log("[PlusPlus]", message);
}

function notice(message, loading = false) {
  $("messageText").textContent = message;
  $("loading").hidden = !loading;
  $("message").hidden = false;
}

function hideNotice() {
  $("message").hidden = true;
}

function busy(value, message = "") {
  S.busy = value;
  $("photo").disabled = value;
  $("mic").disabled = value;

  if (value && message) {
    notice(message, true);
  }

  if (!value) {
    $("loading").hidden = true;
  }
}

function fail(label, error) {
  S.error = label + "：" +
    (error?.message || String(error));

  console.error("[PlusPlus]", label, error);
  status(label + "失敗");
  notice("⚠️ " + S.error);
}

/* ======================================
   Bridge
====================================== */

function createToken() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);

  return Array.from(bytes)
    .map(n => n.toString(16).padStart(2, "0"))
    .join("");
}

function initBridge() {
  if (!GAS_URL.includes("/exec")) {
    status("尚未設定 GAS_URL");
    return;
  }

  S.token = createToken();

  const url = new URL(GAS_URL);
  url.searchParams.set("bridge", "1");
  url.searchParams.set("token", S.token);
  url.searchParams.set("parentOrigin", location.origin);

  window.addEventListener("message", onBridgeMessage);
  $("bridge").src = url.toString();

  status("正在連線 AI Bridge");
}

function onBridgeMessage(event) {
  const data = event.data || {};

  if (data.app !== APP_ID ||
      data.token !== S.token) return;

  const origin = String(event.origin || "");

  if (
    origin !== "https://script.google.com" &&
    !/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com$/i
      .test(origin)
  ) return;

  if (data.type === "ready") {
    S.bridgeReady = true;
    status("AI Bridge 已連線");

    for (const request of S.requests.values()) {
      if (!request.sent) {
        request.sent = true;
        sendRequest(request.message);
      }
    }

    return;
  }

  if (data.type !== "response") return;

  const pending = S.requests.get(data.id);
  if (!pending) return;

  clearTimeout(pending.timer);
  S.requests.delete(data.id);

  if (data.ok) {
    pending.resolve(data.result);
  } else {
    pending.reject(new Error(data.error || "AI 錯誤"));
  }
}

function sendRequest(message) {
  $("bridge").contentWindow.postMessage(message, "*");
}

function ai(route, payload = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    if (!GAS_URL.includes("/exec")) {
      reject(new Error("請先填寫 GAS_URL"));
      return;
    }

    const id = "r" + (++S.serial);
    const message = {
      app: APP_ID,
      token: S.token,
      type: "request",
      id,
      route,
      payload
    };

    const timer = setTimeout(() => {
      S.requests.delete(id);
      reject(new Error(
        route + " 超過等待時間，請檢查 GAS 執行記錄"
      ));
    }, timeout);

    const entry = {
      resolve, reject, timer, message,
      sent: S.bridgeReady
    };

    S.requests.set(id, entry);

    if (S.bridgeReady) {
      sendRequest(message);
    }
  });
}

/* ======================================
   p5.js
====================================== */

function setup() {
  const c = createCanvas(windowWidth, windowHeight);
  c.parent("world");

  pixelDensity(1);
  imageMode(CENTER);
  rectMode(CENTER);
  textAlign(CENTER, CENTER);

  initAmbient();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  initAmbient();
}

function initAmbient() {
  S.ambient = Array.from({length: 35}, () => ({
    x: Math.random(),
    y: Math.random(),
    phase: Math.random() * TWO_PI,
    size: 2 + Math.random() * 5
  }));
}

function draw() {
  const t = millis();

  drawBackground(t);
  drawAmbient(t);
  drawEnvironmentObjects(t);
  drawOriginalScene(t);
  drawHeroes(t);
  drawArrival(t);
  drawParticles();
  drawWorkingAnimation(t);
}

function drawBackground(t) {
  if (S.worldImage) {
    coverImage(S.worldImage, width / 2, height / 2, width, height);
    return;
  }

  const gradient = drawingContext.createLinearGradient(
    0, 0, 0, height
  );

  gradient.addColorStop(0, "#d9eef6");
  gradient.addColorStop(.6, "#e8f5ec");
  gradient.addColorStop(1, "#fff0d9");

  drawingContext.fillStyle = gradient;
  drawingContext.fillRect(0, 0, width, height);

  noStroke();
  fill(255, 255, 255, 35);

  for (let i = 0; i < 8; i++) {
    ellipse(
      width * i / 7,
      height * .83 + sin(t * .0005 + i) * 6,
      200, 85
    );
  }
}

function coverImage(img, x, y, w, h) {
  if (!img?.width || !img?.height) return;

  const scale = Math.max(w / img.width, h / img.height);

  image(img, x, y, img.width * scale, img.height * scale);
}

function containImage(img, x, y, w, h) {
  if (!img?.width || !img?.height) return;

  const scale = Math.min(w / img.width, h / img.height);

  image(img, x, y, img.width * scale, img.height * scale);
}

function drawAmbient(t) {
  noStroke();

  for (const p of S.ambient) {
    fill(255, 255, 255, 35 + sin(t * .001 + p.phase) * 25);

    circle(
      p.x * width + sin(t * .0005 + p.phase) * 12,
      p.y * height,
      p.size
    );
  }
}

function drawEnvironmentObjects(t) {
  for (const obj of S.environmentObjects) {
    if (!obj.image) continue;

    push();

    const x = obj.x * width;
    const y = obj.y * height +
      sin(t * .001 + obj.phase) * 2;

    const size = obj.size * Math.min(width, height);

    drawingContext.shadowColor = "#536a7933";
    drawingContext.shadowBlur = 12;

    containImage(obj.image, x, y, size, size);
    pop();
  }
}

function drawOriginalScene(t) {
  if (!S.originalScene?.image) return;

  const scene = S.originalScene;

  push();

  drawingContext.shadowColor = "#40556644";
  drawingContext.shadowBlur = 20;

  containImage(
    scene.image,
    scene.x * width,
    scene.y * height + sin(t * .001) * 2,
    Math.min(width * .52, 520),
    Math.min(height * .58, 520)
  );

  pop();
}

/* ======================================
   角色 + 永久原始圖層 + 新增配件
====================================== */

function drawHeroes(t) {
  for (const hero of S.heroes) {
    if (hero.entering) continue;

    updateHero(hero, t);

    const x = hero.x * width;
    const y = hero.y * height;

    const baseSize = Math.min(
      width * .35,
      height * .39,
      hero.size * (width / 1100)
    ) * hero.scale;

    push();
    translate(x, y);

    if (hero.direction < 0) {
      scale(-1, 1);
    }

    // 背後配件先畫
    for (const part of hero.accessories) {
      if (part.layer === "back") {
        drawAccessory(part, baseSize);
      }
    }

    // ★ 永遠繪製最初的去背照片
    // 此欄位不會被語音修改
    drawingContext.shadowColor = "#34495e44";
    drawingContext.shadowBlur = 16;

    containImage(
      hero.original,
      0, 0,
      baseSize,
      baseSize
    );

    // 前方配件後畫
    for (const part of hero.accessories) {
      if (part.layer !== "back") {
        drawAccessory(part, baseSize);
      }
    }

    pop();

    if (hero.speech && t < hero.speechUntil) {
      speechBubble(
        hero.speech,
        x,
        y - baseSize * .65
      );
    }
  }
}

function drawAccessory(part, baseSize) {
  if (!part.image) return;

  const pos = part.position;

  const x = pos.x * baseSize;
  const y = pos.y * baseSize;

  const size = baseSize * part.scale;

  push();
  translate(x, y);

  if (part.animate === "flap") {
    const pulse = sin(millis() * .012) * .07;
    scale(1 + pulse, 1 - pulse);
  }

  containImage(
    part.image,
    0, 0,
    size, size
  );

  pop();
}

function updateHero(hero, t) {
  const dt = Math.min(deltaTime || 16, 40);
  const move = hero.movement || "float";

  if (["walk", "fly", "swim", "glide"].includes(move)) {
    hero.x += hero.direction * hero.speed * dt;

    if (hero.x > .87) {
      hero.x = .87;
      hero.direction = -1;
    }

    if (hero.x < .13) {
      hero.x = .13;
      hero.direction = 1;
    }
  }

  if (move === "fly") {
    hero.y = hero.baseY +
      sin(t * .0015 + hero.phase) * .055;
  } else if (move === "swim") {
    hero.y = hero.baseY +
      sin(t * .0012 + hero.phase) * .025;
  } else if (move === "bounce") {
    hero.y = hero.baseY -
      abs(sin(t * .002 + hero.phase)) * .075;
  } else if (move === "float") {
    hero.y = hero.baseY +
      sin(t * .001 + hero.phase) * .025;
  } else {
    hero.y = hero.baseY;
  }
}

function speechBubble(message, x, y) {
  const value = String(message).slice(0, 32);

  push();
  textSize(15);

  const w = clamp(textWidth(value) + 36, 130, 350);
  const cx = clamp(x, w / 2 + 10, width - w / 2 - 10);
  const cy = Math.max(112, y - 15);

  noStroke();
  fill(255, 255, 255, 235);
  rect(cx, cy, w, 47, 16);

  fill("#45576b");
  text(value, cx, cy);

  pop();
}

/* ======================================
   動畫
====================================== */

function drawArrival(t) {
  const a = S.arrival;
  if (!a) return;

  const p = clamp((t - a.start) / 1500, 0, 1);
  const eased = 1 - pow(1 - p, 3);

  push();

  tint(255, p * 255);

  containImage(
    a.image,
    width / 2,
    height * (.35 + eased * .3),
    a.size * (.12 + eased * .88),
    a.size * (.12 + eased * .88)
  );

  noTint();
  pop();

  if (p >= 1) {
    S.arrival = null;
    burst(width / 2, height * .65, 45);
    a.resolve();
  }
}

function arrival(img, size = 300) {
  return new Promise(resolve => {
    S.arrival = {
      image: img,
      size: Math.min(size, width * .45, height * .5),
      start: millis(),
      resolve
    };
  });
}

function burst(x, y, count = 25, colorValue = "#ffffff") {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * TWO_PI;

    S.particles.push({
      x, y,
      vx: cos(angle) * (1 + Math.random() * 3),
      vy: sin(angle) * (1 + Math.random() * 3),
      life: 1100 + Math.random() * 1200,
      maxLife: 2300,
      size: 4 + Math.random() * 8,
      color: colorValue
    });
  }

  if (S.particles.length > 400) {
    S.particles.splice(0, S.particles.length - 400);
  }
}

function drawParticles() {
  for (let i = S.particles.length - 1; i >= 0; i--) {
    const p = S.particles[i];

    p.x += p.vx;
    p.y += p.vy;
    p.life -= Math.min(deltaTime || 16, 40);

    if (p.life <= 0) {
      S.particles.splice(i, 1);
      continue;
    }

    push();

    const c = color(p.color);
    c.setAlpha(220 * clamp(p.life / p.maxLife, 0, 1));

    fill(c);
    noStroke();

    rect(p.x, p.y, p.size * .4, p.size);
    rect(p.x, p.y, p.size, p.size * .4);

    pop();
  }
}

function drawWorkingAnimation(t) {
  if (!S.busy) return;

  push();
  noStroke();

  for (let i = 0; i < 9; i++) {
    const angle = t * .0013 + i * TWO_PI / 9;

    fill(255, 255, 255, 120);

    circle(
      width / 2 + cos(angle) * 52,
      height * .27 + sin(angle) * 30,
      7
    );
  }

  pop();
}

function effect(name = "sparkle") {
  const colors = {
    snow: "#ffffff",
    leaves: "#a7dfb5",
    bubbles: "#b5e9ff",
    fireflies: "#fff0a5",
    fireworks: "#ffc6d5",
    glow: "#d6c5ff",
    sparkle: "#ffffff"
  };

  const chosen = colors[name] || "#ffffff";
  const start = performance.now();

  const timer = setInterval(() => {
    if (performance.now() - start >= 3000) {
      clearInterval(timer);
      return;
    }

    burst(
      Math.random() * width,
      Math.random() * height * .8,
      5,
      chosen
    );
  }, 140);
}

/* ======================================
   圖片
====================================== */

function loadPicture(dataUrl) {
  return new Promise((resolve, reject) => {
    if (
      typeof dataUrl !== "string" ||
      !dataUrl.startsWith("data:image/")
    ) {
      reject(new Error("AI 沒有回傳有效圖片"));
      return;
    }

    loadImage(
      dataUrl,
      resolve,
      () => reject(new Error("圖片載入失敗"))
    );
  });
}

function resizePhoto(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const ratio = Math.min(
        1,
        1100 / Math.max(img.width, img.height)
      );

      const canvas = document.createElement("canvas");

      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      resolve(canvas.toDataURL("image/jpeg", .82));
    };

    img.onerror = () => reject(
      new Error("照片處理失敗")
    );

    img.src = dataUrl;
  });
}

function fileData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(
      new Error("無法讀取照片")
    );

    reader.readAsDataURL(file);
  });
}

/* ======================================
   第一階段：拍照、去背、進場
   第二階段：AI 創造
   第三階段：主動互動
====================================== */

async function processCreation(rawPhoto) {
  if (S.busy) return;

  S.error = "";

  try {
    busy(true, "📷 拍照成功！正在準備你的作品……");
    confirmSound();

    burst(width / 2, height * .48, 35);

    const photo = await resizePhoto(rawPhoto);
    S.lastPhoto = photo;

    await pause(400);

    status("第一階段：AI 去背");

    busy(true, "✨ 正在移除桌面背景，保留原始積木造型……");

    const cutout = await ai(
      "removeBackgroundAI",
      { image: photo },
      180000
    );

    const original = await loadPicture(cutout.image);

    status("第一階段：透明作品進場");

    busy(true, "🌈 你的作品正在走進想像世界……");

    confirmSound();

    await arrival(original, 340);

    status("第二階段：AI 辨識作品");

    busy(true, "🧠 正在認識你的積木作品……");

    const info = await ai(
      "analyzeCreation",
      { image: photo },
      120000
    );

    S.lastInfo = info;

    console.log("[PlusPlus] 辨識結果", info);

    if (info.kind === "environment") {
      await createEnvironment(original, photo, info);
    } else {
      await createHero(original, cutout.image, info);
    }

    status("第三階段：作品已加入，可以繼續互動");

    busy(false);

    notice("✨ " + info.name + " 已經進入世界！");

    setTimeout(() => {
      if (!S.busy) hideNotice();
    }, 5000);

  } catch (error) {
    busy(false);
    fail("拍照創作", error);
  }
}

/* ======================================
   Character：原始造型永遠不變
====================================== */

async function createHero(original, originalData, info) {
  const hero = {
    id: uid(),
    name: info.name || "我的角色",
    description: info.description || "",

    // ★ 永遠保留最初去背照片
    original: original,
    originalData: originalData,

    // ★ 新增造型只存在這個陣列
    accessories: [],

    x: .5,
    y: .67,
    baseY: .67,
    size: 300,
    scale: 1,
    direction: 1,
    speed: .00007,
    movement: info.movement || "float",
    phase: Math.random() * TWO_PI,

    entering: false,
    speech: "",
    speechUntil: 0
  };

  S.heroes.push(hero);
  S.selectedId = hero.id;

  updateHeroList();

  status("角色已加入：" + hero.name);

  if (!S.worldImage) {
    try {
      busy(true, "🏞️ 正在生成符合角色的 Plus-Plus 世界……");

      const world = await ai(
        "generateWorld",
        { info },
        180000
      );

      await setWorld(world.image, info.worldName);
      S.worldPrompt = info.worldPrompt || "";

    } catch (error) {
      S.error = "背景生成：" + error.message;
      status("角色已加入，背景生成未成功");
    }
  }

  effect(info.effect);
  speak(
    info.greeting || "你好！你想幫我加上什麼新造型呢？",
    hero
  );
}

/* ======================================
   Environment：原始積木場景永遠不變
====================================== */

async function createEnvironment(original, photo, info) {
  S.originalScene = {
    image: original,
    x: .5,
    y: .69
  };

  status("原始積木場景已保留");

  try {
    busy(true, "🏰 正在延伸完整 Plus-Plus 積木世界……");

    const result = await ai(
      "generateEnvironmentLayer",
      {
        image: photo,
        info
      },
      180000
    );

    await setWorld(
      result.image,
      info.worldName || info.name
    );

    S.worldPrompt = info.worldPrompt || "";

  } catch (error) {
    S.error = "場景延伸：" + error.message;
    status("原始場景已加入，但延伸未成功");
  }

  effect(info.effect);

  speak(
    info.greeting ||
    "你的世界已經展開了！想在旁邊增加什麼呢？"
  );
}

async function setWorld(dataUrl, name) {
  const img = await loadPicture(dataUrl);

  S.worldImage = img;
  S.worldName = name || "我的想像世界";

  $("worldTitle").textContent = "✨ " + S.worldName;

  status("世界背景已顯示");
}

/* ======================================
   新增造型的圖層位置
====================================== */

function accessoryPlacement(placement) {
  const presets = {
    back: {
      position: {x: 0, y: -.04},
      scale: 1.3,
      layer: "back"
    },
    head: {
      position: {x: 0, y: -.48},
      scale: .48,
      layer: "front"
    },
    top: {
      position: {x: 0, y: -.52},
      scale: .52,
      layer: "front"
    },
    left: {
      position: {x: -.43, y: 0},
      scale: .65,
      layer: "front"
    },
    right: {
      position: {x: .43, y: 0},
      scale: .65,
      layer: "front"
    },
    front: {
      position: {x: 0, y: .08},
      scale: .65,
      layer: "front"
    },
    tail: {
      position: {x: .45, y: .25},
      scale: .68,
      layer: "back"
    },
    bottom: {
      position: {x: 0, y: .48},
      scale: .55,
      layer: "front"
    },
    center: {
      position: {x: 0, y: 0},
      scale: .7,
      layer: "front"
    }
  };

  return presets[placement] || presets.front;
}

function selectedHero() {
  return S.heroes.find(
    h => h.id === S.selectedId
  ) || S.heroes.at(-1) || null;
}

function findHero(name) {
  if (!name) return selectedHero();

  return S.heroes.find(
    h => h.name === name ||
      h.name.includes(name) ||
      name.includes(h.name)
  ) || selectedHero();
}

function updateHeroList() {
  const host = $("heroList");
  host.replaceChildren();

  if (!S.heroes.length) {
    host.textContent = "尚未加入角色";
    return;
  }

  for (const hero of S.heroes) {
    const button = document.createElement("button");

    button.className =
      "heroBtn" +
      (hero.id === S.selectedId ? " active" : "");

    button.textContent =
      "🧩 " + hero.name +
      "｜新增造型 " + hero.accessories.length + " 個";

    button.onclick = () => {
      S.selectedId = hero.id;
      updateHeroList();
      notice("已選擇「" + hero.name + "」");
    };

    host.appendChild(button);
  }
}

/* ======================================
   相機
====================================== */

async function openCamera() {
  $("cameraModal").classList.add("open");

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("瀏覽器不支援相機");
    }

    S.cameraStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {ideal: "environment"}
        },
        audio: false
      });

    $("video").srcObject = S.cameraStream;
    await $("video").play();

  } catch (error) {
    status("相機無法啟動，可改用選擇照片");
  }
}

function closeCamera() {
  $("cameraModal").classList.remove("open");

  if (S.cameraStream) {
    S.cameraStream.getTracks().forEach(
      track => track.stop()
    );
    S.cameraStream = null;
  }

  $("video").srcObject = null;
}

async function capture() {
  const video = $("video");

  if (!video.videoWidth) {
    notice("相機尚未準備好");
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  canvas.getContext("2d").drawImage(
    video, 0, 0, canvas.width, canvas.height
  );

  const photo = canvas.toDataURL("image/jpeg", .85);

  closeCamera();
  await processCreation(photo);
}

/* ======================================
   音效與語音
====================================== */

function confirmSound() {
  try {
    const AudioClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioClass) return;

    S.audioContext ||= new AudioClass();

    const ctx = S.audioContext;
    ctx.resume();

    const now = ctx.currentTime;

    [523, 659, 784].forEach((frequency, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = frequency;

      gain.gain.setValueAtTime(.0001, now + i * .11);
      gain.gain.exponentialRampToValueAtTime(
        .07, now + i * .11 + .02
      );
      gain.gain.exponentialRampToValueAtTime(
        .0001, now + i * .11 + .24
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * .11);
      osc.stop(now + i * .11 + .25);
    });
  } catch (error) {
    console.warn("音效無法播放", error);
  }
}

function speak(message, hero = null) {
  const value = String(message || "").trim();
  if (!value) return;

  if (hero) {
    hero.speech = value;
    hero.speechUntil = millis() + Math.max(
      3500, value.length * 170
    );
  }

  if (!S.soundOn || !window.speechSynthesis) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(value);
  utterance.lang = "zh-TW";
  utterance.rate = .9;

  const voices = speechSynthesis.getVoices();
  utterance.voice =
    voices.find(v => v.lang === "zh-TW") ||
    voices.find(v => v.lang.startsWith("zh")) ||
    null;

  speechSynthesis.speak(utterance);
}

function initSpeech() {
  const Recognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!Recognition) {
    status("瀏覽器不支援語音辨識，建議使用 Chrome");
    return;
  }

  const recognition = new Recognition();

  recognition.lang = "zh-TW";
  recognition.continuous = false;
  recognition.interimResults = false;

  recognition.onstart = () => {
    S.listening = true;
    $("mic").classList.add("listening");
    notice("🎤 正在聽你說話……");
  };

  recognition.onend = () => {
    S.listening = false;
    $("mic").classList.remove("listening");
  };

  recognition.onerror = e => {
    status("語音辨識：" + e.error);
  };

  recognition.onresult = async e => {
    const message = e.results[0][0].transcript;
    notice("你說：「" + message + "」");
    await voiceCommand(message);
  };

  S.recognition = recognition;
}

function toggleMic() {
  if (!S.recognition) {
    notice("目前瀏覽器不支援語音辨識");
    return;
  }

  if (S.listening) {
    S.recognition.stop();
    return;
  }

  if (window.speechSynthesis) {
    speechSynthesis.cancel();
  }

  try {
    S.recognition.start();
  } catch (error) {
    fail("麥克風", error);
  }
}

/* ======================================
   語音 AI
====================================== */

async function voiceCommand(message) {
  if (S.busy) return;

  try {
    busy(true, "💬 AI 正在理解你的創作想法……");

    const context = {
      worldName: S.worldName,
      worldPrompt: S.worldPrompt,
      hasOriginalScene: !!S.originalScene,
      selectedHero: selectedHero()?.name || "",
      heroes: S.heroes.map(h => ({
        name: h.name,
        description: h.description,
        movement: h.movement,
        accessories: h.accessories.map(a => a.name)
      })),
      environmentObjects:
        S.environmentObjects.map(o => o.name)
    };

    const decision = await ai(
      "directWorld",
      { message, context },
      120000
    );

    console.log("[PlusPlus] AI 語音決策", decision);

    await PPDirector.execute(decision);

    busy(false);
    status("已完成語音互動");
    notice("✨ " + (decision.reply || "創作完成"));

    setTimeout(() => {
      if (!S.busy) hideNotice();
    }, 5000);

  } catch (error) {
    busy(false);
    fail("語音互動", error);
  }
}

/* ======================================
   重新生成背景
====================================== */

async function retryWorld() {
  if (!S.lastInfo || !S.lastPhoto) {
    notice("請先拍攝一件積木作品");
    return;
  }

  try {
    busy(true, "🌈 正在重新生成背景……");

    const route =
      S.lastInfo.kind === "environment"
        ? "generateEnvironmentLayer"
        : "generateWorld";

    const result = await ai(
      route,
      {
        image: S.lastPhoto,
        info: S.lastInfo
      },
      180000
    );

    await setWorld(result.image, S.lastInfo.worldName);

    busy(false);
    effect(S.lastInfo.effect);
    notice("✨ 背景已更新");

  } catch (error) {
    busy(false);
    fail("重新生成背景", error);
  }
}

function clearWorld() {
  S.heroes = [];
  S.selectedId = null;
  S.worldImage = null;
  S.worldName = "我的想像世界";
  S.worldPrompt = "";
  S.originalScene = null;
  S.environmentObjects = [];
  S.lastPhoto = null;
  S.lastInfo = null;
  S.arrival = null;
  S.particles = [];
  S.error = "";

  $("worldTitle").textContent = "Plus-Plus｜想像有形";

  updateHeroList();
  status("世界已清空");
  notice("🌱 新的想像世界準備好了！");
}

/* ======================================
   介面事件
====================================== */

function initUI() {
  $("begin").onclick = () => {
    $("intro").style.display = "none";

    confirmSound();

    notice("歡迎！先拍攝一件積木作品吧。");

    speak(
      "歡迎來到想像世界！" +
      "拍下你拼好的積木，我們一起讓它動起來。"
    );
  };

  $("photo").onclick = openCamera;
  $("capture").onclick = capture;
  $("closeCamera").onclick = closeCamera;

  $("upload").onclick = () => $("file").click();

  $("file").onchange = async e => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const photo = await fileData(file);
      closeCamera();
      await processCreation(photo);
    } catch (error) {
      fail("照片讀取", error);
    }

    e.target.value = "";
  };

  $("mic").onclick = toggleMic;

  $("sound").onclick = () => {
    S.soundOn = !S.soundOn;
    $("sound").textContent = S.soundOn ? "🔊" : "🔇";

    if (!S.soundOn && window.speechSynthesis) {
      speechSynthesis.cancel();
    }

    notice(S.soundOn ? "已開啟語音" : "已關閉語音");
  };

  const togglePanel = () => {
    $("panel").classList.toggle("open");
  };

  $("more").onclick = togglePanel;
  $("panelToggle").onclick = togglePanel;

  $("fullscreen").onclick = async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  };

  $("test").onclick = async () => {
    try {
      busy(true, "正在測試 AI 連線……");

      const result = await ai("ping", {}, 30000);

      busy(false);
      status(result.message);
      notice("✅ " + result.message);

    } catch (error) {
      busy(false);
      fail("連線測試", error);
    }
  };

  $("retry").onclick = retryWorld;

  $("clear").onclick = () => {
    if (confirm("確定清空目前的世界嗎？")) {
      clearWorld();
    }
  };
}

window.addEventListener("DOMContentLoaded", () => {
  initUI();
  initSpeech();
  initBridge();
  updateHeroList();
  status("等待開始創作");
});
