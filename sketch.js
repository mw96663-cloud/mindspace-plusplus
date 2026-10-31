
/**
 * Plus-Plus Interactive World
 * Frontend / sketch.js
 * GitHub Pages + Mindspace V2 GAS Bridge
 */

"use strict";

const GAS_URL =
  "https://script.google.com/macros/s/AKfycbwUooMD69_NMBhTzxf0Os_D6BEGb3QsGyhXpTGv09emRcG_4du219K4qO_FggY1vnLHOg/exec";

const APP_ID = "mindspace-v2";
const $ = id => document.getElementById(id);
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
const uid = () => Date.now().toString(36) +
  Math.random().toString(36).slice(2,10);

const S = {
  bridgeReady:false,
  bridgeWindow:null,
  bridgeOrigin:"",
  bridgeToken:"",
  pending:new Map(),
  serial:0,
  reconnectCount:0,
  bridgeTimer:null,
  busy:false,
  error:"",
  stage:"初始化中",
  heroes:[],
  selectedId:null,
  worldImage:null,
  worldName:"我的想像世界",
  worldPrompt:"",
  originalScene:null,
  environmentObjects:[],
  lastPhoto:null,
  lastInfo:null,
  particles:[],
  ambient:[],
  soundOn:true,
  cameraStream:null,
  editorOriginal:null,
  editorHistory:[],
  editorMode:"erase",
  editorPainting:false,
  editorPrevious:null,
  recognition:null,
  listening:false,
  audioContext:null
};

/* =========================================
   安全 DOM 操作與狀態
========================================= */

function bind(id,handler) {
  const element=$(id);
  if(!element) {
    console.warn("找不到元素："+id);
    return;
  }
  element.addEventListener("click",event=>{
    try {
      const result=handler(event);
      if(result?.catch) {
        result.catch(error=>fail(id,error));
      }
    } catch(error) {
      fail(id,error);
    }
  });
}

function status(message) {
  S.stage=message;
  const element=$("status");
  if(element) {
    element.textContent=
      "目前狀態："+message+
      "\nAI Bridge："+(S.bridgeReady?"已連線":"未連線")+
      "\n角色數量："+S.heroes.length+
      "\n背景物件："+S.environmentObjects.length+
      "\n世界："+S.worldName+
      (S.error?"\n錯誤："+S.error:"");
  }
  console.log("[Plus-Plus]",message);
}

function notice(message,loading=false) {
  const panel=$("message");
  if(!panel)return;
  $("messageText").textContent=String(message);
  $("loading").hidden=!loading;
  panel.hidden=false;
}

function hideNotice() {
  if($("message"))$("message").hidden=true;
}

function busy(value,message="") {
  S.busy=!!value;
  if($("photo"))$("photo").disabled=!!value;
  if($("mic"))$("mic").disabled=!!value;
  if($("sendText"))$("sendText").disabled=!!value;
  if(value&&message)notice(message,true);
  if(!value&&$("loading"))$("loading").hidden=true;
}

function fail(label,error) {
  const detail=error?.message||String(error);
  S.error=label+"："+detail;
  status(label+"失敗");
  notice("⚠️ "+S.error);
  console.error("[Plus-Plus]",label,error);
}

