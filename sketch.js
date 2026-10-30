
"use strict";

/*
  PLUS-PLUS WORLD — SKETCH.JS V1
  全新長者互動版本
  以原版 Mindspace GAS Bridge + p5.js 架構改寫
*/

// 替換成你「新」Google Apps Script 的 /exec 網址
const GAS_URL = "PASTE_YOUR_NEW_GAS_EXEC_URL_HERE";

const APP_ID = "plusplus-world-v1";
const $ = id => document.getElementById(id);
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const uid = () => Date.now().toString(36) +
  Math.random().toString(36).slice(2,9);

const S = {
  heroes: [],
  selectedId: null,
  worldName: "我的想像世界",
  worldImage: null,
  worldImageData: "",
  latestCreation: null,
  history: [],
  effects: [],
  bridgeReady: false,
  bridgeWindow: null,
  bridgeOrigin: "",
  bridgeToken: uid()+uid(),
  pending: new Map(),
  cameraStream: null,
  cameraFacing: "environment",
  cameraRequestId: 0,
  recorder: null,
  micStream: null,
  audioChunks: [],
  recording: false,
  busy: false,
  voiceEnabled: true,
  audio: null,
  speechSerial: 0,
  started: false,
  canvas: null
};

function status(text) {
  $("status").textContent = text;
  console.log("[PlusPlus]",text);
}

function bubble(text) {
  $("bubbleText").textContent = text;
}

function busy(on,text="✨ 正在創造想像世界……") {
  S.busy = on;
  $("busyOverlay").classList.toggle("hidden",!on);
  $("busyMessage").textContent = text;
}

function showModal(id,on) {
  $(id).classList.toggle("hidden",!on);
}

function imageLoad(src) {
  return new Promise((resolve,reject)=>{
    const image = new Image();
    image.onload = ()=>resolve(image);
    image.onerror = ()=>reject(Error("圖片載入失敗"));
    image.src = src;
  });
}

async function scaleImage(src,max=700,format="image/jpeg") {
  const img = await imageLoad(src);
  const ratio = Math.min(1,max/Math.max(img.width,img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1,Math.round(img.width*ratio));
  canvas.height = Math.max(1,Math.round(img.height*ratio));
  canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
  return canvas.toDataURL(format,0.86);
}

function fileData(file) {
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(reader.result);
    reader.onerror = ()=>reject(Error("檔案讀取失敗"));
    reader.readAsDataURL(file);
  });
}

/* =============================
   Google Apps Script Bridge
============================= */

function validGoogleOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" &&
      (
        url.hostname === "script.google.com" ||
        url.hostname === "script.googleusercontent.com" ||
        url.hostname.endsWith(".googleusercontent.com")
      );
  } catch(e) {
    return false;
  }
}

function initializeBridge() {
  if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/
    .test(GAS_URL)) {
    status("請先設定新 Google Apps Script 的 GAS_URL");
    return;
  }

  window.addEventListener("message",event=>{
    const m = event.data;
    if (!validGoogleOrigin(event.origin)) return;
    if (!m || m.app !== APP_ID ||
        m.token !== S.bridgeToken) return;

    if (m.kind === "ready") {
      if (event.source !== $("bridgeFrame").contentWindow &&
          S.bridgeWindow &&
          event.source !== S.bridgeWindow) return;

      S.bridgeWindow = event.source;
      S.bridgeOrigin = event.origin;
      S.bridgeReady = true;
      status("✅ AI 已連線");

      event.source.postMessage({
        app:APP_ID,
        kind:"ack",
        token:S.bridgeToken
      },event.origin);
      return;
    }

    if (m.kind === "response") {
      if (event.source !== S.bridgeWindow) return;
      const pending = S.pending.get(m.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      S.pending.delete(m.id);
      m.ok ? pending.resolve(m.result) :
        pending.reject(Error(m.error || "AI 執行失敗"));
    }
  });

  const url = new URL(GAS_URL);
  url.searchParams.set("bridgeToken",S.bridgeToken);
  url.searchParams.set("parentOrigin",location.origin);
  $("bridgeFrame").src = url.toString();

  setTimeout(()=>{
    if (!S.bridgeReady) {
      status("⚠️ AI 尚未連線，請確認 GAS 部署與網址");
    }
  },15000);
}

