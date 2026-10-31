
/**
 * Plus-Plus Layered World
 * GitHub + Mindspace V2 GAS Bridge
 */

"use strict";

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbxVswrdmiv0CjmI2Na13dEFDGKIjjB-Sb3pG57Nj6j_hf3blMEWenCUoFn2rsLNsQXx/exec";

const APP_ID = "mindspace-v2";
const $ = id => document.getElementById(id);

const S = {
  bridgeReady:false,
  bridgeOrigin:"",
  bridgeWindow:null,
  token:"",
  requests:new Map(),
  serial:0,
  busy:false,
  stage:"等待開始",
  error:"",
  heroes:[],
  selectedId:null,
  worldImage:null,
  worldName:"我的想像世界",
  worldPrompt:"",
  originalScene:null,
  environmentObjects:[],
  lastPhoto:null,
  lastInfo:null,
  arrival:null,
  particles:[],
  ambient:[],
  soundOn:true,
  recognition:null,
  listening:false,
  cameraStream:null,
  audioContext:null
};

function uid() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2,10);
}
function clamp(n,a,b) {
  return Math.max(a,Math.min(b,n));
}
function pause(ms) {
  return new Promise(r=>setTimeout(r,ms));
}
function status(message) {
  S.stage=message;
  const node=$("status");
  if (node) {
    node.textContent =
      "狀態："+message+
      "\nAI Bridge："+(S.bridgeReady?"已連線":"未連線")+
      "\n角色："+S.heroes.length+
      "\n背景物件："+S.environmentObjects.length+
      "\n世界："+S.worldName+
      (S.error?"\n錯誤："+S.error:"");
  }
  console.log("[PlusPlus]",message);
}
function notice(message,loading=false) {
  $("messageText").textContent=message;
  $("loading").hidden=!loading;
  $("message").hidden=false;
}
function hideNotice() {
  $("message").hidden=true;
}
function busy(value,message="") {
  S.busy=value;
  $("photo").disabled=value;
  $("mic").disabled=value;
  if(value&&message)notice(message,true);
  if(!value)$("loading").hidden=true;
}
function fail(label,error) {
  S.error=label+"："+(error?.message||String(error));
  console.error("[PlusPlus]",label,error);
  status(label+"失敗");
  notice("⚠️ "+S.error);
}

/* ===== 一評 Bridge 連線 ===== */

function createToken() {
  if(crypto.randomUUID)return crypto.randomUUID();
  const bytes=new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(n=>n.toString(16).padStart(2,"0")).join("");
}

function validGoogleOrigin(value) {
  try {
    const u=new URL(value);
    return u.protocol==="https:" &&
      (u.hostname==="script.google.com" ||
       u.hostname==="script.googleusercontent.com" ||
       u.hostname.endsWith(".googleusercontent.com"));
  } catch(e) {
    return false;
  }
}

function initializeBridge() {
  if(!GAS_URL.includes("/exec")) {
    status("GAS_URL 尚未設定");
    return;
  }

  const frame=$("bridge");
  if(!frame) {
    status("找不到 bridge iframe");
    return;
  }

  S.bridgeReady=false;
  S.token=createToken();

  window.addEventListener("message",onBridgeMessage);

  const url=new URL(GAS_URL);
  url.searchParams.set("bridgeToken",S.token);
  url.searchParams.set("parentOrigin",location.origin);

  frame.src=url.toString();
  status("正在連線 GAS Bridge");

  setTimeout(()=>{
    if(!S.bridgeReady) {
      status("Bridge 尚未回應，請檢查 GAS doGet 和部署");
    }
  },15000);
}