function createToken() {
  if(window.crypto?.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes=new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(x=>x.toString(16).padStart(2,"0"))
    .join("");
}

/* =========================================
   一評 GAS Bridge
========================================= */

function googleOrigin(origin) {
  try {
    const url=new URL(origin);
    const host=url.hostname.toLowerCase();
    return url.protocol==="https:"&&(
      host==="script.google.com"||
      host==="script.googleusercontent.com"||
      host.endsWith(".googleusercontent.com")
    );
  } catch(error) {
    return false;
  }
}

function onBridgeMessage(event) {
  const message=event.data;

  if(!googleOrigin(event.origin))return;
  if(!message||typeof message!=="object")return;
  if(message.app!==APP_ID)return;
  if(message.token!==S.bridgeToken)return;

  if(message.kind==="ready") {
    if(!event.source)return;

    S.bridgeWindow=event.source;
    S.bridgeOrigin=event.origin;
    S.bridgeReady=true;
    S.error="";

    // 沿用一評：由實際發送 ready 的 window 回覆
    event.source.postMessage({
      app:APP_ID,
      kind:"ack",
      token:S.bridgeToken
    },"*");

    if(S.bridgeTimer) {
      clearTimeout(S.bridgeTimer);
      S.bridgeTimer=null;
    }

    status("✅ GAS 橋接器已連線");
    return;
  }

  if(message.kind==="response") {
    const pending=S.pending.get(message.id);
    if(!pending)return;

    if(event.source!==S.bridgeWindow)return;

    clearTimeout(pending.timer);
    S.pending.delete(message.id);

    if(message.ok) {
      pending.resolve(message.result);
    } else {
      pending.reject(
        new Error(message.error||"AI 後端執行失敗")
      );
    }
  }
}

function initializeBridge() {
  const frame=$("bridge");

  if(!frame) {
    fail("Bridge","找不到 iframe #bridge");
    return;
  }

  if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/
    .test(GAS_URL)) {
    fail("Bridge","GAS_URL 格式錯誤");
    return;
  }

  S.bridgeReady=false;
  S.bridgeWindow=null;
  S.bridgeOrigin="";
  S.bridgeToken=createToken();

  for(const pending of S.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Bridge 已重新連線"));
  }
  S.pending.clear();

  const url=new URL(GAS_URL);
  url.searchParams.set(
    "bridgeToken",S.bridgeToken
  );
  url.searchParams.set(
    "parentOrigin",location.origin
  );

  frame.src=url.toString();
  status("正在等待 GAS Bridge 握手……");

  if(S.bridgeTimer)clearTimeout(S.bridgeTimer);

  S.bridgeTimer=setTimeout(()=>{
    if(!S.bridgeReady) {
      S.error=
        "15 秒內沒有收到 ready。" +
        "請確認 GAS /exec 是含 Bridge.html 的部署版本，" +
        "且允許此 GitHub Pages 網域。";
      status("⚠️ Bridge 尚未連線");
    }
  },15000);
}

function ai(type,data={},timeout=180000) {
  return new Promise((resolve,reject)=>{
    if(!S.bridgeReady||!S.bridgeWindow) {
      reject(new Error(
        "AI Bridge 未連線。" +
        "請先按工作台的「重新連線」，" +
        "確認狀態變成已連線。"
      ));
      return;
    }

    const id="request-"+(++S.serial)+"-"+uid();

    const timer=setTimeout(()=>{
      S.pending.delete(id);
      reject(new Error(
        "AI 回應逾時："+type
      ));
    },timeout);

    S.pending.set(id,{resolve,reject,timer});

    try {
      S.bridgeWindow.postMessage({
        app:APP_ID,
        kind:"request",
        token:S.bridgeToken,
        id,
        type,
        data
      },"*");
    } catch(error) {
      clearTimeout(timer);
      S.pending.delete(id);
      reject(error);
    }
  });
}

async function testConnection() {
  if(!S.bridgeReady) {
    initializeBridge();
    notice(
      "🔄 已重新載入 Bridge，請等待連線狀態更新。"
    );
    return;
  }

  busy(true,"🔌 正在測試 OpenAI 連線……");
  try {
    const result=await ai("ping",{},45000);
    S.error="";
    status("✅ "+(result.message||"AI 連線成功"));
    notice("✅ "+(result.message||"AI 連線成功"));
  } finally {
    busy(false);
  }
}

/* =========================================
   p5.js 世界
========================================= */

function setup() {
  const canvas=createCanvas(windowWidth,windowHeight);
  canvas.parent("world");
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
  S.ambient=Array.from({length:38},()=>({
    x:Math.random(),
    y:Math.random(),
    size:2+Math.random()*5,
    phase:Math.random()*TWO_PI
  }));
}

function containImage(img,x,y,w,h) {
  if(!img?.width||!img?.height)return;
  const scale=Math.min(w/img.width,h/img.height);
  image(img,x,y,img.width*scale,img.height*scale);
}

function coverImage(img,x,y,w,h) {
  if(!img?.width||!img?.height)return;
  const scale=Math.max(w/img.width,h/img.height);
  image(img,x,y,img.width*scale,img.height*scale);
}

function draw() {
  const t=millis();

  if(S.worldImage) {
    coverImage(
      S.worldImage,
      width/2,height/2,width,height
    );
  } else {
    background("#e1f0f3");
    noStroke();
    fill("#d2e9dd");
    rect(width/2,height*.92,width,height*.2);
    fill("#f9e8cb");
    circle(width*.82,height*.22,160);
  }

  drawAmbient(t);
  drawEnvironmentObjects(t);
  drawOriginalScene(t);
  drawHeroes(t);
  drawParticles();
}