function callAI(type,data={},timeout=180000) {
  return new Promise((resolve,reject)=>{
    if (!S.bridgeReady || !S.bridgeWindow) {
      reject(Error("AI 尚未連線"));
      return;
    }

    const id = uid();
    const timer = setTimeout(()=>{
      S.pending.delete(id);
      reject(Error("AI 回應逾時："+type));
    },timeout);

    S.pending.set(id,{resolve,reject,timer});

    try {
      S.bridgeWindow.postMessage({
        app:APP_ID,
        token:S.bridgeToken,
        kind:"request",
        id,type,data
      },S.bridgeOrigin);
    } catch(error) {
      clearTimeout(timer);
      S.pending.delete(id);
      reject(error);
    }
  });
}

/* =============================
   語音播放
============================= */

function stopSpeech() {
  S.speechSerial++;
  if (S.audio) {
    S.audio.pause();
    S.audio.src = "";
    S.audio = null;
  }
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
}

function browserSpeech(text) {
  if (!S.voiceEnabled || !("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-TW";
  u.rate = 0.92;
  u.pitch = 1;
  speechSynthesis.speak(u);
}

async function speak(text) {
  if (!S.voiceEnabled || !text) return;

  stopSpeech();
  const serial = S.speechSerial;

  try {
    const result = await callAI("speakNatural",{
      text:String(text).slice(0,500)
    },90000);

    if (serial !== S.speechSerial || !S.voiceEnabled) return;

    const audio = new Audio(
      "data:audio/mpeg;base64,"+result.audio
    );
    S.audio = audio;
    await audio.play();
  } catch(e) {
    if (serial === S.speechSerial) browserSpeech(text);
  }
}

function chat(name,text,ai=false) {
  const div = document.createElement("div");
  div.className = "chat"+(ai?" ai":"");
  div.textContent = name+"："+text;
  $("chatLog").appendChild(div);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
}

function announce(name,text) {
  chat(name,text,true);
  bubble(name+"："+text);
  speak(text);
}

/* =============================
   攝影機
============================= */

function stopCamera() {
  S.cameraStream?.getTracks().forEach(t=>t.stop());
  S.cameraStream = null;
  const video = $("cameraVideo");
  video.pause();
  video.srcObject = null;
  $("captureBtn").disabled = true;
}

async function openCamera() {
  const id = ++S.cameraRequestId;
  stopCamera();
  showModal("cameraModal",true);
  $("cameraMessage").textContent = "正在開啟攝影機……";

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw Error("請使用 HTTPS 並允許攝影機權限");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{
        facingMode:{ideal:S.cameraFacing},
        width:{ideal:1280},
        height:{ideal:720}
      }
    });

    if (id !== S.cameraRequestId) {
      stream.getTracks().forEach(t=>t.stop());
      return;
    }

    S.cameraStream = stream;
    const video = $("cameraVideo");
    video.srcObject = stream;
    await video.play();
    $("captureBtn").disabled = false;
    $("cameraMessage").textContent =
      "請將積木放在畫面中央，按下拍照。";
  } catch(error) {
    $("cameraMessage").textContent = "❌ "+error.message;
    status("相機開啟失敗："+error.message);
  }
}

function closeCamera() {
  S.cameraRequestId++;
  stopCamera();
  showModal("cameraModal",false);
}

