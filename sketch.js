
"use strict";

/* ==================================================
   Mindspace Plus-Plus
   sketch.js
   ================================================== */

// 改成你部署 Google Apps Script 後取得的 /exec 網址
const GAS_URL = "請填入你的_GAS_部署網址";

const $ = id => document.getElementById(id);

const WORLD_KEY = "mindspace_plusplus_world_v1";

const app = {
  nodes: [],
  selectedId: null,
  candidate: null,
  cameraStream: null,
  captured: null,
  busy: false,
  ready: false,
  pending: new Map(),
  seq: 0,
  sketch: null,
  removeBackground: null,
  recording: false,
  recognition: null,
  worldWidth: 1200,
  worldHeight: 750
};

window.Mindspace = app;

function uid() {
  return "n_" + Date.now().toString(36) +
    "_" + Math.random().toString(36).slice(2, 8);
}

function status(message) {
  $("status").textContent = message;
}

function cameraStatus(message) {
  $("cameraStatus").textContent = message;
}

function safeText(value, fallback = "") {
  return typeof value === "string"
    ? value.slice(0, 10000)
    : fallback;
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, Number(value) || 0));
}

function logMessage(who, message, user = false) {
  const div = document.createElement("div");
  div.className = "message" + (user ? " user" : "");
  div.textContent = who + "：" + message;
  $("log").appendChild(div);
  $("log").scrollTop = $("log").scrollHeight;
}

function speak(message) {
  if (!$("voiceReply").checked) return;
  if (!window.speechSynthesis) return;

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = "zh-TW";
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
}

/* ==================================================
   GAS iframe Bridge
   ================================================== */

function setupBridge() {
  if (!GAS_URL.startsWith("https://")) {
    status("請先設定 GAS_URL");
    return;
  }

  $("aiBridge").src = GAS_URL;

  window.addEventListener("message", event => {
    if (event.source !== $("aiBridge").contentWindow) {
      return;
    }

    const data = event.data;
    if (!data || data.channel !== "MINDSPACE_BRIDGE") {
      return;
    }

    if (data.type === "ready") {
      app.ready = true;
      status("AI 已連線，可以開始創作");
      return;
    }

    const pending = app.pending.get(data.id);
    if (!pending) return;

    app.pending.delete(data.id);
    clearTimeout(pending.timer);

    if (data.ok) {
      pending.resolve(data.result);
    } else {
      pending.reject(
        new Error(data.error || "AI 請求失敗")
      );
    }
  });
}

function askBackend(action, payload = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    if (!app.ready) {
      reject(new Error("AI 尚未連線"));
      return;
    }

    const id = "req_" + (++app.seq);

    const timer = setTimeout(() => {
      app.pending.delete(id);
      reject(new Error("AI 回應逾時"));
    }, timeout);

    app.pending.set(id, { resolve, reject, timer });

    $("aiBridge").contentWindow.postMessage({
      channel: "MINDSPACE_BRIDGE",
      id,
      action,
      payload
    }, "*");
  });
}

/* ==================================================
   Camera
   ================================================== */

async function openCamera() {
  $("cameraModal").classList.add("show");
  $("photoPreview").style.display = "none";
  $("cameraVideo").style.display = "block";
  app.captured = null;

  try {
    app.cameraStream =
      await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

    $("cameraVideo").srcObject = app.cameraStream;
    await $("cameraVideo").play();
    cameraStatus("請將積木作品放在鏡頭中央");

  } catch (error) {
    cameraStatus("相機無法開啟：" + error.message);
  }
}

function stopCamera() {
  app.cameraStream?.getTracks().forEach(
    track => track.stop()
  );
  app.cameraStream = null;
  $("cameraVideo").srcObject = null;
}

function closeCamera() {
  stopCamera();
  $("cameraModal").classList.remove("show");
}

function capturePhoto() {
  const video = $("cameraVideo");

  if (!video.videoWidth) {
    cameraStatus("相機尚未準備好");
    return;
  }

  const canvas = document.createElement("canvas");
  const maxSide = 1000;
  const scale = Math.min(
    1,
    maxSide / Math.max(video.videoWidth, video.videoHeight)
  );

  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);

  canvas.getContext("2d").drawImage(
    video, 0, 0, canvas.width, canvas.height
  );

  app.captured = canvas.toDataURL("image/jpeg", 0.86);

  $("photoPreview").src = app.captured;
  $("photoPreview").style.display = "block";
  video.style.display = "none";

  cameraStatus("拍攝完成，可以進行 AI 去背");
}

async function retakePhoto() {
  app.captured = null;
  $("photoPreview").style.display = "none";
  $("cameraVideo").style.display = "block";
  cameraStatus("請重新拍攝");
}