function drawAmbient(t) {
  noStroke();
  for(const p of S.ambient) {
    fill(255,255,255,75);
    circle(
      p.x*width+sin(t*.0005+p.phase)*15,
      p.y*height,
      p.size
    );
  }
}

function drawEnvironmentObjects(t) {
  for(const obj of S.environmentObjects) {
    const size=obj.size*Math.min(width,height);
    push();
    drawingContext.shadowColor="#44556655";
    drawingContext.shadowBlur=12;
    containImage(
      obj.image,
      obj.x*width,
      obj.y*height+sin(t*.001+obj.phase)*3,
      size,size
    );
    pop();
  }
}

function drawOriginalScene(t) {
  if(!S.originalScene?.image)return;

  containImage(
    S.originalScene.image,
    width*.5,
    height*.72+sin(t*.001)*3,
    Math.min(width*.48,520),
    Math.min(height*.56,520)
  );
}

function updateHero(hero,t) {
  const dt=Math.min(deltaTime||16,40);
  const move=hero.movement||"float";

  if(["walk","fly","swim","glide"].includes(move)) {
    hero.x+=hero.direction*hero.speed*dt;

    if(hero.x>.87) {
      hero.x=.87;
      hero.direction=-1;
    }
    if(hero.x<.13) {
      hero.x=.13;
      hero.direction=1;
    }
  }

  if(move==="fly") {
    hero.y=hero.baseY+
      sin(t*.0015+hero.phase)*.055;
  } else if(move==="swim") {
    hero.y=hero.baseY+
      sin(t*.0012+hero.phase)*.025;
  } else if(move==="bounce") {
    hero.y=hero.baseY-
      abs(sin(t*.002+hero.phase))*.075;
  } else if(move==="float"||move==="glide") {
    hero.y=hero.baseY+
      sin(t*.001+hero.phase)*.025;
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
    const value=sin(millis()*.012)*.07;
    scale(1+value,1-value);
  }

  const size=baseSize*part.scale;
  containImage(part.image,0,0,size,size);
  pop();
}

function drawHeroes(t) {
  for(const hero of S.heroes) {
    updateHero(hero,t);

    const x=hero.x*width;
    const y=hero.y*height;
    const size=Math.min(
      width*.36,
      height*.4,
      hero.size*(width/1100)
    )*hero.scale;

    push();
    translate(x,y);

    if(hero.direction<0)scale(-1,1);

    for(const part of hero.accessories) {
      if(part.layer==="back") {
        drawAccessory(part,size);
      }
    }

    drawingContext.shadowColor="#35485c55";
    drawingContext.shadowBlur=18;

    // 永遠保留原始去背積木圖層
    containImage(
      hero.original,
      0,0,size,size
    );

    for(const part of hero.accessories) {
      if(part.layer!=="back") {
        drawAccessory(part,size);
      }
    }

    pop();

    if(hero.speech&&t<hero.speechUntil) {
      drawSpeech(hero.speech,x,y-size*.65);
    }
  }
}

function drawSpeech(message,x,y) {
  const textValue=String(message).slice(0,32);
  push();
  textSize(15);
  const w=clamp(textWidth(textValue)+35,130,360);
  const cx=clamp(x,w/2+10,width-w/2-10);
  const cy=Math.max(105,y-15);
  noStroke();
  fill(255,255,255,235);
  rect(cx,cy,w,48,15);
  fill("#425166");
  text(textValue,cx,cy);
  pop();
}

function burst(x,y,count=25,colorValue="#ffffff") {
  for(let i=0;i<count;i++) {
    const angle=Math.random()*TWO_PI;
    S.particles.push({
      x,y,
      vx:cos(angle)*(1+Math.random()*3),
      vy:sin(angle)*(1+Math.random()*3),
      life:1400+Math.random()*800,
      color:colorValue,
      size:3+Math.random()*7
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
    c.setAlpha(200*clamp(p.life/1800,0,1));
    fill(c);
    noStroke();
    rect(p.x,p.y,p.size*.4,p.size);
    rect(p.x,p.y,p.size,p.size*.4);
    pop();
  }
}

function effect(name="sparkle") {
  const colors={
    snow:"#ffffff",
    bubbles:"#b5e9ff",
    fireflies:"#fff0a5",
    fireworks:"#ffc6d5",
    leaves:"#a7dfb5",
    glow:"#d6c5ff",
    sparkle:"#ffffff"
  };

  const start=performance.now();
  const timer=setInterval(()=>{
    if(performance.now()-start>2500) {
      clearInterval(timer);
      return;
    }

    burst(
      Math.random()*width,
      Math.random()*height*.8,
      5,
      colors[name]||"#ffffff"
    );
  },150);
}

/* =========================================
   圖片工具
========================================= */

function loadPicture(src) {
  return new Promise((resolve,reject)=>{
    const image=new Image();
    image.onload=()=>resolve(image);
    image.onerror=()=>reject(
      new Error("圖片載入失敗")
    );
    image.src=src;
  });
}

function fileData(file) {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result);
    reader.onerror=()=>reject(
      new Error("照片讀取失敗")
    );
    reader.readAsDataURL(file);
  });
}