async function capturePhoto() {
  const video = $("cameraVideo");

  if (!video.videoWidth || !video.videoHeight) {
    throw Error("攝影機畫面尚未準備完成");
  }

  const canvas = document.createElement("canvas");
  const ratio = Math.min(
    1,900/Math.max(video.videoWidth,video.videoHeight)
  );
  canvas.width = Math.round(video.videoWidth*ratio);
  canvas.height = Math.round(video.videoHeight*ratio);
  canvas.getContext("2d").drawImage(
    video,0,0,canvas.width,canvas.height
  );

  const image = canvas.toDataURL("image/jpeg",0.85);
  closeCamera();
  await processCreation(image);
}

/* =============================
   積木作品辨識與生成
============================= */

async function processCreation(source) {
  if (S.busy) return;

  busy(true,"🧩 AI 正在觀察你的積木作品……");
  bubble("我正在看看你的創作……");

  try {
    const image = await scaleImage(source,700);

    const info = await callAI("analyzeCreation",{
      image,
      hint:S.history.slice(-2).map(x=>x.text).join(" ")
    });

    S.latestCreation = info;

    if (info.needsClarification && info.question) {
      // 不阻斷創作，先採用 AI 的暫時判斷，
      // 再用語音邀請使用者補充。
      bubble(info.question);
    }

    if (info.kind === "environment") {
      await createEnvironment(image,info);
    } else {
      await createHero(image,info);
    }

  } catch(error) {
    status("❌ 作品處理失敗："+error.message);
    bubble("剛剛沒有成功，我們可以再試一次。");
  } finally {
    busy(false);
  }
}

async function setWorldImage(dataUrl,name) {
  const img = await imageLoad(dataUrl);
  S.worldImage = img;
  S.worldImageData = dataUrl;
  S.worldName = name || S.worldName;
  $("title").textContent = "✨ "+S.worldName;
}

async function createEnvironment(image,info) {
  busy(true,"🏰 正在把積木延伸成完整世界……");

  const result = await callAI("generateScene",{
    image,
    description:info.worldPrompt ||
      info.description+" "+info.worldName
  },180000);

  await setWorldImage(result.image,info.worldName);

  startSceneEffect(info.effect);

  announce("AI 夥伴",info.greeting ||
    "你做的場景已經變成一個世界了！");
}

async function createHero(image,info) {
  busy(true,"✨ 正在讓你的積木角色活起來……");

  const result = await callAI("removeBackgroundAI",{
    image
  },180000);

  const hero = {
    id:uid(),
    name:info.name,
    image:await imageLoad(result.image),
    imageData:result.image,
    originalImage:result.image,
    description:info.description,
    movement:info.movement || "float",
    skills:[],
    x:0.45+Math.random()*0.1,
    y:0.58,
    size:150,
    phase:Math.random()*6.28,
    direction:1,
    speed:0.00007,
    created:Date.now(),
    action:null
  };

  S.heroes.push(hero);
  S.selectedId = hero.id;
  updateHeroList();

  if (!S.worldImage) {
    busy(true,"🌈 正在為角色創造積木世界……");
    const world = await callAI("generateWorld",{
      description:info.worldPrompt ||
        "A suitable Plus-Plus block world for "+
        info.name+" "+info.description
    },180000);

    await setWorldImage(world.image,info.worldName);
    startSceneEffect(info.effect);
  }

  announce(hero.name,info.greeting ||
    "你好！我來到你的想像世界了！");
}

function updateHeroList() {
  const container = $("heroList");
  container.innerHTML = "";

  if (!S.heroes.length) {
    container.textContent = "尚未加入角色";
    return;
  }

  S.heroes.forEach(hero=>{
    const btn = document.createElement("button");
    btn.textContent =
      (hero.id === S.selectedId ? "✓ " : "")+
      hero.name;
    btn.onclick = ()=>{
      S.selectedId = hero.id;
      updateHeroList();
    };
    container.appendChild(btn);
  });
}

/* =============================
   AI 場景短暫特效
============================= */