function onBridgeMessage(event) {
  const d=event.data;

  if(!validGoogleOrigin(event.origin))return;
  if(!d||d.app!==APP_ID||d.token!==S.token)return;

  if(d.kind==="ready") {
    S.bridgeWindow=event.source;
    S.bridgeOrigin=event.origin;
    S.bridgeReady=true;

    event.source.postMessage({
      app:APP_ID,
      token:S.token,
      kind:"ack"
    },event.origin);

    status("GAS Bridge 已連線");

    for(const req of S.requests.values()) {
      if(!req.sent) {
        req.sent=true;
        sendRequest(req.message);
      }
    }
    return;
  }

  if(d.kind!=="response" ||
     event.source!==S.bridgeWindow)return;

  const req=S.requests.get(d.id);
  if(!req)return;

  clearTimeout(req.timer);
  S.requests.delete(d.id);

  if(d.ok)req.resolve(d.result);
  else req.reject(new Error(d.error||"AI 執行失敗"));
}

function sendRequest(message) {
  if(!S.bridgeWindow||!S.bridgeReady) {
    throw new Error("Bridge 尚未連線");
  }
  S.bridgeWindow.postMessage(message,S.bridgeOrigin);
}

function ai(route,payload={},timeout=180000) {
  return new Promise((resolve,reject)=>{
    if(!S.bridgeReady) {
      reject(new Error(
        "AI Bridge 未連線。請檢查 GAS 部署與 Bridge.html"
      ));
      return;
    }

    const id="r"+(++S.serial);
    const message={
      app:APP_ID,
      token:S.token,
      kind:"request",
      id,
      type:route,
      data:payload
    };

    const timer=setTimeout(()=>{
      S.requests.delete(id);
      reject(new Error(route+" 等待逾時"));
    },timeout);

    S.requests.set(id,{
      resolve,reject,timer,message,sent:true
    });

    try {
      sendRequest(message);
    } catch(error) {
      clearTimeout(timer);
      S.requests.delete(id);
      reject(error);
    }
  });
}

async function testConnection() {
  try {
    busy(true,"🔌 測試 GAS Bridge……");

    if(!S.bridgeReady) {
      throw new Error(
        "尚未收到 ready，請確認 GAS 網頁應用程式已部署"
      );
    }

    const result=await ai("ping",{},30000);
    busy(false);
    S.error="";
    status(result.message||"連線成功");
    notice("✅ "+(result.message||"連線成功"));
  } catch(error) {
    busy(false);
    fail("連線測試",error);
  }
}

/* ===== p5.js ===== */

function setup() {
  const c=createCanvas(windowWidth,windowHeight);
  c.parent("world");
  pixelDensity(1);
  imageMode(CENTER);
  rectMode(CENTER);
  textAlign(CENTER,CENTER);
  initAmbient();
}

function windowResized() {
  resizeCanvas(windowWidth,windowHeight);
  initAmbient();
}

function initAmbient() {
  S.ambient=Array.from({length:35},()=>({
    x:Math.random(),
    y:Math.random(),
    phase:Math.random()*TWO_PI,
    size:2+Math.random()*5
  }));
}

function coverImage(img,x,y,w,h) {
  if(!img?.width||!img?.height)return;
  const s=Math.max(w/img.width,h/img.height);
  image(img,x,y,img.width*s,img.height*s);
}

function containImage(img,x,y,w,h) {
  if(!img?.width||!img?.height)return;
  const s=Math.min(w/img.width,h/img.height);
  image(img,x,y,img.width*s,img.height*s);
}

function draw() {
  const t=millis();

  if(S.worldImage) {
    coverImage(S.worldImage,width/2,height/2,width,height);
  } else {
    const g=drawingContext.createLinearGradient(0,0,0,height);
    g.addColorStop(0,"#d9eef6");
    g.addColorStop(.6,"#e8f5ec");
    g.addColorStop(1,"#fff0d9");
    drawingContext.fillStyle=g;
    drawingContext.fillRect(0,0,width,height);
  }

  drawAmbient(t);
  drawEnvironmentObjects(t);
  drawOriginalScene(t);
  drawHeroes(t);
  drawArrival(t);
  drawParticles();
  drawWorking(t);
}

function drawAmbient(t) {
  noStroke();
  for(const p of S.ambient) {
    fill(255,255,255,35+sin(t*.001+p.phase)*25);
    circle(
      p.x*width+sin(t*.0005+p.phase)*12,
      p.y*height,p.size
    );
  }
}