async function scaledData(
  src,max=700,format="image/png"
) {
  const image=await loadPicture(src);
  const ratio=Math.min(
    1,max/Math.max(image.width,image.height)
  );

  const canvas=document.createElement("canvas");
  canvas.width=Math.max(
    1,Math.round(image.width*ratio)
  );
  canvas.height=Math.max(
    1,Math.round(image.height*ratio)
  );

  canvas.getContext("2d").drawImage(
    image,0,0,canvas.width,canvas.height
  );

  return canvas.toDataURL(
    format,
    format==="image/jpeg"?.85:undefined
  );
}

function cropTransparent(canvas) {
  const ctx=canvas.getContext("2d");
  const {width:w,height:h}=canvas;
  const pixels=ctx.getImageData(0,0,w,h).data;

  let left=w,top=h,right=-1,bottom=-1;

  for(let y=0;y<h;y++) {
    for(let x=0;x<w;x++) {
      if(pixels[(y*w+x)*4+3]>10) {
        left=Math.min(left,x);
        right=Math.max(right,x);
        top=Math.min(top,y);
        bottom=Math.max(bottom,y);
      }
    }
  }

  if(right<left) {
    throw new Error("圖片已完全透明");
  }

  left=Math.max(0,left-5);
  top=Math.max(0,top-5);
  right=Math.min(w-1,right+5);
  bottom=Math.min(h-1,bottom+5);

  const out=document.createElement("canvas");
  out.width=right-left+1;
  out.height=bottom-top+1;
  out.getContext("2d").drawImage(
    canvas,
    left,top,out.width,out.height,
    0,0,out.width,out.height
  );
  return out.toDataURL("image/png");
}

/* =========================================
   相機
========================================= */

async function openCamera() {
  $("cameraModal").classList.add("open");

  try {
    if(!navigator.mediaDevices?.getUserMedia) {
      throw new Error("瀏覽器未提供相機權限");
    }

    S.cameraStream=
      await navigator.mediaDevices.getUserMedia({
        video:{
          facingMode:{ideal:"environment"}
        },
        audio:false
      });

    $("video").srcObject=S.cameraStream;
    await $("video").play();
  } catch(error) {
    notice(
      "無法啟動相機，可改用「選擇照片」：" +
      error.message
    );
  }
}

function closeCamera() {
  $("cameraModal").classList.remove("open");

  if(S.cameraStream) {
    S.cameraStream.getTracks()
      .forEach(track=>track.stop());
    S.cameraStream=null;
  }

  $("video").srcObject=null;
}

async function capture() {
  const video=$("video");

  if(!video.videoWidth) {
    notice("相機尚未準備完成");
    return;
  }

  const canvas=document.createElement("canvas");
  canvas.width=video.videoWidth;
  canvas.height=video.videoHeight;
  canvas.getContext("2d").drawImage(
    video,0,0,canvas.width,canvas.height
  );

  const src=canvas.toDataURL("image/jpeg",.88);
  closeCamera();
  await openEditor(src);
}

/* =========================================
   去背編輯器
========================================= */

async function openEditor(src) {
  const image=await loadPicture(src);
  const canvas=$("editCanvas");
  const ratio=Math.min(
    1,850/Math.max(image.width,image.height)
  );

  canvas.width=Math.max(
    1,Math.round(image.width*ratio)
  );
  canvas.height=Math.max(
    1,Math.round(image.height*ratio)
  );

  const ctx=canvas.getContext("2d",{
    willReadFrequently:true
  });

  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(
    image,0,0,canvas.width,canvas.height
  );

  S.editorOriginal=ctx.getImageData(
    0,0,canvas.width,canvas.height
  );
  S.editorHistory=[];
  S.editorMode="erase";
  S.editorPainting=false;
  S.editorPrevious=null;

  $("editorModal").classList.add("open");
}