function startSceneEffect(config={}) {
  config = config || {};
  const count = clamp(Number(config.count)||45,8,100);
  const now = performance.now();
  const type = String(config.type||"sparkle");
  const color = /^#[0-9a-f]{6}$/i.test(config.color||"")
    ? config.color : "#fff1b0";

  for (let i=0;i<count;i++) {
    S.effects.push({
      type,color,
      x:Math.random(),
      y:Math.random(),
      vx:(Math.random()-.5)*.00009,
      vy:(Math.random()-.5)*.00013,
      size:3+Math.random()*9,
      start:now,
      end:now+3000,
      seed:Math.random()*100
    });
  }
}

/* =============================
   p5.js 數位世界
============================= */

function startWorld() {
  if (S.canvas) return;

  new p5(p=>{
    p.setup = ()=>{
      const root = $("world");
      const c = p.createCanvas(
        root.clientWidth,root.clientHeight
      );
      c.parent("scene");
      S.canvas = p;
      p.imageMode(p.CENTER);
    };

    p.draw = ()=>{
      const t = performance.now();
      p.background("#b9e8e6");
      drawBackground(p,t);
      drawHeroes(p,t);
      drawEffects(p,t);
    };

    p.windowResized = ()=>{
      const root = $("world");
      p.resizeCanvas(root.clientWidth,root.clientHeight);
    };
  });
}

function drawBackground(p,t) {
  if (S.worldImage) {
    const img = S.worldImage;
    const scale = Math.max(
      p.width/img.width,p.height/img.height
    );
    const w = img.width*scale;
    const h = img.height*scale;

    p.push();
    p.imageMode(p.CENTER);
    p.image(img,p.width/2,p.height/2,w,h);
    p.pop();
    return;
  }

  p.noStroke();
  for (let i=0;i<18;i++) {
    p.fill(255,255,255,18);
    p.circle(
      p.width*(i/18)+Math.sin(t*.0004+i)*12,
      p.height*(.15+(i%5)*.17),
      25+i%4*16
    );
  }
}

function drawHeroes(p,t) {
  S.heroes.forEach(hero=>{
    if (!hero.image) return;

    const age = t-hero.created;
    const phase = t*.0015+hero.phase;

    const modes = {
      fly:(h)=>{
        h.x += h.speed*h.direction*16;
        h.y += Math.sin(phase*1.5)*.0007;
      },
      swim:(h)=>{
        h.x += h.speed*h.direction*10;
        h.y += Math.sin(phase*2)*.0005;
      },
      walk:(h)=>{
        h.x += h.speed*h.direction*5;
        h.y = .77;
      },
      crawl:(h)=>{
        h.x += h.speed*h.direction*3;
        h.y = .80;
      },
      hop:(h)=>{
        h.x += h.speed*h.direction*5;
        h.y = .76-Math.abs(Math.sin(phase*2))*.13;
      },
      float:(h)=>{
        h.x += h.speed*h.direction*3;
        h.y += Math.sin(phase)*.00035;
      }
    };

    (modes[hero.movement]||modes.float)(hero);

    if (hero.x>.9) hero.direction=-1;
    if (hero.x<.1) hero.direction=1;

    hero.y=clamp(hero.y,.16,.86);

    let x=hero.x*p.width;
    let y=hero.y*p.height;
    let rotation=0;
    let size=hero.size;

    if (hero.movement==="fly") {
      rotation=Math.sin(phase*2)*.09;
    }
    if (hero.movement==="swim") {
      rotation=Math.sin(phase*3)*.07;
    }
    if (hero.movement==="walk") {
      y-=Math.abs(Math.sin(phase*4))*5;
    }

    if (hero.action) {
      const a=hero.action;
      const progress=clamp((t-a.start)/a.duration,0,1);
      x+=(a.x-hero.x)*p.width*progress;
      y+=(a.y-hero.y)*p.height*progress;
      size*=1+.12*Math.sin(progress*Math.PI);
      if (progress>=1) {
        hero.x=a.x;
        hero.y=a.y;
        hero.action=null;
      }
    }

    const ratio=hero.image.width/hero.image.height;
    const w=ratio>=1?size:size*ratio;
    const h=ratio>=1?size/ratio:size;

    p.push();
    p.translate(x,y);
    p.scale(hero.direction,1);
    p.rotate(rotation);

    p.noStroke();
    p.fill(30,40,50,35);
    p.ellipse(5,h*.48,w*.7,12);

    p.image(hero.image,0,0,w,h);
    p.pop();
  });
}