async function getBackgroundRemover() {
  if (app.removeBackground) {
    return app.removeBackground;
  }

  // 在瀏覽器執行 AI 去背，不需將照片傳給去背 API。
  const module = await import(
    "https://esm.sh/@imgly/background-removal@1.7.0"
  );

  app.removeBackground = module.removeBackground;
  return app.removeBackground;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("圖片讀取失敗"));
    reader.readAsDataURL(blob);
  });
}

async function removePhotoBackground() {
  if (!app.captured) {
    cameraStatus("請先拍照");
    return;
  }

  if (app.busy) return;
  app.busy = true;
  $("removeBg").disabled = true;

  try {
    cameraStatus("AI 正在去背，第一次可能需要下載模型……");

    const removeBackground = await getBackgroundRemover();

    const resultBlob = await removeBackground(
      app.captured,
      {
        output: {
          format: "image/png",
          quality: 1
        }
      }
    );

    const image = await blobToDataURL(resultBlob);

    const description =
      $("photoDescription").value.trim();

    // 去背成功後，攝影視窗自動消失。
    closeCamera();

    app.candidate = {
      image,
      description,
      type: "character",
      name: ""
    };

    $("candidateImage").src = image;
    $("candidateName").value = "";
    $("candidateType").value = "character";
    $("classification").style.display = "block";
    $("aiSuggestion").textContent = "AI 正在觀察作品……";

    status("去背成功，正在分析作品類型");

    try {
      const analysis = await askBackend("inspect", {
        image: await resizeDataURL(image, 600),
        description
      });

      app.candidate.type =
        analysis.type === "environment"
          ? "environment"
          : "character";

      app.candidate.name =
        safeText(analysis.name, "我的積木作品");

      $("candidateType").value = app.candidate.type;
      $("candidateName").value = app.candidate.name;

      $("aiSuggestion").textContent =
        "AI 建議：" +
        (app.candidate.type === "character"
          ? "角色"
          : "環境") +
        "。原因：" +
        safeText(analysis.reason, "根據外觀及描述判斷") +
        "。你可以自由更改。";

    } catch (error) {
      $("aiSuggestion").textContent =
        "AI 辨識暫時失敗，仍可由你自己選擇類型：" +
        error.message;
    }

  } catch (error) {
    cameraStatus("去背失敗：" + error.message);
    status("AI 去背失敗：" + error.message);

  } finally {
    app.busy = false;
    $("removeBg").disabled = false;
  }
}

function resizeDataURL(dataURL, maxSide = 700) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const scale = Math.min(
        1,
        maxSide / Math.max(img.width, img.height)
      );

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));

      canvas.getContext("2d").drawImage(
        img, 0, 0, canvas.width, canvas.height
      );

      resolve(canvas.toDataURL("image/png"));
    };

    img.onerror = () => reject(new Error("圖片格式錯誤"));
    img.src = dataURL;
  });
}

/* ==================================================
   World nodes
   ================================================== */

function createNode(data) {
  const node = {
    id: data.id || uid(),
    type: data.type === "environment"
      ? "environment"
      : "character",

    name: safeText(data.name, "未命名作品"),
    description: safeText(data.description),

    // 實體積木的原始透明 PNG
    image: data.image || "",

    // AI 生成的 SVG 視覺元素
    svg: data.svg || "",

    x: clamp(data.x ?? 600, 0, 1200),
    y: clamp(data.y ?? 380, 0, 750),
    width: clamp(data.width ?? 180, 15, 900),
    height: clamp(data.height ?? 180, 15, 900),

    layer: clamp(data.layer ?? 1, -10, 10),
    rotation: Number(data.rotation) || 0,
    opacity: clamp(data.opacity ?? 1, 0, 1),

    motion: data.motion || null,
    born: performance.now(),
    visual: null
  };

  setNodeVisual(node);
  return node;
}

function setNodeVisual(node) {
  if (node.image) {
    node.visual = new Image();
    node.visual.src = node.image;
  } else if (node.svg && window.AIDirector) {
    AIDirector.loadSVG(node);
  }
}

function addNode(data) {
  const node = createNode(data);
  app.nodes.push(node);
  app.selectedId = node.id;
  refreshLists();
  return node;
}