function editorHistory() {
  const canvas=$("editCanvas");
  const ctx=canvas.getContext("2d");

  S.editorHistory.push(
    ctx.getImageData(
      0,0,canvas.width,canvas.height
    )
  );

  if(S.editorHistory.length>8) {
    S.editorHistory.shift();
  }
}

function undoEditor() {
  const previous=S.editorHistory.pop();
  if(!previous)return;
  $("editCanvas")
    .getContext("2d")
    .putImageData(previous,0,0);
}

function resetEditor() {
  if(!S.editorOriginal)return;
  editorHistory();
  $("editCanvas")
    .getContext("2d")
    .putImageData(S.editorOriginal,0,0);
}

function quickRemoveBg() {
  const canvas=$("editCanvas");
  const ctx=canvas.getContext("2d",{
    willReadFrequently:true
  });
  const w=canvas.width;
  const h=canvas.height;
  const image=ctx.getImageData(0,0,w,h);
  const data=image.data;

  const bg=[0,0,0];
  const corners=[
    [0,0],[w-1,0],[0,h-1],[w-1,h-1]
  ];

  for(const [x,y] of corners) {
    const i=(y*w+x)*4;
    for(let c=0;c<3;c++) {
      bg[c]+=data[i+c]/4;
    }
  }

  const seen=new Uint8Array(w*h);
  const queue=new Int32Array(w*h);
  let head=0,tail=0;

  function enqueue(x,y) {
    if(x<0||y<0||x>=w||y>=h)return;
    const key=y*w+x;
    if(seen[key])return;

    const i=key*4;
    const difference=
      (data[i]-bg[0])**2+
      (data[i+1]-bg[1])**2+
      (data[i+2]-bg[2])**2;

    if(difference>4900)return;
    seen[key]=1;
    queue[tail++]=key;
  }

  editorHistory();

  for(let x=0;x<w;x++) {
    enqueue(x,0);
    enqueue(x,h-1);
  }

  for(let y=0;y<h;y++) {
    enqueue(0,y);
    enqueue(w-1,y);
  }

  while(head<tail) {
    const key=queue[head++];
    const x=key%w;
    const y=Math.floor(key/w);

    data[key*4+3]=0;

    enqueue(x-1,y);
    enqueue(x+1,y);
    enqueue(x,y-1);
    enqueue(x,y+1);
  }

  ctx.putImageData(image,0,0);
  status("快速去背完成，可用筆刷修整");
}

async function aiRemoveBg() {
  const button=$("removeBgAI");
  button.disabled=true;

  try {
    status("AI 正在移除照片背景……");

    const canvas=$("editCanvas");
    const input=await scaledData(
      canvas.toDataURL("image/png"),
      650
    );

    const result=await ai(
      "removeBackgroundAI",
      {image:input},
      180000
    );

    const image=await loadPicture(result.image);

    editorHistory();

    const ctx=canvas.getContext("2d");
    ctx.clearRect(
      0,0,canvas.width,canvas.height
    );
    ctx.drawImage(
      image,0,0,canvas.width,canvas.height
    );

    status("AI 去背完成，可手動修整");
    notice("✨ AI 去背完成");
  } finally {
    button.disabled=false;
  }
}

function editorPoint(event) {
  const canvas=$("editCanvas");
  const rect=canvas.getBoundingClientRect();

  return {
    x:(event.clientX-rect.left)*
      canvas.width/rect.width,
    y:(event.clientY-rect.top)*
      canvas.height/rect.height
  };
}

function paintEditor(event) {
  if(!S.editorPainting)return;

  event.preventDefault();

  const canvas=$("editCanvas");
  const ctx=canvas.getContext("2d",{
    willReadFrequently:true
  });

  const image=ctx.getImageData(
    0,0,canvas.width,canvas.height
  );
  const data=image.data;
  const original=S.editorOriginal.data;

  const point=editorPoint(event);
  const previous=S.editorPrevious||point;
  const radius=Number($("brushSize").value)/2;

  const distance=Math.hypot(
    point.x-previous.x,
    point.y-previous.y
  );

  const steps=Math.max(
    1,Math.ceil(distance/Math.max(1,radius/2))
  );

  for(let step=0;step<=steps;step++) {
    const x=previous.x+
      (point.x-previous.x)*step/steps;
    const y=previous.y+
      (point.y-previous.y)*step/steps;

    const minX=Math.max(0,Math.floor(x-radius));
    const maxX=Math.min(
      canvas.width-1,Math.ceil(x+radius)
    );
    const minY=Math.max(0,Math.floor(y-radius));
    const maxY=Math.min(
      canvas.height-1,Math.ceil(y+radius)
    );

    for(let yy=minY;yy<=maxY;yy++) {
      for(let xx=minX;xx<=maxX;xx++) {
        if((xx-x)**2+(yy-y)**2>radius**2) {
          continue;
        }

        const i=(yy*canvas.width+xx)*4;

        if(S.editorMode==="erase") {
          data[i+3]=0;
        } else {
          for(let c=0;c<4;c++) {
            data[i+c]=original[i+c];
          }
        }
      }
    }
  }

  ctx.putImageData(image,0,0);
  S.editorPrevious=point;
}