function drawEffects(p,t) {
  S.effects=S.effects.filter(e=>t<e.end);

  const renderers={
    sparkle:(e,x,y)=>{
      p.line(x-e.size,y,x+e.size,y);
      p.line(x,y-e.size,x,y+e.size);
    },
    star:(e,x,y)=>{
      p.circle(x,y,e.size);
      p.line(x-e.size,y,x+e.size,y);
    },
    bubble:(e,x,y)=>{
      p.noFill();
      p.circle(x,y,e.size*2);
    },
    snow:(e,x,y)=>{
      p.circle(x,y,e.size);
    },
    rain:(e,x,y)=>{
      p.line(x,y,x-3,y+e.size*2);
    },
    leaf:(e,x,y)=>{
      p.ellipse(x,y,e.size*2,e.size*.7);
    },
    petal:(e,x,y)=>{
      p.ellipse(x,y,e.size*1.5,e.size);
    },
    firework:(e,x,y)=>{
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4;
        p.line(x,y,
          x+Math.cos(a)*e.size*2,
          y+Math.sin(a)*e.size*2);
      }
    }
  };

  S.effects.forEach(e=>{
    const progress=clamp(
      (t-e.start)/(e.end-e.start),0,1
    );
    const fade=Math.min(1,(1-progress)*3);
    const x=(e.x+e.vx*(t-e.start))*p.width;
    const y=(e.y+e.vy*(t-e.start))*p.height;

    p.push();
    const c=p.color(e.color);
    c.setAlpha(255*fade);
    p.stroke(c);
    p.fill(c);
    p.strokeWeight(2);

    (renderers[e.type]||renderers.sparkle)(e,x,y);
    p.pop();
  });
}

/* =============================
   錄音與 AI 語音辨識
============================= */

function recordingFormat() {
  const types=[
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4"
  ];
  return types.find(t=>MediaRecorder.isTypeSupported(t))||"";
}

async function toggleRecording() {
  if (S.recording) {
    S.recorder?.stop();
    return;
  }

  if (S.busy) return;

  if (!navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder==="undefined") {
    bubble("這個瀏覽器不支援錄音，請使用文字輸入。");
    return;
  }

  try {
    S.micStream=await navigator.mediaDevices.getUserMedia({
      audio:true
    });

    const format=recordingFormat();
    S.recorder=new MediaRecorder(
      S.micStream,format?{mimeType:format}:{}
    );
    S.audioChunks=[];

    S.recorder.ondataavailable=e=>{
      if(e.data.size) S.audioChunks.push(e.data);
    };

    S.recorder.onstop=async()=>{
      S.recording=false;
      $("talkBtn").classList.remove("recording");
      $("talkBtn").textContent="🎤";
      $("talkLabel").textContent="說話";
      S.micStream?.getTracks().forEach(t=>t.stop());
      S.micStream=null;

      const blob=new Blob(S.audioChunks,{
        type:S.recorder.mimeType
      });

      if (!blob.size) return;

      busy(true,"🎤 正在理解你說的話……");

      try {
        const data=await fileData(blob);
        const result=await callAI("transcribe",{
          audio:data
        },120000);

        busy(false);

        if (result.text?.trim()) {
          await sendMessage(result.text.trim());
        }
      } catch(e) {
        busy(false);
        status("語音辨識失敗："+e.message);
      }
    };

    S.recorder.start();
    S.recording=true;
    $("talkBtn").classList.add("recording");
    $("talkBtn").textContent="⏹";
    $("talkLabel").textContent="結束";
    bubble("我正在聽，請慢慢說……");

  } catch(e) {
    status("麥克風無法使用："+e.message);
  }
}