function drawEnvironmentObjects(t) {
  for(const obj of S.environmentObjects) {
    if(!obj.image)continue;
    push();
    drawingContext.shadowColor="#536a7933";
    drawingContext.shadowBlur=12;
    const size=obj.size*Math.min(width,height);
    containImage(
      obj.image,
      obj.x*width,
      obj.y*height+sin(t*.001+obj.phase)*2,
      size,size
    );
    pop();
  }
}

function drawOriginalScene(t) {
  const scene=S.originalScene;
  if(!scene?.image)return;
  push();
  drawingContext.shadowColor="#40556644";
  drawingContext.shadowBlur=20;
  containImage(
    scene.image,
    scene.x*width,
    scene.y*height+sin(t*.001)*2,
    Math.min(width*.52,520),
    Math.min(height*.58,520)
  );
  pop();
}

function updateHero(hero,t) {
  const dt=Math.min(deltaTime||16,40);
  const move=hero.movement||"float";

  if(["walk","fly","swim","glide"].includes(move)) {
    hero.x+=hero.direction*hero.speed*dt;
    if(hero.x>.87) {
      hero.x=.87;hero.direction=-1;
    }
    if(hero.x<.13) {
      hero.x=.13;hero.direction=1;
    }
  }

  if(move==="fly") {
    hero.y=hero.baseY+sin(t*.0015+hero.phase)*.055;
  } else if(move==="swim") {
    hero.y=hero.baseY+sin(t*.0012+hero.phase)*.025;
  } else if(move==="bounce") {
    hero.y=hero.baseY-
      abs(sin(t*.002+hero.phase))*.075;
  } else if(move==="float") {
    hero.y=hero.baseY+sin(t*.001+hero.phase)*.025;
  } else {
    hero.y=hero.baseY;
  }
}

function drawAccessory(part,baseSize) {
  if(!part.image)return;
  push();
  translate(
    part.position.x*baseSize,
    part.position.y*baseSize
  );

  if(part.animate==="flap") {
    const v=sin(millis()*.012)*.07;
    scale(1+v,1-v);
  }

  const size=baseSize*part.scale;
  containImage(part.image,0,0,size,size);
  pop();
}

function drawHeroes(t) {
  for(const hero of S.heroes) {
    if(hero.entering)continue;

    updateHero(hero,t);
    const x=hero.x*width;
    const y=hero.y*height;

    const size=Math.min(
      width*.35,height*.39,
      hero.size*(width/1100)
    )*hero.scale;

    push();
    translate(x,y);
    if(hero.direction<0)scale(-1,1);

    for(const part of hero.accessories) {
      if(part.layer==="back")drawAccessory(part,size);
    }

    // 原始積木圖層永遠獨立保留
    drawingContext.shadowColor="#34495e44";
    drawingContext.shadowBlur=16;
    containImage(hero.original,0,0,size,size);

    for(const part of hero.accessories) {
      if(part.layer!=="back")drawAccessory(part,size);
    }

    pop();

    if(hero.speech&&t<hero.speechUntil) {
      speechBubble(hero.speech,x,y-size*.65);
    }
  }
}

function speechBubble(message,x,y) {
  const value=String(message).slice(0,32);
  push();
  textSize(15);
  const w=clamp(textWidth(value)+36,130,350);
  const cx=clamp(x,w/2+10,width-w/2-10);
  const cy=Math.max(112,y-15);
  noStroke();
  fill(255,255,255,235);
  rect(cx,cy,w,47,16);
  fill("#45576b");
  text(value,cx,cy);
  pop();
}

function arrival(img,size=320) {
  return new Promise(resolve=>{
    S.arrival={
      image:img,
      size:Math.min(size,width*.45,height*.5),
      start:millis(),
      resolve
    };
  });
}

function drawArrival(t) {
  const a=S.arrival;
  if(!a)return;
  const p=clamp((t-a.start)/1500,0,1);
  const eased=1-pow(1-p,3);
  push();
  tint(255,p*255);
  const size=a.size*(.12+eased*.88);
  containImage(
    a.image,width/2,
    height*(.35+eased*.3),
    size,size
  );
  noTint();
  pop();
  if(p>=1) {
    S.arrival=null;
    burst(width/2,height*.65,45);
    a.resolve();
  }
}