function initEditorPointer() {
  const canvas=$("editCanvas");

  canvas.addEventListener("pointerdown",event=>{
    if(!S.editorOriginal)return;
    S.editorPainting=true;
    S.editorPrevious=null;
    editorHistory();
    canvas.setPointerCapture(event.pointerId);
    paintEditor(event);
  });

  canvas.addEventListener("pointermove",paintEditor);

  const finish=()=>{
    S.editorPainting=false;
    S.editorPrevious=null;
  };

  canvas.addEventListener("pointerup",finish);
  canvas.addEventListener("pointercancel",finish);
}

/* =========================================
   角色與世界
========================================= */

function accessoryPlacement(value) {
  const presets={
    back:{
      position:{x:0,y:-.04},
      scale:1.3,layer:"back"
    },
    head:{
      position:{x:0,y:-.48},
      scale:.48,layer:"front"
    },
    top:{
      position:{x:0,y:-.52},
      scale:.52,layer:"front"
    },
    left:{
      position:{x:-.43,y:0},
      scale:.65,layer:"front"
    },
    right:{
      position:{x:.43,y:0},
      scale:.65,layer:"front"
    },
    front:{
      position:{x:0,y:.08},
      scale:.65,layer:"front"
    },
    tail:{
      position:{x:.45,y:.25},
      scale:.68,layer:"back"
    },
    bottom:{
      position:{x:0,y:.48},
      scale:.55,layer:"front"
    },
    center:{
      position:{x:0,y:0},
      scale:.7,layer:"front"
    }
  };
  return presets[value]||presets.front;
}

function selectedHero() {
  return S.heroes.find(
    h=>h.id===S.selectedId
  )||S.heroes[S.heroes.length-1]||null;
}

function findHero(name) {
  const value=String(name||"").trim();
  if(!value)return selectedHero();

  return S.heroes.find(h=>
    h.name===value||
    h.name.includes(value)||
    value.includes(h.name)
  )||selectedHero();
}

function updateHeroList() {
  const host=$("heroList");
  if(!host)return;
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
      "｜配件 "+hero.accessories.length+" 個";

    button.addEventListener("click",()=>{
      S.selectedId=hero.id;
      updateHeroList();
      notice("已選擇「"+hero.name+"」");
    });

    host.appendChild(button);
  }
}

async function setWorld(src,name) {
  S.worldImage=await loadPicture(src);
  S.worldName=name||"我的想像世界";
  $("worldTitle").textContent="✨ "+S.worldName;
  status("世界背景已更新");
}

function newHero(img,data,info) {
  const count=S.heroes.length;

  const hero={
    id:uid(),
    name:info.name||"積木朋友"+(count+1),
    description:info.description||"",
    original:img,
    originalData:data,
    accessories:[],
    x:.28+(count%3)*.22,
    y:.67,
    baseY:.67,
    size:300,
    scale:1,
    direction:1,
    speed:.00007,
    movement:info.movement||"float",
    phase:Math.random()*TWO_PI,
    speech:"",
    speechUntil:0
  };

  S.heroes.push(hero);
  S.selectedId=hero.id;
  updateHeroList();
  burst(hero.x*width,hero.y*height,55);

  return hero;
}