/* =============================
   AI 對話入口
============================= */

async function sendMessage(message) {
  message=String(message||"").trim();
  if (!message || S.busy) return;

  chat("我",message);
  $("chatInput").value="";
  S.history.push({role:"user",text:message});

  busy(true,"✨ AI 正在實現你的想像……");

  try {
    const result=await callAI("directWorld",{
      message,
      heroes:S.heroes.map(h=>({
        id:h.id,name:h.name,
        description:h.description,
        movement:h.movement,
        skills:h.skills
      })),
      worldName:S.worldName,
      latestCreation:S.latestCreation,
      history:S.history.slice(-10)
    },120000);

    if (typeof applyDirector==="function") {
      await applyDirector(result);
    }

    const reply=result.reply||"你的想法已經加入世界了！";
    S.history.push({role:"assistant",text:reply});
    announce("AI 夥伴",reply);

  } catch(e) {
    status("AI 互動失敗："+e.message);
    bubble("剛剛沒有成功，我們再試一次。");
  } finally {
    busy(false);
  }
}

/* =============================
   操作介面
============================= */

function togglePanel() {
  $("sidebar").classList.toggle("closed");
  $("moreBtn").textContent=
    $("sidebar").classList.contains("closed")?"☰":"✕";
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await $("app").requestFullscreen();
    }
  } catch(e) {
    status("無法切換全螢幕："+e.message);
  }
}

function bind(id,fn) {
  $(id).addEventListener("click",()=>{
    Promise.resolve().then(fn).catch(e=>{
      status("❌ "+e.message);
    });
  });
}

function setupButtons() {
  bind("startBtn",async()=>{
    $("startScreen").classList.add("hidden");
    S.started=true;
    startWorld();
    bubble("歡迎！先拼出你的作品，再按下拍照。");
  });

  bind("photoBtn",openCamera);
  bind("captureBtn",capturePhoto);
  bind("closeCameraBtn",closeCamera);
  bind("switchBtn",async()=>{
    S.cameraFacing=S.cameraFacing==="environment"
      ?"user":"environment";
    await openCamera();
  });

  bind("talkBtn",toggleRecording);
  bind("soundBtn",()=>{
    S.voiceEnabled=!S.voiceEnabled;
    $("soundBtn").textContent=S.voiceEnabled?"🔊":"🔇";
    if(!S.voiceEnabled)stopSpeech();
  });

  bind("moreBtn",togglePanel);
  bind("panelBtn",togglePanel);
  bind("fullscreenBtn",toggleFullscreen);

  bind("sendBtn",()=>sendMessage($("chatInput").value));
  bind("stopVoiceBtn",stopSpeech);
  bind("testBtn",async()=>{
    const r=await callAI("ping");
    status("✅ "+r.message);
  });

  bind("uploadBtn",()=>$("fileInput").click());

  $("fileInput").addEventListener("change",async e=>{
    const file=e.target.files?.[0];
    if(file) await processCreation(await fileData(file));
    e.target.value="";
  });

  bind("deleteBtn",()=>{
    S.heroes=S.heroes.filter(h=>h.id!==S.selectedId);
    S.selectedId=S.heroes[0]?.id||null;
    updateHeroList();
  });

  document.addEventListener("fullscreenchange",()=>{
    $("fullscreenBtn").textContent=
      document.fullscreenElement?"⛶":"⛶";
    if(S.canvas) {
      setTimeout(()=>{
        S.canvas.resizeCanvas(
          $("world").clientWidth,
          $("world").clientHeight
        );
      },100);
    }
  });

  window.addEventListener("resize",()=>{
    if(S.canvas) {
      S.canvas.resizeCanvas(
        $("world").clientWidth,
        $("world").clientHeight
      );
    }
  });
}

document.addEventListener("DOMContentLoaded",()=>{
  setupButtons();
  initializeBridge();
  updateHeroList();
});