function burst(x,y,count=25,c="#ffffff") {
  for(let i=0;i<count;i++) {
    const a=Math.random()*TWO_PI;
    S.particles.push({
      x,y,
      vx:cos(a)*(1+Math.random()*3),
      vy:sin(a)*(1+Math.random()*3),
      life:1200+Math.random()*900,
      size:4+Math.random()*8,
      color:c
    });
  }
  if(S.particles.length>400) {
    S.particles.splice(0,S.particles.length-400);
  }
}

function drawParticles() {
  for(let i=S.particles.length-1;i>=0;i--) {
    const p=S.particles[i];
    p.x+=p.vx;
    p.y+=p.vy;
    p.life-=Math.min(deltaTime||16,40);

    if(p.life<=0) {
      S.particles.splice(i,1);
      continue;
    }

    push();
    const c=color(p.color);
    c.setAlpha(220*clamp(p.life/2000,0,1));
    fill(c);noStroke();
    rect(p.x,p.y,p.size*.4,p.size);
    rect(p.x,p.y,p.size,p.size*.4);
    pop();
  }
}

function drawWorking(t) {
  if(!S.busy)return;
  push();noStroke();
  for(let i=0;i<9;i++) {
    const a=t*.0013+i*TWO_PI/9;
    fill(255,255,255,130);
    circle(
      width/2+cos(a)*52,
      height*.27+sin(a)*30,7
    );
  }
  pop();
}

function effect(name="sparkle") {
  const colors={
    snow:"#ffffff",
    leaves:"#a7dfb5",
    bubbles:"#b5e9ff",
    fireflies:"#fff0a5",
    fireworks:"#ffc6d5",
    glow:"#d6c5ff",
    sparkle:"#ffffff"
  };
  const start=performance.now();
  const timer=setInterval(()=>{
    if(performance.now()-start>3000) {
      clearInterval(timer);return;
    }
    burst(
      Math.random()*width,
      Math.random()*height*.8,
      5,colors[name]||"#ffffff"
    );
  },140);
}

/* ===== 圖片 ===== */

function loadPicture(dataUrl) {
  return new Promise((resolve,reject)=>{
    if(typeof dataUrl!=="string"||
       !dataUrl.startsWith("data:image/")) {
      reject(new Error("AI 沒有回傳有效圖片"));
      return;
    }
    loadImage(
      dataUrl,resolve,
      ()=>reject(new Error("圖片載入失敗"))
    );
  });
}

function resizePhoto(dataUrl) {
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>{
      const ratio=Math.min(
        1,1100/Math.max(img.width,img.height)
      );
      const c=document.createElement("canvas");
      c.width=Math.round(img.width*ratio);
      c.height=Math.round(img.height*ratio);
      c.getContext("2d").drawImage(
        img,0,0,c.width,c.height
      );
      resolve(c.toDataURL("image/jpeg",.82));
    };
    img.onerror=()=>reject(new Error("照片處理失敗"));
    img.src=dataUrl;
  });
}

function fileData(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(
      new Error("無法讀取照片")
    );
    reader.readAsDataURL(file);
  });
}

/* ===== 角色與場景 ===== */

function accessoryPlacement(value) {
  const presets={
    back:{position:{x:0,y:-.04},scale:1.3,layer:"back"},
    head:{position:{x:0,y:-.48},scale:.48,layer:"front"},
    top:{position:{x:0,y:-.52},scale:.52,layer:"front"},
    left:{position:{x:-.43,y:0},scale:.65,layer:"front"},
    right:{position:{x:.43,y:0},scale:.65,layer:"front"},
    front:{position:{x:0,y:.08},scale:.65,layer:"front"},
    tail:{position:{x:.45,y:.25},scale:.68,layer:"back"},
    bottom:{position:{x:0,y:.48},scale:.55,layer:"front"},
    center:{position:{x:0,y:0},scale:.7,layer:"front"}
  };
  return presets[value]||presets.front;
}