async function saveCreation() {
  if(S.busy)return;

  let imageData;

  try {
    imageData=cropTransparent($("editCanvas"));
    $("editorModal").classList.remove("open");
    S.error="";

    busy(true,"🧠 正在辨識你的積木作品……");

    const source=await scaledData(
      imageData,650
    );

    S.lastPhoto=source;

    const info=await ai(
      "analyzeCreation",
      {image:source},
      120000
    );

    S.lastInfo=info;
    const img=await loadPicture(imageData);

    if(info.kind==="environment") {
      S.originalScene={
        image:img,
        sourcePhoto:source
      };

      busy(true,"🏞️ 正在延伸積木世界……");

      try {
        const result=await ai(
          "generateEnvironmentLayer",
          {image:source,info},
          180000
        );

        await setWorld(
          result.image,
          info.worldName||info.name
        );
      } catch(error) {
        notice(
          "原始場景已保留，但 AI 背景生成失敗："+error.message
        );
      }
    } else {
      const hero=newHero(img,imageData,info);

      if(!S.worldImage) {
        busy(true,"🌈 正在生成積木世界……");

        try {
          const result=await ai(
            "generateWorld",
            {info},
            180000
          );

          await setWorld(
            result.image,info.worldName
          );
        } catch(error) {
          notice(
            "角色已加入，但背景生成失敗："+error.message
          );
        }
      }

      speak(
        info.greeting||
        "你好！你想為我增加什麼呢？",
        hero
      );
    }

    busy(false);
    status("積木作品已加入世界");
    notice("✨ "+info.name+" 已加入世界！");
  } catch(error) {
    busy(false);

    // 如果 AI 無法連線，保留作品並提供離線加入
    if(imageData&&!S.bridgeReady) {
      try {
        const img=await loadPicture(imageData);
        newHero(img,imageData,{
          name:"積木朋友"+(S.heroes.length+1),
          description:"手作 Plus-Plus 積木作品"
        });
        notice(
          "AI 尚未連線，作品已先加入世界。"
        );
        status("離線加入角色成功");
        return;
      } catch(ignored) {}
    }

    fail("作品加入",error);
  }
}

/* =========================================
   語音與聲音
========================================= */