function confirmCandidate() {
  if (!app.candidate) return;

  const type = $("candidateType").value;
  const name =
    $("candidateName").value.trim() || "我的積木作品";

  const count = app.nodes.length;

  addNode({
    type,
    name,
    image: app.candidate.image,
    description: app.candidate.description,
    x: 420 + (count % 5) * 85,
    y: type === "environment" ? 420 : 340,
    width: type === "environment" ? 300 : 180,
    height: type === "environment" ? 240 : 180,
    layer: type === "environment" ? -2 : 2
  });

  $("classification").style.display = "none";

  const candidate = app.candidate;
  app.candidate = null;

  status(name + " 已加入共同世界");

  // 由 AI 延伸作品，但不覆蓋原始積木造型。
  if (window.AIDirector) {
    AIDirector.onNewCreation(candidate, name, type)
      .catch(error => {
        status("作品已加入，AI 延伸暫時失敗：" + error.message);
      });
  }
}

function selectNode(id) {
  app.selectedId = id;
  refreshLists();
}

function removeSelected() {
  if (!app.selectedId) return;

  app.nodes = app.nodes.filter(
    node => node.id !== app.selectedId
  );

  app.selectedId = null;
  refreshLists();
}

function refreshLists() {
  const characters = $("characterList");
  const environments = $("environmentList");

  characters.replaceChildren();
  environments.replaceChildren();

  for (const node of app.nodes) {
    if (node.type !== "character" &&
        node.type !== "environment") continue;

    const item = document.createElement("div");
    item.className =
      "item" +
      (node.id === app.selectedId ? " selected" : "");

    const img = document.createElement("img");
    img.src = node.image || node.visual?.src || "";

    const info = document.createElement("div");
    info.className = "item-info";

    const name = document.createElement("div");
    name.className = "item-name";
    name.textContent = node.name;

    const description = document.createElement("div");
    description.className = "small";
    description.textContent =
      node.description.slice(0, 60);

    info.append(name, description);
    item.append(img, info);
    item.onclick = () => selectNode(node.id);

    (node.type === "character"
      ? characters
      : environments).appendChild(item);
  }

  const selected = app.nodes.find(
    node => node.id === app.selectedId
  );

  $("selectedInfo").textContent = selected
    ? selected.name + "｜" +
      (selected.type === "character" ? "角色" : "環境")
    : "尚未選擇作品";

  $("worldCount").textContent =
    app.nodes.length + " 個作品";
}

/* ==================================================
   p5.js world renderer
   AI 提供圖像和運動參數，
   不用技能名稱選擇固定特效。
   ================================================== */

function motionValue(node, key, seconds) {
  const motion = node.motion;
  if (!motion || !motion[key]) return 0;

  const spec = motion[key];
  const amplitude = clamp(spec.amplitude, -1000, 1000);
  const speed = clamp(spec.speed, -20, 20);
  const phase = Number(spec.phase) || 0;

  return Math.sin(seconds * speed + phase) * amplitude;
}

function startWorld() {
  app.sketch = new p5(p => {
    let dragging = null;
    let dragX = 0;
    let dragY = 0;

    p.setup = () => {
      const parent = $("world");
      const canvas = p.createCanvas(
        parent.clientWidth,
        parent.clientHeight
      );
      canvas.parent(parent);
      p.imageMode(p.CENTER);
      p.rectMode(p.CENTER);
    };

    p.windowResized = () => {
      p.resizeCanvas(
        $("world").clientWidth,
        $("world").clientHeight
      );
    };

    function coordinates() {
      return {
        x: p.mouseX * 1200 / p.width,
        y: p.mouseY * 750 / p.height
      };
    }

    function nodeAt(x, y) {
      const ordered = [...app.nodes].sort(
        (a, b) => b.layer - a.layer
      );

      return ordered.find(node =>
        Math.abs(x - node.x) < node.width / 2 &&
        Math.abs(y - node.y) < node.height / 2
      );
    }

    p.mousePressed = () => {
      if (
        p.mouseX < 0 || p.mouseY < 0 ||
        p.mouseX > p.width || p.mouseY > p.height
      ) return;

      const pos = coordinates();
      dragging = nodeAt(pos.x, pos.y);

      if (dragging) {
        selectNode(dragging.id);
        dragX = pos.x - dragging.x;
        dragY = pos.y - dragging.y;
      }
    };

    p.mouseDragged = () => {
      if (!dragging) return;

      const pos = coordinates();

      dragging.x = clamp(pos.x - dragX, 0, 1200);
      dragging.y = clamp(pos.y - dragY, 0, 750);
    };

    p.mouseReleased = () => {
      dragging = null;
    };

    p.draw = () => {
      p.background("#dcecff");

      const sx = p.width / 1200;
      const sy = p.height / 750;

      p.push();
      p.scale(sx, sy);

      // AI 生成的環境元素與角色共享同一張畫布。
      const ordered = [...app.nodes].sort(
        (a, b) => a.layer - b.layer
      );

      const now = performance.now() / 1000;

      for (const node of ordered) {
        const seconds = now - node.born / 1000;

        const dx = motionValue(node, "x", seconds);
        const dy = motionValue(node, "y", seconds);
        const angle = motionValue(node, "rotation", seconds);
        const scale = 1 + motionValue(node, "scale", seconds);

        p.push();
        p.translate(node.x + dx, node.y + dy);
        p.rotate(node.rotation + angle);
        p.scale(clamp(scale, 0.1, 5));

        const ctx = p.drawingContext;
        ctx.globalAlpha = node.opacity;

        if (node.visual?.complete &&
            node.visual.naturalWidth > 0) {
          p.image(
            node.visual,
            0, 0,
            node.width,
            node.height
          );
        } else {
          p.noStroke();
          p.fill("#b7c9e9");
          p.ellipse(0, 0, node.width, node.height);
        }

        ctx.globalAlpha = 1;

        if (node.id === app.selectedId) {
          p.noFill();
          p.stroke("#617ff1");
          p.strokeWeight(2);
          p.rect(
            0, 0,
            node.width + 12,
            node.height + 12,
            12
          );
        }

        p.pop();
      }

      p.pop();
    };
  });
}