function selectedHero() {
  return S.heroes.find(h=>h.id===S.selectedId)||
    S.heroes[S.heroes.length-1]||null;
}

function findHero(name) {
  if(!name)return selectedHero();
  return S.heroes.find(h=>
    h.name===name||
    h.name.includes(name)||
    name.includes(h.name)
  )||selectedHero();
}

function updateHeroList() {
  const host=$("heroList");
  host.replaceChildren();

  if(!S.heroes.length) {
    host.textContent="尚未加入角色";
    return;
  }

  for(const hero of S.heroes) {
    const button=document.createElement("button");
    button.className="heroBtn"+
      (hero.id===S.selectedId?" active":"");
    button.textContent=
      "🧩 "+hero.name+
      "｜新增造型 "+hero.accessories.length+" 個";
    button.onclick=()=>{
      S.selectedId=hero.id;
      updateHeroList();
      notice("已選擇「"+hero.name+"」");
    };
    host.appendChild(button);
  }
}

async function setWorld(dataUrl,name) {
  S.worldImage=await loadPicture(dataUrl);
  S.worldName=name||"我的想像世界";
  $("worldTitle").textContent="✨ "+S.worldName;
  status("世界背景已顯示");
}

async function createHero(original,originalData,info) {
  const hero={
    id:uid(),
    name:info.name||"我的角色",
    description:info.description||"",
    original,
    originalData,
    accessories:[],
    x:.5,y:.67,baseY:.67,
    size:300,scale:1,direction:1,
    speed:.00007,
    movement:info.movement||"float",
    phase:Math.random()*TWO_PI,
    entering:false,
    speech:"",
    speechUntil:0
  };

  S.heroes.push(hero);
  S.selectedId=hero.id;
  updateHeroList();

  if(!S.worldImage) {
    try {
      busy(true,"🏞️ 正在生成 Plus-Plus 世界……");
      const result=await ai(
        "generateWorld",{info},180000
      );
      await setWorld(result.image,info.worldName);
      S.worldPrompt=info.worldPrompt||"";
    } catch(error) {
      S.error="背景生成："+error.message;
      status("角色已加入，背景生成失敗");
      notice("⚠️ "+S.error);
    }
  }

  effect(info.effect||"sparkle");
  speak(
    info.greeting||
    "你好！你想為我增加什麼造型呢？",
    hero
  );
}

async function createEnvironment(original,photo,info) {
  S.originalScene={
    image:original,
    sourcePhoto:photo,
    x:.5,y:.69
  };

  try {
    busy(true,"🏰 正在延伸積木世界……");
    const result=await ai(
      "generateEnvironmentLayer",
      {image:photo,info},180000
    );
    await setWorld(
      result.image,info.worldName||info.name
    );
    S.worldPrompt=info.worldPrompt||"";
  } catch(error) {
    S.error="場景延伸："+error.message;
    status("原始場景已加入，延伸失敗");
    notice("⚠️ "+S.error);
  }

  effect(info.effect||"sparkle");
  speak(
    info.greeting||
    "你的世界展開了！還想增加什麼呢？"
  );
}

async function processCreation(rawPhoto) {
  if(S.busy)return;
  S.error="";

  try {
    busy(true,"📷 正在準備你的積木照片……");
    confirmSound();

    const photo=await resizePhoto(rawPhoto);
    S.lastPhoto=photo;

    status("第一階段：AI 去背");
    busy(true,"✨ 正在移除背景……");

    const cutout=await ai(
      "removeBackgroundAI",
      {image:photo},180000
    );

    const original=await loadPicture(cutout.image);

    busy(true,"🌈 你的作品正在進入世界……");
    await arrival(original,340);

    status("第二階段：AI 辨識");
    busy(true,"🧠 正在理解你的作品……");

    const info=await ai(
      "analyzeCreation",
      {image:photo},120000
    );

    S.lastInfo=info;

    if(info.kind==="environment") {
      await createEnvironment(original,photo,info);
    } else {
      await createHero(original,cutout.image,info);
    }

    busy(false);
    status("作品已加入，可以語音互動");
    notice("✨ "+info.name+" 已進入世界！");

    setTimeout(()=>{
      if(!S.busy)hideNotice();
    },5000);
  } catch(error) {
    busy(false);
    fail("拍照創作",error);
  }
}