function confirmSound() {
  if(!S.soundOn)return;

  try {
    const AudioClass=
      window.AudioContext||
      window.webkitAudioContext;

    if(!AudioClass)return;

    S.audioContext||=new AudioClass();
    const ctx=S.audioContext;
    ctx.resume();

    const now=ctx.currentTime;

    [523,659,784].forEach((frequency,i)=>{
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();

      osc.type="sine";
      osc.frequency.value=frequency;

      gain.gain.setValueAtTime(
        .0001,now+i*.11
      );
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

  const utterance=
    new SpeechSynthesisUtterance(value);

  utterance.lang="zh-TW";
  utterance.rate=.9;

  const voices=speechSynthesis.getVoices();
  utterance.voice=
    voices.find(v=>v.lang==="zh-TW")||
    voices.find(v=>v.lang.startsWith("zh"))||
    null;

  speechSynthesis.speak(utterance);
}

function initSpeech() {
  const Recognition=
    window.SpeechRecognition||
    window.webkitSpeechRecognition;

  if(!Recognition) {
    console.warn(
      "瀏覽器不支援 Web Speech Recognition"
    );
    return;
  }

  const recognition=new Recognition();
  recognition.lang="zh-TW";
  recognition.continuous=false;
  recognition.interimResults=false;

  recognition.onstart=()=>{
    S.listening=true;
    $("mic").classList.add("listening");
    notice("🎤 正在聆聽……");
  };

  recognition.onend=()=>{
    S.listening=false;
    $("mic").classList.remove("listening");
  };

  recognition.onerror=event=>{
    S.listening=false;
    $("mic").classList.remove("listening");
    notice(
      "⚠️ 語音辨識失敗："+event.error
    );
  };

  recognition.onresult=async event=>{
    const textValue=
      event.results[0][0].transcript;

    $("chatInput").value=textValue;
    notice("你說：「"+textValue+"」");

    await voiceCommand(textValue);
  };

  S.recognition=recognition;
}

function toggleMic() {
  if(!S.recognition) {
    notice(
      "此瀏覽器不支援語音辨識，" +
      "可改用工作台輸入文字。"
    );
    return;
  }

  if(S.listening) {
    S.recognition.stop();
    return;
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
  if(!String(message||"").trim())return;

  busy(true,"🧠 AI 正在理解你的想像……");

  try {
    const context={
      worldName:S.worldName,
      worldPrompt:S.worldPrompt,
      hasOriginalScene:!!S.originalScene,
      selectedHero:selectedHero()?.name||"",
      heroes:S.heroes.map(hero=>({
        name:hero.name,
        description:hero.description,
        movement:hero.movement,
        accessories:hero.accessories.map(
          part=>part.name
        )
      })),
      environmentObjects:
        S.environmentObjects.map(
          object=>object.name
        )
    };

    const decision=await ai(
      "directWorld",
      {message,context},
      120000
    );

    if(!window.PPDirector?.execute) {
      throw new Error(
        "ai-director.js 尚未載入"
      );
    }

    await PPDirector.execute(decision);

    busy(false);
    status("語音互動完成");
    notice(
      "✨ "+(decision.reply||"想像已加入世界")
    );
  } catch(error) {
    busy(false);
    fail("語音互動",error);
  }
}

/* =========================================
   世界操作
========================================= */

async function retryWorld() {
  if(!S.lastInfo) {
    notice("請先拍攝或上傳積木作品");
    return;
  }

  busy(true,"🌈 正在重新生成背景……");

  try {
    const scene=
      S.lastInfo.kind==="environment";

    const result=await ai(
      scene?
        "generateEnvironmentLayer":
        "generateWorld",
      {
        image:S.lastPhoto,
        info:S.lastInfo
      },
      180000
    );

    await setWorld(
      result.image,
      S.lastInfo.worldName
    );

    effect("sparkle");
    notice("✨ 背景已更新");
  } finally {
    busy(false);
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
  S.particles=[];
  S.error="";

  $("worldTitle").textContent=
    "🧩 Plus-Plus｜想像有形";

  updateHeroList();
  status("世界已清空");
  notice("🌱 新世界準備好了！");
}

/* =========================================
   UI 初始化
========================================= */

function initUI() {
  // 各按鈕獨立綁定，不會因單一元素缺失中斷
  bind("begin",()=>{
    $("intro").style.display="none";
    confirmSound();
    notice("歡迎！先拍攝你的積木作品吧。");
    speak("歡迎來到想像世界！");
  });

  bind("photo",openCamera);
  bind("capture",capture);
  bind("closeCamera",closeCamera);

  bind("upload",()=>{
    $("file").click();
  });

  bind("cameraUpload",()=>{
    $("file").click();
  });

  $("file")?.addEventListener(
    "change",async event=>{
      const file=event.target.files?.[0];
      if(!file)return;

      try {
        const data=await fileData(file);
        closeCamera();
        await openEditor(data);
      } catch(error) {
        fail("照片上傳",error);
      }

      event.target.value="";
    }
  );

  bind("removeBgAI",async()=>{
    await aiRemoveBg();
  });

  bind("quickBg",quickRemoveBg);

  bind("eraseMode",()=>{
    S.editorMode="erase";
    status("筆刷模式：擦除");
  });

  bind("restoreMode",()=>{
    S.editorMode="restore";
    status("筆刷模式：還原");
  });

  bind("undoEdit",undoEditor);
  bind("resetEdit",resetEditor);
  bind("saveCreation",saveCreation);

  bind("cancelEditor",()=>{
    $("editorModal").classList.remove("open");
  });

  bind("mic",toggleMic);

  bind("sendText",async()=>{
    const message=$("chatInput").value.trim();
    if(!message)return;
    await voiceCommand(message);
  });

  bind("sound",()=>{
    S.soundOn=!S.soundOn;
    $("sound").textContent=
      S.soundOn?"🔊":"🔇";

    if(!S.soundOn) {
      window.speechSynthesis?.cancel();
    }

    notice(
      S.soundOn?"聲音已開啟":"聲音已關閉"
    );
  });

  bind("more",()=>{
    $("panel").classList.toggle("open");
  });

  bind("panelToggle",()=>{
    $("panel").classList.toggle("open");
  });

  bind("fullscreen",async()=>{
    try {
      if(document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement
          .requestFullscreen();
      }
    } catch(error) {
      notice(
        "無法切換全螢幕："+error.message
      );
    }
  });

  document.addEventListener(
    "fullscreenchange",()=>{
      $("fullscreen").textContent=
        document.fullscreenElement?
        "⛶ 退出全螢幕":"⛶ 全螢幕";
    }
  );

  bind("test",testConnection);
  bind("reconnect",initializeBridge);
  bind("retry",retryWorld);

  bind("clear",()=>{
    if(confirm("確定清空目前世界嗎？")) {
      clearWorld();
    }
  });

  initEditorPointer();
}

function initializePlusPlus() {
  initUI();
  initSpeech();

  window.addEventListener(
    "message",onBridgeMessage
  );

  initializeBridge();
  updateHeroList();
}

if(document.readyState==="loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializePlusPlus,
    {once:true}
  );
} else {
  initializePlusPlus();
}