/* ==================================================
   Save and load
   ================================================== */

function saveWorld() {
  try {
    const nodes = app.nodes.map(node => ({
      id: node.id,
      type: node.type,
      name: node.name,
      description: node.description,
      image: node.image,
      svg: node.svg,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      layer: node.layer,
      rotation: node.rotation,
      opacity: node.opacity,
      motion: node.motion
    }));

    localStorage.setItem(
      WORLD_KEY,
      JSON.stringify(nodes)
    );

    status("世界已儲存到這個瀏覽器");

  } catch (error) {
    status("儲存失敗，可能是圖片容量過大：" +
      error.message);
  }
}

function loadWorld() {
  try {
    const saved = localStorage.getItem(WORLD_KEY);
    if (!saved) {
      status("沒有找到已儲存的世界");
      return;
    }

    const nodes = JSON.parse(saved);
    if (!Array.isArray(nodes)) {
      throw new Error("儲存格式錯誤");
    }

    app.nodes = nodes.map(createNode);
    app.selectedId = null;
    refreshLists();
    status("已讀取之前的世界");

  } catch (error) {
    status("讀取失敗：" + error.message);
  }
}

/* ==================================================
   Voice
   ================================================== */

function toggleVoice() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    status("此瀏覽器不支援語音辨識，請改用文字輸入");
    return;
  }

  if (app.recording && app.recognition) {
    app.recognition.stop();
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = "zh-TW";
  recognition.continuous = false;
  recognition.interimResults = false;

  app.recognition = recognition;

  recognition.onstart = () => {
    app.recording = true;
    $("mic").textContent = "⏹️ 停止";
    status("正在聆聽孩子的想法……");
  };

  recognition.onresult = event => {
    const text = Array.from(event.results)
      .map(result => result[0].transcript)
      .join(" ");

    $("prompt").value = text;
  };

  recognition.onerror = event => {
    status("語音辨識失敗：" + event.error);
  };

  recognition.onend = () => {
    app.recording = false;
    $("mic").textContent = "🎙️ 說話";

    if ($("prompt").value.trim()) {
      AIDirector.send();
    }
  };

  recognition.start();
}

/* ==================================================
   UI events
   ================================================== */

function setupEvents() {
  $("openCamera").onclick = openCamera;
  $("cameraShortcut").onclick = openCamera;
  $("closeCamera").onclick = closeCamera;
  $("takePhoto").onclick = capturePhoto;
  $("retakePhoto").onclick = retakePhoto;
  $("removeBg").onclick = removePhotoBackground;

  $("confirmCandidate").onclick = confirmCandidate;

  $("cancelCandidate").onclick = () => {
    app.candidate = null;
    $("classification").style.display = "none";
  };

  $("removeSelected").onclick = removeSelected;
  $("saveWorld").onclick = saveWorld;
  $("loadWorld").onclick = loadWorld;

  $("resetView").onclick = () => {
    for (const node of app.nodes) {
      node.x = clamp(node.x, 0, 1200);
      node.y = clamp(node.y, 0, 750);
    }
    status("已將超出範圍的作品移回畫面");
  };

  $("mic").onclick = toggleVoice;

  $("send").onclick = () => AIDirector.send();

  $("prompt").addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      AIDirector.send();
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupEvents();
  setupBridge();
  startWorld();
  refreshLists();

  logMessage(
    "AI",
    "歡迎來到想像世界！你可以創造任何積木作品，" +
    "也可以告訴我希望世界發生什麼事。"
  );
});