/* ===== 相機 ===== */

async function openCamera() {
  $("cameraModal").classList.add("open");
  try {
    S.cameraStream=
      await navigator.mediaDevices.getUserMedia({
        video:{facingMode:{ideal:"environment"}},
        audio:false
      });
    $("video").srcObject=S.cameraStream;
    await $("video").play();
  } catch(error) {
    notice("無法開啟相機，請改用選擇照片");
  }
}

function closeCamera() {
  $("cameraModal").classList.remove("open");
  if(S.cameraStream) {
    S.cameraStream.getTracks().forEach(t=>t.stop());
    S.cameraStream=null;
  }
  $("video").srcObject=null;
}

async function capture() {
  const video=$("video");
  if(!video.videoWidth) {
    notice("相機尚未準備好");return;
  }
  const c=document.createElement("canvas");
  c.width=video.videoWidth;
  c.height=video.videoHeight;
  c.getContext("2d").drawImage(
    video,0,0,c.width,c.height
  );
  const photo=c.toDataURL("image/jpeg",.85);
  closeCamera();
  await processCreation(photo);
}

/* ===== 聲音與語音 ===== */

function confirmSound() {
  if(!S.soundOn)return;
  try {
    const AudioClass=
      window.AudioContext||window.webkitAudioContext;
    if(!AudioClass)return;

    S.audioContext||=new AudioClass();
    const ctx=S.audioContext;
    ctx.resume();
    const now=ctx.currentTime;

    [523,659,784].forEach((f,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type="sine";
      osc.frequency.value=f;
      gain.gain.setValueAtTime(.0001,now+i*.11);
      gain.gain.exponentialRampToValueAtTime(
        .07,now+i*.11+.02
      );
      gain.gain.exponentialRampToValueAtTime(
        .0001,now+i*.11+.24
      );
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now+i*.11);
      osc.stop(now+i*.11+.25);
    });
  } catch(error) {
    console.warn("音效無法播放",error);
  }
}

function speak(message,hero=null) {
  const value=String(message||"").trim();
  if(!value)return;

  if(hero) {
    hero.speech=value;
    hero.speechUntil=millis()+
      Math.max(3500,value.length*170);
  }

  if(!S.soundOn||!window.speechSynthesis)return;

  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(value);
  u.lang="zh-TW";
  u.rate=.9;

  const voices=speechSynthesis.getVoices();
  u.voice=voices.find(v=>v.lang==="zh-TW")||
    voices.find(v=>v.lang.startsWith("zh"))||null;

  speechSynthesis.speak(u);
}

function initSpeech() {
  const Recognition=
    window.SpeechRecognition||
    window.webkitSpeechRecognition;

  if(!Recognition) {
    status("瀏覽器不支援語音辨識");
    return;
  }

  const r=new Recognition();
  r.lang="zh-TW";
  r.continuous=false;
  r.interimResults=false;

  r.onstart=()=>{
    S.listening=true;
    $("mic").classList.add("listening");
    notice("🎤 正在聽你說話……");
  };

  r.onend=()=>{
    S.listening=false;
    $("mic").classList.remove("listening");
  };

  r.onerror=e=>{
    notice("⚠️ 語音辨識："+e.error);
  };

  r.onresult=async e=>{
    const message=e.results[0][0].transcript;
    notice("你說：「"+message+"」");
    await voiceCommand(message);
  };

  S.recognition=r;
}

function toggleMic() {
  if(!S.recognition) {
    notice("建議使用支援語音辨識的 Chrome");
    return;
  }
  if(S.listening) {
    S.recognition.stop();return;
  }
  window.speechSynthesis?.cancel();
  try {
    S.recognition.start();
  } catch(error) {
    fail("麥克風",error);
  }
}

async function voiceCommand(message) {
  if(S.busy)return;

  try {
    busy(true,"💬 AI 正在理解你的想像……");

    const context={
      worldName:S.worldName,
      worldPrompt:S.worldPrompt,
      hasOriginalScene:!!S.originalScene,
      selectedHero:selectedHero()?.name||"",
      heroes:S.heroes.map(h=>({
        name:h.name,
        description:h.description,
        movement:h.movement,
        accessories:h.accessories.map(a=>a.name)
      })),
      environmentObjects:
        S.environmentObjects.map(o=>o.name)
    };

    const decision=await ai(
      "directWorld",
      {message,context},120000
    );

    await PPDirector.execute(decision);

    busy(false);
    status("語音互動完成");
    notice("✨ "+(decision.reply||"創作完成"));

    setTimeout(()=>{
      if(!S.busy)hideNotice();
    },5000);
  } catch(error) {
    busy(false);
    fail("語音互動",error);
  }
}

/* ===== 其他操作 ===== */

async function retryWorld() {
  if(!S.lastInfo) {
    notice("請先拍攝積木作品");
    return;
  }

  try {
    busy(true,"🌈 正在重新生成背景……");
    const scene=S.lastInfo.kind==="environment";

    const result=await ai(
      scene?"generateEnvironmentLayer":"generateWorld",
      {image:S.lastPhoto,info:S.lastInfo},
      180000
    );

    await setWorld(
      result.image,S.lastInfo.worldName
    );

    busy(false);
    effect("sparkle");
    notice("✨ 背景已更新");
  } catch(error) {
    busy(false);
    fail("背景生成",error);
  }
}

function clearWorld() {
  S.heroes=[];
  S.selectedId=null;
  S.worldImage=null;
  S.worldName="我的想像世界";
  S.worldPrompt="";
  S.originalScene=null;
  S.environmentObjects=[];
  S.lastPhoto=null;
  S.lastInfo=null;
  S.arrival=null;
  S.particles=[];
  S.error="";
  $("worldTitle").textContent="Plus-Plus｜想像有形";
  updateHeroList();
  status("世界已清空");
  notice("🌱 新世界準備好了！");
}

function initUI() {
  $("begin").onclick=()=>{
    $("intro").style.display="none";
    confirmSound();
    notice("歡迎！先拍攝一件積木作品吧。");
    speak("歡迎來到想像世界！拍下你拼好的積木吧。");
  };

  $("photo").onclick=openCamera;
  $("capture").onclick=capture;
  $("closeCamera").onclick=closeCamera;
  $("upload").onclick=()=>$("file").click();
  $("cameraUpload").onclick=()=>$("file").click();

  $("file").onchange=async e=>{
    const file=e.target.files?.[0];
    if(!file)return;
    try {
      const photo=await fileData(file);
      closeCamera();
      await processCreation(photo);
    } catch(error) {
      fail("照片讀取",error);
    }
    e.target.value="";
  };

  $("mic").onclick=toggleMic;

  $("sound").onclick=()=>{
    S.soundOn=!S.soundOn;
    $("sound").textContent=S.soundOn?"🔊":"🔇";
    if(!S.soundOn)window.speechSynthesis?.cancel();
    notice(S.soundOn?"已開啟聲音":"已關閉聲音");
  };

  const togglePanel=()=>{
    $("panel").classList.toggle("open");
  };

  $("more").onclick=togglePanel;
  $("panelToggle").onclick=togglePanel;

  $("fullscreen").onclick=async()=>{
    try {
      if(document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch(error) {
      notice("無法進入全螢幕");
    }
  };

  $("test").onclick=testConnection;
  $("retry").onclick=retryWorld;
  $("clear").onclick=()=>{
    if(confirm("確定清空目前世界嗎？"))clearWorld();
  };
}

window.addEventListener("DOMContentLoaded",()=>{
  initUI();
  initSpeech();
  initializeBridge();
  updateHeroList();
  status("等待開始創作");
});
