
/*
 * Mindspace Plus-Plus
 * sketch.js
 * 第四階段第一步：角色選取與控制
 *
 * 保留原始積木 PNG、AI 分類、世界融合、
 * 環境特效、拖曳、多作品共存。
 *
 * 本檔不直接呼叫 OpenAI。
 * 真實 AI 連線由 index.html / GAS 處理。
 */

const creations = [];
const environments = [];
const particles = [];
const worldZones = [];

window.mindspaceCreations = creations;
window.mindspaceWorldZones = worldZones;

let worldTime = 0;
let activeEffects = [];
let selectedCreationId = null;

window.mindspaceSelectedId = null;

let dragging = null;
let dragDX = 0;
let dragDY = 0;

const MOVEMENTS = [
  "float", "swim", "walk", "fly",
  "bounce", "run", "crawl", "hover"
];

const WORLD_STYLES = {
  meadow: {
    sky: "#BFE9FF",
    ground: "#85C969",
    dark: "#4F9C55",
    accent: "#FFE17A"
  },
  volcano: {
    sky: "#F8C3A7",
    ground: "#AE847D",
    dark: "#805F62",
    accent: "#FF8552"
  },
  ocean: {
    sky: "#8CD6EE",
    ground: "#4D9DC4",
    dark: "#357DA5",
    accent: "#FFB3C7"
  },
  forest: {
    sky: "#C3E6CE",
    ground: "#78B47B",
    dark: "#3C815C",
    accent: "#F2D59B"
  },
  moon: {
    sky: "#C8C9F0",
    ground: "#B6B8D0",
    dark: "#8C91B4",
    accent: "#F6E6B0"
  },
  sky: {
    sky: "#B8DEFA",
    ground: "#D8EAF7",
    dark: "#92C5E8",
    accent: "#FFFFFF"
  },
  city: {
    sky: "#D4DFF0",
    ground: "#9DAFC0",
    dark: "#687D99",
    accent: "#FFD38D"
  },
  fantasy: {
    sky: "#DCCDF5",
    ground: "#A9B4E4",
    dark: "#8B79C4",
    accent: "#FFE0A3"
  }
};

/* =====================================
   01｜初始化
===================================== */

function setup() {
  const canvas = createCanvas(
    windowWidth,
    windowHeight
  );

  canvas.parent("scene");

  imageMode(CENTER);
  rectMode(CENTER);
  noStroke();

  for (let i = 0; i < 35; i++) {
    particles.push({
      x: random(width),
      y: random(height),
      r: random(2, 6),
      speed: random(.2, .8),
      alpha: random(25, 80)
    });
  }

  window.updateMindspaceCount?.(0);
}

function draw() {
  worldTime += min(deltaTime, 100) / 1000;

  drawBackground();
  drawWorldZones();
  drawEnvironmentLayers();
  drawAmbientParticles();

  for (const item of creations) {
    updateCreation(item);
    drawCreation(item);
  }

  drawEffects();
  drawSelectionIndicator();
}

/* =====================================
   02｜世界類型
===================================== */

function detectWorldType(text) {
  const s = String(text || "").toLowerCase();

  if (/月亮|月球|太空|宇宙|moon|space/.test(s)) {
    return "moon";
  }

  if (/天空|雲上|雲端|sky/.test(s)) {
    return "sky";
  }

  if (/城市|都市|街道|city/.test(s)) {
    return "city";
  }

  if (/海底|海洋|水母|鯊魚|海豚|珊瑚|ocean|jellyfish/.test(s)) {
    return "ocean";
  }

  if (/火山|岩漿|熔岩|火龍|volcano|lava/.test(s)) {
    return "volcano";
  }

  if (/森林|樹林|蘑菇|forest/.test(s)) {
    return "forest";
  }

  if (/草原|草地|農場|小狗|狗狗|兔子|puppy|dog|meadow/.test(s)) {
    return "meadow";
  }

  return "fantasy";
}

function normalizeWorldType(value, fallbackText) {
  const key = String(value || "")
    .trim()
    .toLowerCase();

  if (WORLD_STYLES[key]) {
    return key;
  }

  return detectWorldType(
    [value, fallbackText].filter(Boolean).join(" ")
  );
}

function createOrUpdateWorld(item, aiData) {
  const env = aiData?.environment || {};

  const worldType = normalizeWorldType(
    env.worldType,
    [
      item.description,
      aiData?.identity,
      aiData?.name,
      env.theme,
      ...(env.sceneElements || [])
    ].join(" ")
  );

  const sceneElements = Array.isArray(
    env.sceneElements
  )
    ? env.sceneElements.slice(0, 8)
    : [];

  const existing = worldZones.find(
    zone => zone.id === item.id
  );

  if (existing) {
    existing.type = worldType;
    existing.elements = sceneElements;
    existing.createdAt = millis();
  } else {
    worldZones.push({
      id: item.id,
      type: worldType,
      elements: sceneElements,
      createdAt: millis(),
      seed: random(10000)
    });
  }

  item.worldType = worldType;
  item.worldZoneId = item.id;

  startEnvironmentEffect(
    env.effect || "sparkle",
    item.x,
    item.y
  );
}

/* =====================================
   03｜Plus-Plus 積木繪製
===================================== */

function plusBlock(x, y, size, c, angle = 0) {
  push();

  translate(x, y);
  rotate(angle);

  rectMode(CENTER);
  noStroke();
  fill(c);

  rect(
    0, 0,
    size * .42,
    size,
    size * .11
  );

  rect(
    0, 0,
    size,
    size * .42,
    size * .11
  );

  fill(255, 255, 255, 35);

  rect(
    -size * .09,
    -size * .22,
    size * .10,
    size * .30,
    size * .03
  );

  pop();
}

function plusLine(
  x1, y1, x2, y2,
  count, size, c
) {
  const n = max(1, count);

  for (let i = 0; i < n; i++) {
    const t = n === 1
      ? .5
      : i / (n - 1);

    plusBlock(
      lerp(x1, x2, t),
      lerp(y1, y2, t),
      size,
      c
    );
  }
}

function plusRing(
  x, y, rx, ry,
  count, size, c
) {
  for (let i = 0; i < count; i++) {
    const a = TWO_PI * i / count;

    plusBlock(
      x + cos(a) * rx,
      y + sin(a) * ry,
      size,
      c,
      a
    );
  }
}

/* =====================================
   04｜積木環境物件
===================================== */

function drawPlusTree(x, y, scale) {
  const s = 13 * scale;

  plusLine(
    x, y,
    x, y - 92 * scale,
    7, s, "#B7875A"
  );

  plusRing(
    x, y - 115 * scale,
    38 * scale,
    31 * scale,
    12,
    s * 1.15,
    "#4DAE67"
  );

  plusBlock(
    x,
    y - 115 * scale,
    s * 1.8,
    "#76CA73"
  );
}

function drawPlusDogHouse(x, y, scale) {
  const s = 14 * scale;

  for (let row = 0; row < 4; row++) {
    plusLine(
      x - 38 * scale,
      y - row * 17 * scale,
      x + 38 * scale,
      y - row * 17 * scale,
      6, s, "#E9AB72"
    );
  }

  plusLine(
    x - 50 * scale,
    y - 63 * scale,
    x,
    y - 108 * scale,
    5, s, "#D36B5B"
  );

  plusLine(
    x,
    y - 108 * scale,
    x + 50 * scale,
    y - 63 * scale,
    5, s, "#D36B5B"
  );

  plusLine(
    x,
    y,
    x,
    y - 45 * scale,
    4, s, "#76555C"
  );
}

function drawPlusFlower(x, y, scale) {
  const s = 10 * scale;

  plusLine(
    x, y,
    x, y - 28 * scale,
    3, s, "#55B56C"
  );

  plusRing(
    x,
    y - 34 * scale,
    11 * scale,
    11 * scale,
    5, s, "#F7A4C4"
  );

  plusBlock(
    x,
    y - 34 * scale,
    s,
    "#FFE18A"
  );
}

function drawPlusVolcano(x, y, scale) {
  const s = 15 * scale;

  for (let row = 0; row < 7; row++) {
    const yy = y - row * 19 * scale;
    const half = (7 - row) * 19 * scale;

    plusLine(
      x - half,
      yy,
      x + half,
      yy,
      max(2, 15 - row * 2),
      s,
      row % 2
        ? "#A88479"
        : "#8F706B"
    );
  }

  plusLine(
    x,
    y - 125 * scale,
    x - 15 * scale,
    y - 175 * scale,
    5, s, "#FF7A49"
  );

  plusLine(
    x,
    y - 125 * scale,
    x + 22 * scale,
    y - 160 * scale,
    4, s, "#FFB35B"
  );

  for (let i = 0; i < 5; i++) {
    plusBlock(
      x + (i - 2) * 17 * scale,
      y - (180 + sin(worldTime * 2 + i) * 10) * scale,
      s * .8,
      i % 2 ? "#FFD16B" : "#FF835A"
    );
  }
}

function drawPlusCoral(x, y, scale) {
  const s = 12 * scale;

  plusLine(
    x, y,
    x, y - 83 * scale,
    7, s, "#FF9FB4"
  );

  plusLine(
    x, y - 40 * scale,
    x - 40 * scale,
    y - 82 * scale,
    5, s, "#F5A3D5"
  );

  plusLine(
    x, y - 48 * scale,
    x + 40 * scale,
    y - 98 * scale,
    5, s, "#FFA9AD"
  );
}

function drawPlusMushroom(x, y, scale) {
  const s = 13 * scale;

  plusLine(
    x, y,
    x, y - 50 * scale,
    4, s, "#F2E2BE"
  );

  plusRing(
    x,
    y - 58 * scale,
    32 * scale,
    15 * scale,
    9, s, "#D28BC9"
  );
}

function drawPlusMoonRock(x, y, scale) {
  const s = 15 * scale;

  plusRing(
    x, y,
    37 * scale,
    15 * scale,
    10, s, "#9499B6"
  );

  plusBlock(
    x,
    y,
    s * 1.6,
    "#BDC0D7"
  );
}

function drawPlusBuilding(x, y, scale) {
  const s = 13 * scale;

  for (let row = 0; row < 7; row++) {
    plusLine(
      x - 35 * scale,
      y - row * 16 * scale,
      x + 35 * scale,
      y - row * 16 * scale,
      6, s, "#A3AFCB"
    );
  }

  for (let row = 1; row < 6; row += 2) {
    for (let col = -1; col <= 1; col++) {
      plusBlock(
        x + col * 24 * scale,
        y - row * 16 * scale,
        s * .8,
        "#FFE2A2"
      );
    }
  }
}

function drawPlusCastle(x, y, scale) {
  const s = 13 * scale;

  for (let row = 0; row < 5; row++) {
    plusLine(
      x - 48 * scale,
      y - row * 18 * scale,
      x + 48 * scale,
      y - row * 18 * scale,
      7, s,
      row % 2 ? "#D4C1F1" : "#B9A4E1"
    );
  }

  for (const side of [-1, 1]) {
    plusLine(
      x + side * 45 * scale,
      y - 90 * scale,
      x + side * 45 * scale,
      y - 145 * scale,
      5, s, "#A18CCB"
    );
  }
}

function drawPlusCloud(x, y, scale) {
  plusRing(
    x, y,
    42 * scale,
    15 * scale,
    10,
    13 * scale,
    "#F8FBFF"
  );
}

function drawPlusSun(x, y, scale) {
  plusRing(
    x, y,
    24 * scale,
    24 * scale,
    10,
    14 * scale,
    "#FFD46B"
  );

  plusBlock(
    x, y,
    23 * scale,
    "#FFEA9A"
  );
}

/* =====================================
   05｜世界融合背景
===================================== */

function drawBackground() {
  if (worldZones.length === 0) {
    background("#DCECF6");

    noStroke();
    fill("#C5DCE9");

    ellipse(
      width / 2,
      height * .98,
      width * 1.4,
      height * .34
    );

    return;
  }

  const count = worldZones.length;

  noStroke();

  for (let y = 0; y < height; y += 6) {
    for (let x = 0; x < width; x += 12) {
      const pos = x / max(1, width);

      const zonePos = pos * count - .5;

      const leftIndex = constrain(
        floor(zonePos),
        0,
        count - 1
      );

      const rightIndex = constrain(
        leftIndex + 1,
        0,
        count - 1
      );

      const blend = constrain(
        zonePos - leftIndex,
        0,
        1
      );

      const a = WORLD_STYLES[
        worldZones[leftIndex].type
      ];

      const b = WORLD_STYLES[
        worldZones[rightIndex].type
      ];

      const skyColor = lerpColor(
        color(a.sky),
        color(b.sky),
        blend
      );

      const groundColor = lerpColor(
        color(a.ground),
        color(b.ground),
        blend
      );

      const vertical = constrain(
        (y / height - .55) / .45,
        0,
        1
      );

      fill(
        lerpColor(
          skyColor,
          groundColor,
          vertical * .65
        )
      );

      rectMode(CORNER);
      rect(x, y, 13, 7);
    }
  }

  rectMode(CENTER);
}

function getZoneLayout(index) {
  const count = max(1, worldZones.length);

  return {
    centerX: width * (index + .5) / count,
    zoneWidth: width / count,
    groundY: height * .87
  };
}

function drawWorldZones() {
  for (let i = 0; i < worldZones.length; i++) {
    const zone = worldZones[i];
    const layout = getZoneLayout(i);

    const reveal = constrain(
      (millis() - zone.createdAt) / 2500,
      0,
      1
    );

    const scale = constrain(
      layout.zoneWidth / 370,
      .32,
      1.15
    ) * reveal;

    if (scale <= 0) continue;

    const cx = layout.centerX;
    const y = layout.groundY;
    const w = layout.zoneWidth;
    const style = WORLD_STYLES[zone.type];

    push();
    noStroke();

    fill(style.ground);

    ellipse(
      cx,
      height * .98,
      w * 1.4,
      height * .28
    );

    switch (zone.type) {
      case "meadow":
        drawPlusTree(
          cx - w * .29, y, scale
        );

        drawPlusDogHouse(
          cx + w * .25, y, scale
        );

        drawPlusSun(
          cx + w * .25,
          height * .18,
          scale
        );

        for (let k = 0; k < 5; k++) {
          drawPlusFlower(
            cx - w * .35 + k * w * .17,
            y + 15,
            scale * .65
          );
        }
        break;

      case "volcano":
        drawPlusVolcano(
          cx, y + 25, scale
        );
        break;

      case "ocean":
        drawPlusCoral(
          cx - w * .25, y, scale
        );

        drawPlusCoral(
          cx + w * .25, y,
          scale * .8
        );

        for (let k = 0; k < 7; k++) {
          const rise =
            (worldTime * 16 + k * 28) %
            (height * .6);

          noFill();
          stroke(255, 255, 255, 150);
          strokeWeight(2);

          circle(
            cx + sin(k * 2.4) * w * .24,
            y - rise,
            8 + k * 2
          );
        }
        break;

      case "forest":
        drawPlusTree(
          cx - w * .25, y, scale
        );

        drawPlusTree(
          cx + w * .27, y,
          scale * .8
        );

        drawPlusMushroom(
          cx, y, scale
        );
        break;

      case "moon":
        drawPlusMoonRock(
          cx - w * .22, y, scale
        );

        drawPlusMoonRock(
          cx + w * .24, y,
          scale * .75
        );

        for (let k = 0; k < 7; k++) {
          plusBlock(
            cx - w * .35 + k * w * .11,
            height * .2 +
              sin(k * 3) * 45,
            9 * scale,
            "#FFF4C9"
          );
        }
        break;

      case "sky":
        drawPlusCloud(
          cx - w * .23,
          height * .25,
          scale
        );

        drawPlusCloud(
          cx + w * .23,
          height * .43,
          scale * .8
        );

        drawPlusSun(
          cx,
          height * .17,
          scale
        );
        break;

      case "city":
        drawPlusBuilding(
          cx - w * .22, y, scale
        );

        drawPlusBuilding(
          cx + w * .22, y,
          scale * .8
        );
        break;

      default:
        drawPlusCastle(
          cx, y, scale
        );

        drawPlusCloud(
          cx - w * .25,
          height * .2,
          scale
        );
        break;
    }

    pop();
  }
}

/* =====================================
   06｜氛圍粒子
===================================== */

function drawAmbientParticles() {
  noStroke();

  for (const p of particles) {
    p.y -= p.speed;

    if (p.y < -20) {
      p.y = height + 20;
      p.x = random(width);
    }

    fill(
      255, 255, 255,
      p.alpha
    );

    circle(
      p.x, p.y, p.r
    );
  }
}

/* =====================================
   07｜原始積木進入世界
===================================== */

window.addMindspaceCreation = function(dataURL) {
  return new Promise((resolve, reject) => {
    loadImage(
      dataURL,

      img => {
      // 判斷目前螢幕方向
// Mindspace｜橫式與 9:16 直式螢幕自適應
const isPortrait = height > width;

const maxSize = isPortrait
  ? min(
      width * 0.35,
      height * 0.24,
      320
    )
  : min(
      width * 0.486,
      height * 0.612,
      468
    );

        const scale = min(
          maxSize / img.width,
          maxSize / img.height
        );

        const w = img.width * scale;
        const h = img.height * scale;

        const item = {
          id: crypto.randomUUID(),
          img,

          x: random(
            w / 2 + 20,
            max(
              w / 2 + 21,
              width - w / 2 - 20
            )
          ),

          y: random(
            h / 2 + 40,
            max(
              h / 2 + 41,
              height - h / 2 - 40
            )
          ),

          baseY: 0,
          w,
          h,

          vx: random(-.6, .6),
          phase: random(TWO_PI),
          floatRange: random(5, 13),

          kind: "unclassified",
          name: "",
          identity: "",
          description: "",

          personality: "",
          movement: "float",
          speed: 1,
          energy: .5,
          interaction: "",
          abilities: [],

          worldType: null,
          worldZoneId: null,
          environmentData: null,

          rotation: random(-.04, .04),
          directionTimer: 0,

          childAction: null,
          visualEffects: [],
          originalPNG: dataURL
        };

        item.baseY = item.y;

        creations.push(item);

        window.selectMindspaceCreation(item.id);

        window.updateMindspaceCount?.(
          creations.length
        );

        resolve(item.id);
      },

      () => reject(
        new Error("無法載入去背積木 PNG")
      )
    );
  });
};

/* =====================================
   08｜套用 AI 分類
===================================== */

window.applyMindspaceClassification =
function(id, kind, description, aiData) {

  const item = creations.find(
    creation => creation.id === id
  );

  if (!item) return false;

  if (
    kind !== "character" &&
    kind !== "environment"
  ) {
    return false;
  }

  item.kind = kind;
  item.description = description || "";

  if (aiData) {
    item.name = String(
      aiData.name || ""
    );

    item.identity = String(
      aiData.identity ||
      aiData.name ||
      description ||
      ""
    );

    if (kind === "character") {
      applyCharacterData(
        item,
        aiData.character || {}
      );
    }

    if (kind === "environment") {
      applyEnvironmentData(
        item,
        aiData.environment || {}
      );
    }

    createOrUpdateWorld(
      item,
      aiData
    );

  } else {
    if (kind === "character") {
      applyCharacterData(item, {
        movement: "float",
        speed: 1,
        energy: .5
      });
    } else {
      applyEnvironmentData(item, {
        theme: "自由想像",
        palette: [
          "#B6DDF6",
          "#FFE6A5"
        ],
        elements: ["sparkle"],
        effect: "sparkle"
      });
    }
  }

  return true;
}

/* =====================================
   09｜AI 角色資料
===================================== */

function applyCharacterData(item, data) {
  item.personality = String(
    data.personality || "充滿好奇"
  );

  item.movement = MOVEMENTS.includes(
    data.movement
  )
    ? data.movement
    : "float";

  const speed = Number(data.speed);
  const energy = Number(data.energy);

  item.speed = Number.isFinite(speed)
    ? constrain(speed, .2, 3)
    : 1;

  item.energy = Number.isFinite(energy)
    ? constrain(energy, 0, 1)
    : .5;

  item.interaction = String(
    data.interaction || "自由探索"
  );

  item.abilities = Array.isArray(
    data.abilities
  )
    ? data.abilities.slice(0, 8)
    : [];

  item.vx =
    (random() < .5 ? -1 : 1) *
    (.3 + item.speed * .45);

  item.floatRange =
    5 + item.energy * 24;

  item.directionTimer = random(2, 5);

  if ([
    "run", "walk", "crawl", "bounce"
  ].includes(item.movement)) {
    item.baseY = min(
      height - item.h / 2 - 15,
      height * .87 - item.h / 2
    );

    item.y = item.baseY;
  }

  if ([
    "fly", "hover"
  ].includes(item.movement)) {
    item.baseY = constrain(
      height * .40,
      item.h / 2 + 20,
      height - item.h / 2 - 20
    );
  }
}

/* =====================================
   10｜角色待機與孩子動作
===================================== */

function updateCreation(item) {
  if (dragging === item) return;

  const idle =
    Math.sin(worldTime * 1.4 + item.phase) * 2;

  if (
    !item.childAction ||
    worldTime >= item.childAction.until
  ) {
    item.childAction = null;
    item.y = item.baseY + idle;
    return;
  }

  const action = item.childAction;
  const t = worldTime - action.started;
  const speed = Math.max(
    0.2,
    Number(action.speed) || 1
  );

  switch (action.type) {
    case "fly":
    case "hover":
      item.y =
        item.baseY -
        22 +
        Math.sin(t * 3 * speed) * 14;
      break;

    case "swim":
      item.x += Math.cos(t * 2) * speed;
      item.y =
        item.baseY +
        Math.sin(t * 3) * 13;
      break;

    case "jump":
    case "bounce":
      item.y =
        item.baseY -
        Math.abs(
          Math.sin(t * 4 * speed)
        ) * 42;
      break;

    case "walk":
    case "run":
      item.x +=
        action.direction *
        speed *
        (action.type === "run" ? 2 : .8);

      item.y =
        item.baseY -
        Math.abs(
          Math.sin(t * 8 * speed)
        ) * 5;
      break;

    default:
      item.y = item.baseY + idle;
  }

  item.x = constrain(
    item.x,
    item.w / 2,
    width - item.w / 2
  );

  item.y = constrain(
    item.y,
    item.h / 2,
    height - item.h / 2
  );
}

/* =====================================
   11｜繪製原始積木
===================================== */

function drawCreation(item) {
  push();

  translate(
    item.x,
    item.y
  );

  if (item.kind === "character") {
    const rotationAmount =
      item.movement === "swim"
        ? .12
        : item.movement === "run"
          ? .06
          : .045;

    rotate(
      sin(
        worldTime * 1.4 +
        item.phase
      ) * rotationAmount
    );
  }

  drawingContext.shadowColor =
    "rgba(0,0,0,.22)";

  drawingContext.shadowBlur = 16;
  drawingContext.shadowOffsetY = 8;

  image(
    item.img,
    0,
    0,
    item.w,
    item.h
  );

  pop();
}

/* =====================================
   12｜環境資料
===================================== */

function applyEnvironmentData(item, data) {
  const palette = Array.isArray(
    data.palette
  )
    ? data.palette.filter(
        value =>
          typeof value === "string" &&
          /^#[0-9a-fA-F]{6}$/.test(value)
      )
    : [];

  const elements = Array.isArray(
    data.elements
  )
    ? data.elements
    : [];

  const effects = [
    "sparkle",
    "rain",
    "bubbles",
    "glow",
    "wind"
  ];

  const effect = effects.includes(
    data.effect
  )
    ? data.effect
    : "sparkle";

  item.environmentData = {
    theme: String(
      data.theme || "想像世界"
    ),

    palette: palette.length
      ? palette
      : ["#A7DDF6", "#FFE5A6"],

    elements: elements.slice(0, 6),
    effect
  };

  const existing = environments.find(
    env => env.id === item.id
  );

  if (existing) {
    existing.data = item.environmentData;
  } else {
    environments.push({
      id: item.id,
      data: item.environmentData,
      seed: random(10000)
    });
  }
}

function drawEnvironmentLayers() {
  for (const env of environments) {
    const item = creations.find(
      creation => creation.id === env.id
    );

    if (!item) continue;

    const data = env.data;

    for (let i = 0; i < data.elements.length; i++) {
      drawEnvironmentElement(
        data.elements[i],
        i,
        item.x,
        item.y,
        data.palette
      );
    }
  }
}

function drawEnvironmentElement(
  type, index, centerX, centerY, palette
) {
  const x =
    centerX +
    sin(index * 2.5) * width * .12;

  const y =
    centerY -
    80 +
    cos(index * 1.7) * height * .12;

  const s = min(width, height) * .035;

  const c1 = palette[0] || "#A7DDF6";
  const c2 = palette[1] || "#FFE5A6";

  push();

  switch (type) {
    case "cloud":
      drawPlusCloud(x, y, .6);
      break;

    case "star":
    case "sparkle":
      plusBlock(x, y, s, c2);
      break;

    case "bubble":
      noFill();
      stroke(255, 255, 255, 140);
      strokeWeight(2);
      circle(x, y, s);
      break;

    case "plant":
      plusLine(
        x, y + s,
        x, y - s,
        4, s * .5, c1
      );
      break;

    case "rock":
      plusRing(
        x, y,
        s, s * .5,
        8, s * .5, c1
      );
      break;

    case "mountain":
      plusLine(
        x - s, y + s,
        x, y - s,
        5, s * .6, c1
      );

      plusLine(
        x, y - s,
        x + s, y + s,
        5, s * .6, c1
      );
      break;

    case "light":
      plusRing(
        x, y,
        s, s,
        8, s * .5, c2
      );
      break;
  }

  pop();
}

/* =====================================
   13｜三秒環境特效
===================================== */

function startEnvironmentEffect(type, x, y) {
  const effects = [
    "sparkle", "rain", "bubbles",
    "glow", "wind"
  ];

  const safeType = effects.includes(type)
    ? type
    : "sparkle";

  activeEffects.push({
    type: safeType,
    x,
    y,
    start: millis(),
    duration: 3000,

    particles: Array.from(
      { length: 48 },
      () => ({
        angle: random(TWO_PI),
        radius: random(15, 180),
        speed: random(.5, 2.2),
        size: random(3, 11),
        offset: random(1000)
      })
    )
  });
}

function drawEffects() {
  const now = millis();

  activeEffects = activeEffects.filter(
    effect =>
      now - effect.start <
      effect.duration
  );

  for (const effect of activeEffects) {
    const elapsed =
      now - effect.start;

    const progress =
      elapsed / effect.duration;

    const alpha =
      255 * (1 - progress);

    push();
    noStroke();

    for (const p of effect.particles) {
      let x = effect.x;
      let y = effect.y;

      switch (effect.type) {
        case "rain":
          x += cos(p.angle) * p.radius;

          y =
            (effect.y - 250 +
              elapsed * p.speed * .5 +
              p.offset) % height;

          stroke(200, 235, 255, alpha);
          strokeWeight(2);
          line(x, y, x - 3, y + 16);
          noStroke();
          break;

        case "bubbles":
          x += cos(p.angle) * p.radius;
          y -= progress * 220 * p.speed;

          noFill();
          stroke(255, 255, 255, alpha);
          strokeWeight(2);
          circle(x, y, p.size * 2);
          noStroke();
          break;

        case "glow":
          x += cos(p.angle) *
            p.radius * progress;

          y += sin(p.angle) *
            p.radius * progress;

          fill(255, 241, 155, alpha * .5);
          circle(x, y, p.size * 3);
          break;

        case "wind":
          x += progress * 300 * p.speed - 150;
          y += sin(p.angle) * p.radius;

          stroke(255, 255, 255, alpha);
          strokeWeight(2);
          line(x, y, x + 25, y);
          noStroke();
          break;

        default:
          x += cos(p.angle) *
            p.radius * progress;

          y += sin(p.angle) *
            p.radius * progress;

          fill(255, 245, 170, alpha);

          drawStar(
            x, y,
            p.size * .25,
            p.size,
            5
          );
          break;
      }
    }

    pop();
  }
}

function drawStar(x, y, r1, r2, points) {
  beginShape();

  for (let i = 0; i < points * 2; i++) {
    const a =
      -HALF_PI + i * PI / points;

    const r =
      i % 2 === 0
        ? r2
        : r1;

    vertex(
      x + cos(a) * r,
      y + sin(a) * r
    );
  }

  endShape(CLOSE);
}

/* =====================================
   14｜點選與拖曳作品
===================================== */

function mousePressed() {
  if (
    document.querySelector(
      ".modal:not(.hidden)"
    )
  ) return;

  const sidebar =
    document.getElementById("sidebar");

  if (
    sidebar &&
    sidebar.classList.contains("open")
  ) return;

  for (
    let i = creations.length - 1;
    i >= 0;
    i--
  ) {
    const item = creations[i];

    if (
      mouseX > item.x - item.w / 2 &&
      mouseX < item.x + item.w / 2 &&
      mouseY > item.y - item.h / 2 &&
      mouseY < item.y + item.h / 2
    ) {
      window.selectMindspaceCreation(item.id);

      dragging = item;

      dragDX = mouseX - item.x;
      dragDY = mouseY - item.y;

      return false;
    }
  }
}

function mouseDragged() {
  if (!dragging) return;

  dragging.x = mouseX - dragDX;
  dragging.baseY = mouseY - dragDY;
  dragging.y = dragging.baseY;

  return false;
}

function mouseReleased() {
  if (dragging) {
    dragging.baseY = dragging.y;
  }

  dragging = null;
}

/* =====================================
   15｜清空世界
===================================== */

window.clearMindspaceWorld = function() {
  selectedCreationId = null;
  window.mindspaceSelectedId = null;

  creations.length = 0;
  environments.length = 0;
  worldZones.length = 0;
  activeEffects.length = 0;

  window.updateMindspaceCount?.(0);
};

/* =====================================
   16｜視窗尺寸
===================================== */

function windowResized() {
  resizeCanvas(
    windowWidth,
    windowHeight
  );

  for (const item of creations) {
    item.x = constrain(
      item.x,
      item.w / 2,
      max(
        item.w / 2,
        width - item.w / 2
      )
    );

    item.baseY = constrain(
      item.baseY,
      item.h / 2,
      max(
        item.h / 2,
        height - item.h / 2
      )
    );
  }
}

/* =====================================
   17｜公開世界狀態
===================================== */

window.getMindspaceWorldState = function() {
  return {
    creations: creations.map(item => ({
      id: item.id,
      kind: item.kind,
      identity: item.identity,
      movement: item.movement,
      speed: item.speed,
      energy: item.energy,
      abilities: item.abilities,
      worldType: item.worldType
    })),

    worlds: worldZones.map(zone => ({
      id: zone.id,
      type: zone.type,
      elements: zone.elements
    }))
  };
};

/* =====================================
   18｜角色查找與選取
===================================== */

window.getMindspaceCreation = id =>
  creations.find(item => item.id === id) || null;

window.selectMindspaceCreation = function(id) {
  const item = window.getMindspaceCreation(id);

  if (!item) return false;

  selectedCreationId = id;
  window.mindspaceSelectedId = id;

  window.dispatchEvent(
    new CustomEvent("mindspace:selection", {
      detail: {
        id,
        kind: item.kind,
        name: item.name
      }
    })
  );

  return true;
};

window.getSelectedMindspaceCreation = function() {
  return window.getMindspaceCreation(
    selectedCreationId
  );
};

function drawSelectionIndicator() {
  const item =
    window.getSelectedMindspaceCreation();

  if (!item) return;

  push();

  noFill();
  stroke(255, 208, 92, 190);
  strokeWeight(2);

  ellipse(
    item.x,
    item.y,
    item.w + 24,
    item.h + 24
  );

  pop();
}

/* =====================================
   19｜孩子動作指令
===================================== */

window.performMindspaceAction = function(command) {
  if (
    !command ||
    typeof command !== "object"
  ) {
    return false;
  }

  const item = window.getMindspaceCreation(
    command.targetId || selectedCreationId
  );

  if (
    !item ||
    item.kind !== "character"
  ) {
    return false;
  }

  const allowed = [
    "fly",
    "hover",
    "swim",
    "jump",
    "bounce",
    "walk",
    "run",
    "stop"
  ];

  if (!allowed.includes(command.type)) {
    return false;
  }

  if (command.type === "stop") {
    item.childAction = null;
    item.y = item.baseY;
    return true;
  }

  const duration = constrain(
    Number(command.duration) || 4,
    0.5,
    30
  );

  item.childAction = {
    type: command.type,
    started: worldTime,
    until: worldTime + duration,

    speed: constrain(
      Number(command.speed) || 1,
      0.2,
      3
    ),

    direction:
      command.direction === "left"
        ? -1
        : 1
  };

  return true;
};

/* ==========================================================
   Mindspace Plus-Plus
   第四階段第二步｜自主移動 + AI 指令執行模組

   保留：
   - 原始積木 PNG
   - AI 分類
   - 黃色選取圓圈
   - 拖曳
   - 多角色共存
   - 世界融合
   - 環境特效

   新增：
   - 角色持續自主移動
   - AI operations 執行入口
   - 外觀附加特徵
   - 能力視覺效果
   - 角色變身
   - AI 環境變化
   - 簡易配角
   - 故事與互動資料

   注意：
   本模組不呼叫 OpenAI。
   真實 AI 請求由 index.html / GAS 負責。
========================================================== */

(function installMindspaceAIExecutor() {
  "use strict";

  const VALID_MOVEMENTS = new Set([
    "float", "swim", "walk", "fly",
    "bounce", "run", "crawl", "hover"
  ]);

  const VALID_OPERATIONS = new Set([
    "appearance", "ability", "movement",
    "environment", "companion", "interaction",
    "story", "transform"
  ]);

  const extraEnvironments = [];
  const companionCharacters = [];
  const worldStories = [];

  const safeNumber = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n)
      ? Math.max(min, Math.min(max, n))
      : fallback;
  };

  const safeText = (value, fallback = "", limit = 300) =>
    String(value == null ? fallback : value).slice(0, limit);

  function getTarget(operation) {
    const id =
      operation.targetId ||
      window.mindspaceSelectedId;

    return creations.find(item => item.id === id) || null;
  }

  function prepareItem(item) {
    if (!item.aiVisuals) {
      item.aiVisuals = {
        features: [],
        abilities: [],
        identity: "",
        tint: null
      };
    }

    if (!Number.isFinite(item.aiDirection)) {
      item.aiDirection = item.vx < 0 ? -1 : 1;
    }

    if (!Number.isFinite(item.aiTurnAt)) {
      item.aiTurnAt = worldTime + random(2, 6);
    }

    if (!Number.isFinite(item.aiVerticalDirection)) {
      item.aiVerticalDirection = random() < .5 ? -1 : 1;
    }

    return item;
  }

  /* -------------------------------------------------------
     A｜真正自主移動

     不再因為沒有 childAction 就停止位移。
     原本的 childAction 仍可暫時改變動作。
  ------------------------------------------------------- */

  updateCreation = function(item) {
    if (dragging === item) return;

    prepareItem(item);

    if (item.kind === "environment") {
      item.y = item.baseY +
        Math.sin(worldTime * .8 + item.phase) * 1.5;
      return;
    }

    const movement = VALID_MOVEMENTS.has(item.movement)
      ? item.movement
      : "float";

    const speed = safeNumber(item.speed, 1, .2, 3);
    const energy = safeNumber(item.energy, .5, 0, 1);

    const dt = Math.min(deltaTime || 16.67, 50) / 16.67;

    if (worldTime >= item.aiTurnAt) {
      if (random() < .55) {
        item.aiDirection *= -1;
      }

      if (random() < .35) {
        item.aiVerticalDirection *= -1;
      }

      item.aiTurnAt = worldTime + random(2, 6);
    }

    let horizontal = 0;
    let vertical = 0;

    switch (movement) {
      case "swim":
        horizontal = .65;
        vertical =
          Math.sin(worldTime * 1.9 + item.phase) * .55;
        break;

      case "fly":
        horizontal = .85;
        vertical =
          Math.sin(worldTime * 1.3 + item.phase) * .65;
        break;

      case "hover":
        horizontal = .35;
        vertical =
          Math.sin(worldTime * 1.8 + item.phase) * .42;
        break;

      case "walk":
        horizontal = .45;
        break;

      case "run":
        horizontal = 1.25;
        break;

      case "crawl":
        horizontal = .22;
        break;

      case "bounce":
        horizontal = .65;
        break;

      default:
        horizontal = .38;
        vertical =
          Math.sin(worldTime * 1.2 + item.phase) * .30;
    }

    const action =
      item.childAction &&
      worldTime < item.childAction.until
        ? item.childAction
        : null;

    if (!action) {
      item.childAction = null;
    }

    if (action) {
      const actionSpeed = safeNumber(
        action.speed, 1, .2, 3
      );

      switch (action.type) {
        case "fly":
        case "hover":
          horizontal = .9 * actionSpeed;
          vertical = -.5;
          break;

        case "swim":
          horizontal = .8 * actionSpeed;
          vertical =
            Math.sin(worldTime * 3) * .7;
          break;

        case "run":
          horizontal = 1.4 * actionSpeed;
          break;

        case "walk":
          horizontal = .5 * actionSpeed;
          break;

        case "jump":
        case "bounce":
          horizontal = .5 * actionSpeed;
          break;
      }

      if (action.direction === -1) {
        item.aiDirection = -1;
      } else if (action.direction === 1) {
        item.aiDirection = 1;
      }
    }

    const velocity = speed * (.55 + energy * .7);

    item.x += horizontal *
      item.aiDirection * velocity * dt;

    const minX = item.w / 2 + 12;
    const maxX = Math.max(
      minX,
      width - item.w / 2 - 12
    );

    if (item.x <= minX) {
      item.x = minX;
      item.aiDirection = 1;
    }

    if (item.x >= maxX) {
      item.x = maxX;
      item.aiDirection = -1;
    }

    const groundY = Math.max(
      item.h / 2 + 12,
      Math.min(
        height - item.h / 2 - 12,
        height * .87 - item.h / 2
      )
    );

    if ([
      "walk", "run", "crawl", "bounce"
    ].includes(movement)) {
      item.baseY +=
        (groundY - item.baseY) * .045 * dt;

      if (movement === "bounce" ||
          action?.type === "jump" ||
          action?.type === "bounce") {
        item.y = item.baseY -
          Math.abs(
            Math.sin(worldTime * 3.2 * velocity)
          ) * (15 + energy * 32);
      } else {
        item.y = item.baseY -
          Math.abs(
            Math.sin(worldTime * 6 * velocity)
          ) * (movement === "run" ? 6 : 3);
      }
    } else {
      item.baseY += vertical *
        item.aiVerticalDirection * velocity * dt;

      const minY = item.h / 2 + 20;
      const maxY = Math.max(
        minY,
        height - item.h / 2 - 35
      );

      if (item.baseY < minY) {
        item.baseY = minY;
        item.aiVerticalDirection = 1;
      }

      if (item.baseY > maxY) {
        item.baseY = maxY;
        item.aiVerticalDirection = -1;
      }

      item.y = item.baseY +
        Math.sin(worldTime * 2 + item.phase) *
        (4 + energy * 9);
    }
  };

  /* -------------------------------------------------------
     B｜外觀附加繪製

     不修改 item.img 或 originalPNG。
     只在角色圖片周圍增加繪製圖層。
  ------------------------------------------------------- */

  function featureColor(value, index = 0) {
    const name = safeText(value).toLowerCase();

    if (name.includes("rainbow") ||
        name.includes("彩虹")) {
      return [
        "#FF6B78", "#FFB347", "#FFE66D",
        "#65D98B", "#69C8FF", "#B58BFF"
      ][index % 6];
    }

    if (name.includes("blue") || name.includes("藍")) {
      return "#67B9FF";
    }

    if (name.includes("red") || name.includes("紅")) {
      return "#FF7382";
    }

    if (name.includes("purple") || name.includes("紫")) {
      return "#B58BFF";
    }

    if (name.includes("green") || name.includes("綠")) {
      return "#7DDB9B";
    }

    if (name.includes("yellow") || name.includes("黃")) {
      return "#FFE17A";
    }

    if (/^#[0-9a-f]{6}$/i.test(name)) {
      return name;
    }

    return "#A7D8FF";
  }

function drawPlusBlueprintFeature(feature, item) {
  const bp = feature.plusBlueprint;

  if (
    !bp ||
    !Array.isArray(bp.grid) ||
    !Array.isArray(bp.palette)
  ) {
    return;
  }

  const alphabet = "ABCDEFGH";
  const rows = bp.grid.length;
  const cols = Math.max(
    1,
    ...bp.grid.map(row => String(row).length)
  );

  if (!rows) return;

  const count = Math.round(
    safeNumber(feature.count, 1, 1, 30)
  );

  const name = safeText(
    feature.feature || feature.description
  ).toLowerCase();

  const cell = Math.max(
    2,
    Math.min(
      item.w * 0.32 / cols,
      item.h * 0.35 / rows
    )
  );

  const motion = String(bp.motion || "none");
  const bpScale = safeNumber(
    bp.scale, 1, 0.4, 2.5
  );

  function drawGrid() {
    for (let y = 0; y < rows; y++) {
      const row = String(bp.grid[y]).toUpperCase();

      for (let x = 0; x < row.length; x++) {
        const index = alphabet.indexOf(row[x]);

        if (
          index < 0 ||
          index >= bp.palette.length
        ) continue;

        const color = bp.palette[index];

        if (!/^#[0-9a-f]{6}$/i.test(color)) {
          continue;
        }

        plusBlock(
          (x - cols / 2 + 0.5) * cell,
          (y - rows / 2 + 0.5) * cell,
          cell * 0.94,
          color
        );
      }
    }
  }

  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const layer = Math.floor(i / 2);

    let x = 0;
    let y = 0;
    let angle = 0;

    if (/wing|翅膀|翅/.test(name)) {
      x = side * item.w * 0.46;
      y = -item.h * 0.12 +
        layer * item.h * 0.10;
      angle = side * 0.15;

    } else if (/horn|角/.test(name)) {
      x = (
        i - (count - 1) / 2
      ) * Math.min(
        22, item.w / (count + 1)
      );
      y = -item.h * 0.52;

    } else if (/tail|尾巴/.test(name)) {
      x = item.w * 0.46;
      y = item.h * 0.10 + i * 6;

    } else if (/tentacle|觸手/.test(name)) {
      x = (
        i - (count - 1) / 2
      ) * Math.min(
        16, item.w / (count + 1)
      );
      y = item.h * 0.48;

    } else {
      const a = TWO_PI * i / count;
      x = Math.cos(a) * item.w * 0.46;
      y = Math.sin(a) * item.h * 0.46;
      angle = a;
    }

    const phase = worldTime * 5 + i * 0.5;

    if (motion === "flap") {
      angle += side * Math.sin(phase) * 0.25;
    } else if (
      motion === "wave" ||
      motion === "swing"
    ) {
      angle += Math.sin(phase) * 0.18;
    } else if (motion === "rotate") {
      angle += worldTime;
    } else if (motion === "bounce") {
      y -= Math.abs(Math.sin(phase)) * 8;
    }

    const pulse =
      motion === "pulse"
        ? 1 + Math.sin(phase) * 0.08
        : 1;

    push();

    translate(x, y);
    rotate(angle);

    if (
      /wing|翅膀|翅/.test(name) &&
      side === 1
    ) {
      scale(-1, 1);
    }

    scale(bpScale * pulse);

    drawGrid();

    pop();
  }
}

  function drawFeature(feature, item) {
    
const featureName = String(
  feature.feature || feature.description || ""
).toLowerCase();

// 翅膀完全交給 OpenAI PNG 渲染。
// 不再畫 p5.js 橢圓，也不畫 Plus-Plus Blueprint。
if (/wing|wings|翅膀|翅|羽翼|機翼/.test(featureName)) {
  return;
}

    if (
  feature.plusBlueprint &&
  feature.plusBlueprint.success === true
) {
  drawPlusBlueprintFeature(feature, item);
  return;
}
    const name = safeText(
      feature.feature || feature.description
    ).toLowerCase();

    const count = Math.round(
      safeNumber(feature.count, 2, 1, 30)
    );

    const c = feature.color || feature.description;

    push();
    noStroke();

    if (/wing|翅膀|翅/.test(name)) {
      for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const layer = Math.floor(i / 2);
        const flap =
          Math.sin(worldTime * 7 + layer) * .18;

        push();

        translate(
          side * item.w * .34,
          -item.h * .10 + layer * 9
        );

        rotate(side * (flap + .15));

        fill(featureColor(c, i));

        ellipse(
          side * (item.w * .18 + layer * 3),
          -item.h * .11,
          item.w * .40,
          item.h * .28
        );

        pop();
      }
    } else if (/horn|角/.test(name)) {
      for (let i = 0; i < count; i++) {
        const x =
          (i - (count - 1) / 2) *
          Math.min(22, item.w / (count + 1));

        fill(featureColor(c, i));

        triangle(
          x - 9, -item.h * .40,
          x + 9, -item.h * .40,
          x, -item.h * .63
        );
      }
    } else if (/tentacle|觸手/.test(name)) {
      for (let i = 0; i < count; i++) {
        const x =
          (i - (count - 1) / 2) *
          Math.min(15, item.w / (count + 1));

        noFill();
        stroke(featureColor(c, i));
        strokeWeight(5);

        bezier(
          x, item.h * .34,
          x - 10, item.h * .50,
          x + 12, item.h * .62,
          x + Math.sin(worldTime * 3 + i) * 10,
          item.h * .78
        );
      }
    } else if (/tail|尾巴/.test(name)) {
      fill(featureColor(c));

      triangle(
        item.w * .37, 0,
        item.w * .70, -item.h * .18,
        item.w * .70, item.h * .18
      );
    } else if (/eye|眼睛/.test(name)) {
      for (let i = 0; i < count; i++) {
        const x =
          (i - (count - 1) / 2) *
          Math.min(20, item.w / (count + 1));

        fill(255);
        circle(x, -item.h * .18, 18);

        fill(featureColor(c, i));
        circle(x, -item.h * .18, 9);
      }
    } else {
      // 尚未有專屬幾何畫法的特徵：
      // 以彩色 Plus-Plus 積木裝飾呈現，
      // 並保留原始描述供後續精細化。
      const visibleCount = Math.min(count, 12);

      for (let i = 0; i < visibleCount; i++) {
        const a = TWO_PI * i / visibleCount;

        plusBlock(
          Math.cos(a) * item.w * .58,
          Math.sin(a) * item.h * .58,
          12,
          featureColor(c, i),
          a
        );
      }
    }

    pop();
  }

  /* -------------------------------------------------------
     C｜角色能力效果
  ------------------------------------------------------- */

  function drawAbility(ability, item) {
    const name = safeText(
      ability.ability || ability.description
    ).toLowerCase();

    const c = featureColor(
      ability.color || ability.description
    );

    const t = worldTime;

    push();

    if (/laser|雷射|光束/.test(name)) {
      const pulse =
        .5 + .5 * Math.sin(t * 9);

      stroke(c);
      strokeWeight(2 + pulse * 5);

      const startX = item.w * .22;
      const startY = -item.h * .15;

      line(
        startX, startY,
        startX + item.w * 1.2, startY
      );

      stroke(255, 255, 255, 190);
      strokeWeight(2);

      line(
        startX, startY,
        startX + item.w * 1.2, startY
      );
    } else if (/fire|火焰|噴火/.test(name)) {
      noStroke();

      for (let i = 0; i < 9; i++) {
        const x =
          item.w * .3 + i * 12;

        const y =
          Math.sin(t * 8 + i) * 11;

        fill(i % 2 ? "#FFB347" : "#FF6B48");

        ellipse(
          x, y,
          18 + Math.sin(t * 7 + i) * 5,
          14
        );
      }
    } else if (/lightning|閃電|電擊/.test(name)) {
      stroke(c);
      strokeWeight(4);
      noFill();

      beginShape();

      for (let i = 0; i < 8; i++) {
        vertex(
          item.w * .3 + i * 16,
          Math.sin(i * 3 + t * 12) * 17
        );
      }

      endShape();
    } else if (/bubble|泡泡/.test(name)) {
      noFill();
      stroke(c);
      strokeWeight(2);

      for (let i = 0; i < 9; i++) {
        const a = t + i * 1.7;

        circle(
          Math.cos(a) * item.w * .65,
          Math.sin(a) * item.h * .7,
          8 + i % 4 * 5
        );
      }
    } else {
      // 未分類能力：呈現能量光暈，
      // 不宣稱已精準畫出孩子描述的能力。
      noFill();
      stroke(c);
      strokeWeight(2);

      circle(
        0, 0,
        Math.max(item.w, item.h) *
        (1.25 + Math.sin(t * 3) * .08)
      );
    }

    pop();
  }

  const previousDrawCreation = drawCreation;

  drawCreation = function(item) {
    prepareItem(item);

    push();

    translate(item.x, item.y);

    for (const feature of item.aiVisuals.features) {
      drawFeature(feature, item);
    }

    pop();

    // 原本的 PNG 繪製函式完全保留。
    previousDrawCreation(item);

    push();

    translate(item.x, item.y);

    for (const ability of item.aiVisuals.abilities) {
      drawAbility(ability, item);
    }

    pop();
  };

  /* -------------------------------------------------------
     D｜AI 指令執行
  ------------------------------------------------------- */

  function applyOperation(operation) {
    if (!operation ||
        typeof operation !== "object" ||
        !VALID_OPERATIONS.has(operation.type)) {
      return false;
    }

    const item = getTarget(operation);

    switch (operation.type) {
     
case "appearance": {
  if (!item) return false;

  prepareItem(item);

  const bp = operation.plusBlueprint;

  const validBlueprint = Boolean(
    bp &&
    bp.success === true &&
    Array.isArray(bp.grid) &&
    bp.grid.length > 0 &&
    Array.isArray(bp.palette) &&
    bp.palette.length > 0
  );

  item.aiVisuals.features.push({
    feature: safeText(operation.feature),
    description: safeText(operation.description),
    count: safeNumber(
      operation.count, 2, 1, 30
    ),
    color: safeText(operation.color),
    placement: safeText(operation.placement),

    // 真正保留 OpenAI 產生的積木網格。
    plusBlueprint: validBlueprint
      ? bp
      : null
  });

  item.aiVisuals.features =
    item.aiVisuals.features.slice(-20);

  return true;
}

      case "ability": {
        if (!item) return false;

        prepareItem(item);

        const ability = {
          ability: safeText(operation.ability),
          description: safeText(operation.description),
          color: safeText(operation.color),
          origin: safeText(operation.origin),
          trigger: safeText(
            operation.trigger,
            "autonomous"
          )
        };

        item.aiVisuals.abilities.push(ability);

        item.aiVisuals.abilities =
          item.aiVisuals.abilities.slice(-12);

        if (!Array.isArray(item.abilities)) {
          item.abilities = [];
        }

        item.abilities.push(
          ability.description || ability.ability
        );

        return true;
      }

      case "movement": {
        if (!item || item.kind !== "character") {
          return false;
        }

        if (VALID_MOVEMENTS.has(operation.movement)) {
          item.movement = operation.movement;
        }

        item.speed = safeNumber(
          operation.speed,
          item.speed || 1,
          .2, 3
        );

        item.energy = safeNumber(
          operation.energy,
          item.energy || .5,
          0, 1
        );

        // 保留自主移動，不設永久 childAction。
        item.childAction = null;

        return true;
      }

      case "transform": {
        if (!item) return false;

        prepareItem(item);

        if (operation.identity) {
          item.identity = safeText(operation.identity);
          item.aiVisuals.identity = item.identity;
        }

        if (operation.appearance) {
          item.aiVisuals.features.push({
            feature: safeText(operation.appearance),
            description: safeText(operation.appearance),
            count: 1,
            color: "",
            placement: ""
          });
        }

        if (VALID_MOVEMENTS.has(operation.movement)) {
          item.movement = operation.movement;
        }

        if (Array.isArray(operation.abilities)) {
          for (const ability of operation.abilities.slice(0, 8)) {
            applyOperation({
              type: "ability",
              targetId: item.id,
              ability: safeText(ability),
              description: safeText(ability)
            });
          }
        }

        return true;
      }

      case "environment": {
        const worldType =
          WORLD_STYLES[operation.worldType]
            ? operation.worldType
            : "fantasy";

        extraEnvironments.push({
          id: "ai-env-" + Date.now() + "-" +
            Math.floor(Math.random() * 100000),
          type: worldType,
          description: safeText(operation.description),
          elements: Array.isArray(operation.elements)
            ? operation.elements.slice(0, 10)
            : [],
          createdAt: millis()
        });

        if (item) {
          createOrUpdateWorld(item, {
            environment: {
              worldType,
              sceneElements:
                Array.isArray(operation.elements)
                  ? operation.elements.slice(0, 8)
                  : [],
              effect: operation.effect || "sparkle"
            }
          });
        } else {
          worldZones.push({
            id: extraEnvironments[
              extraEnvironments.length - 1
            ].id,
            type: worldType,
            elements: Array.isArray(operation.elements)
              ? operation.elements.slice(0, 8)
              : [],
            createdAt: millis(),
            seed: random(10000)
          });

          startEnvironmentEffect(
            operation.effect || "sparkle",
            width / 2,
            height / 2
          );
        }

        return true;
      }

      case "companion": {
        const companion = {
          id: "companion-" + Date.now() + "-" +
            Math.floor(Math.random() * 100000),
          targetId: item ? item.id : null,
          name: safeText(
            operation.name, "想像配角"
          ),
          description: safeText(operation.description),
          appearance: safeText(operation.appearance),
          personality: safeText(operation.personality),
          movement: VALID_MOVEMENTS.has(operation.movement)
            ? operation.movement
            : "float",
          x: item ? item.x + 110 : width / 2,
          y: item ? item.y - 60 : height / 2,
          phase: random(TWO_PI),
          color: featureColor(
            operation.appearance ||
            operation.description
          )
        };

        companionCharacters.push(companion);

        return true;
      }

      case "interaction": {
        if (!item) return false;

        item.interaction = safeText(
          operation.interaction ||
          operation.description
        );

        return true;
      }

      case "story": {
        worldStories.push({
          text: safeText(
            operation.story ||
            operation.description,
            "",
            1000
          ),
          createdAt: Date.now()
        });

        return true;
      }
    }

    return false;
  }

  window.applyMindspaceAIOperations = function(operations) {
    if (!Array.isArray(operations)) {
      return {
        success: false,
        applied: 0,
        failed: 0,
        error: "operations 必須是陣列"
      };
    }

    let applied = 0;
    let failed = 0;

    for (const operation of operations.slice(0, 30)) {
      try {
        if (applyOperation(operation)) {
          applied++;
        } else {
          failed++;
        }
      } catch (error) {
        console.error(
          "[Mindspace] AI operation error:",
          error
        );
        failed++;
      }
    }

    const result = {
      success: failed === 0,
      applied,
      failed
    };

    window.dispatchEvent(
      new CustomEvent("mindspace:ai-applied", {
        detail: result
      })
    );

    return result;
  };

  /* -------------------------------------------------------
     E｜簡易配角自主移動與繪製

     這是可運作的初版積木配角，
     不是最終的 AI 精細造型生成器。
  ------------------------------------------------------- */

  function drawCompanions() {
    for (const companion of companionCharacters) {
      const speed =
        companion.movement === "run" ? 1.8 :
        companion.movement === "fly" ? 1.2 : .65;

      companion.x +=
        Math.sin(worldTime * .8 + companion.phase) *
        speed;

      companion.y +=
        Math.sin(worldTime * 1.3 + companion.phase) *
        .35;

      companion.x = constrain(
        companion.x, 35, width - 35
      );

      companion.y = constrain(
        companion.y, 35, height - 35
      );

      push();

      translate(companion.x, companion.y);

      // 使用 Plus-Plus 積木組合成簡易配角。
      plusBlock(0, 0, 34, companion.color);

      plusBlock(
        -20, -15, 20,
        companion.color, -.3
      );

      plusBlock(
        20, -15, 20,
        companion.color, .3
      );

      plusBlock(
        -15, 24, 17,
        companion.color
      );

      plusBlock(
        15, 24, 17,
        companion.color
      );

      noStroke();
      fill(255);

      circle(-9, -7, 12);
      circle(9, -7, 12);

      fill("#26374D");

      circle(-9, -7, 5);
      circle(9, -7, 5);

      pop();
    }
  }

  /* -------------------------------------------------------
     F｜把配角加入原本的 draw() 流程
  ------------------------------------------------------- */

  const previousDraw = draw;

  draw = function() {
    previousDraw();
    drawCompanions();
  };

  /* -------------------------------------------------------
     G｜清空世界時同步清除新增資料

     不改變原本清空按鈕的行為。
  ------------------------------------------------------- */

  const previousClearWorld = window.clearMindspaceWorld;

  window.clearMindspaceWorld = function() {
    previousClearWorld();

    extraEnvironments.length = 0;
    companionCharacters.length = 0;
    worldStories.length = 0;
  };

  /* -------------------------------------------------------
     H｜公開狀態

     供之後文字輸入、語音輸入與 OpenAI 使用。
  ------------------------------------------------------- */

  const previousGetWorldState =
    window.getMindspaceWorldState;

  window.getMindspaceWorldState = function() {
    const state = previousGetWorldState();

    state.selectedCreationId =
      window.mindspaceSelectedId || null;

    state.creations = state.creations.map(data => {
      const item = creations.find(
        creation => creation.id === data.id
      );

      return {
        ...data,
        name: item?.name || "",
        personality: item?.personality || "",
        interaction: item?.interaction || "",
        visualFeatures:
          item?.aiVisuals?.features || []
      };
    });

    state.companions = companionCharacters.map(
      companion => ({
        id: companion.id,
        name: companion.name,
        appearance: companion.appearance,
        movement: companion.movement
      })
    );

    state.stories = worldStories.slice(-10);

    return state;
  };

  /* -------------------------------------------------------
     I｜測試入口

     可以直接在瀏覽器 Console 執行：
     testMindspaceAIExecutor()
  ------------------------------------------------------- */

  window.testMindspaceAIExecutor = function() {
    const selected =
      window.getSelectedMindspaceCreation?.();

    if (!selected) {
      console.warn(
        "[Mindspace] 請先選取一個角色"
      );

      return {
        success: false,
        error: "請先選取角色"
      };
    }

    return window.applyMindspaceAIOperations([
      {
        type: "appearance",
        targetId: selected.id,
        feature: "wings",
        count: 8,
        color: "rainbow",
        description: "長出八隻彩虹翅膀"
      },
      {
        type: "movement",
        targetId: selected.id,
        movement: "fly",
        speed: 1.5,
        energy: .8
      },
      {
        type: "ability",
        targetId: selected.id,
        ability: "laser",
        color: "blue",
        origin: "eyes",
        description: "發射藍色雷射光"
      }
    ]);
  };

/* =========================================================
   Mindspace Plus-Plus
   黃色選取圓圈｜短暫顯示控制模組

   功能：
   1. 選取角色時顯示黃色大圓圈
   2. 3 秒沒有操作，自動隱藏
   3. 文字／語音指令進行中保持顯示
   4. AI 指令完成後立即隱藏
   5. 圓圈隱藏不取消角色選取
   6. 不修改原始 PNG、角色移動與 AI 資料
========================================================= */

(function () {
  "use strict";

  const SELECTION_DURATION = 3000;

  let visibleUntil = 0;
  let commandActive = false;

  function showSelection() {
    visibleUntil =
      performance.now() + SELECTION_DURATION;
  }

  function hideSelection() {
    visibleUntil = 0;
    commandActive = false;
  }

  function isSelectionVisible() {
    return (
      commandActive ||
      performance.now() < visibleUntil
    );
  }

  // 保留原本的角色選取功能
  const originalSelect =
    window.selectMindspaceCreation;

  window.selectMindspaceCreation = function (id) {
    const success = originalSelect(id);

    if (success) {
      commandActive = false;
      showSelection();
    }

    return success;
  };

  // 保留原本的黃色圓圈樣式，
  // 只改變它何時顯示
  const originalDrawSelection =
    drawSelectionIndicator;

  drawSelectionIndicator = function () {
    if (!isSelectionVisible()) {
      return;
    }

    originalDrawSelection();
  };

  // 文字或語音指令開始
  window.startMindspaceCommand = function () {
    const selected =
      window.getSelectedMindspaceCreation?.();

    if (!selected) {
      return false;
    }

    commandActive = true;
    showSelection();

    return true;
  };

  // 指令完成、取消或失敗
  window.finishMindspaceCommand = function () {
    hideSelection();
  };

  // AI operations 套用完成後隱藏
  const originalApplyOperations =
    window.applyMindspaceAIOperations;

  if (
    typeof originalApplyOperations === "function"
  ) {
    window.applyMindspaceAIOperations =
      function (operations) {
        try {
          return originalApplyOperations(
            operations
          );
        } finally {
          hideSelection();
        }
      };
  }

  // 初次 AI 分類完成後也隱藏圓圈
  const originalClassification =
    window.applyMindspaceClassification;

  if (
    typeof originalClassification === "function"
  ) {
    window.applyMindspaceClassification =
      function (...args) {
        try {
          return originalClassification(
            ...args
          );
        } finally {
          hideSelection();
        }
      };
  }

  // 清空世界時重設選取提示
  const originalClear =
    window.clearMindspaceWorld;

  window.clearMindspaceWorld = function () {
    hideSelection();

    return originalClear();
  };

  // 方便在 Console 檢查
  window.getMindspaceSelectionDisplay = function () {
    return {
      selectedId:
        window.mindspaceSelectedId,
      visible: isSelectionVisible(),
      commandActive: commandActive
    };
  };

  // 網頁首次載入時不顯示黃色圓圈
  hideSelection();

  console.log(
    "[Mindspace] 黃色選取圓圈控制模組已載入"
  );
})();

  console.log(
    "[Mindspace] 自主移動與 AI 指令執行模組已載入"
  );
})();

/* =====================================================
   MINDSPACE AI FULL-SCREEN BACKGROUND
   保留原本的世界、角色與互動系統
===================================================== */

(function () {
  "use strict";

const state = {
  image: null,
  dataUrl: "",
  description: "",
  loading: false,
  generation: 0,
  enabled: false,
  error: null
};
  // 保存原本的背景繪製函式
  const originalDrawBackground = drawBackground;

  // 保存原本的世界區域繪製函式
  const originalDrawWorldZones = drawWorldZones;

  /*
   * 將圖片以 cover 模式填滿整個畫布。
   * 保留原始比例，超出的部分裁切。
   */
  function drawCover(img) {
    if (!img || !img.width || !img.height) {
      return false;
    }

    const scale = Math.max(
      width / img.width,
      height / img.height
    );

    const w = img.width * scale;
    const h = img.height * scale;

    push();

    imageMode(CENTER);

    image(
      img,
      width / 2,
      height / 2,
      w,
      h
    );

    pop();

    return true;
  }

  /*
   * 取代背景層，不改動原本 draw()。
   */
  drawBackground = function () {
    if (state.enabled && state.image) {
      if (drawCover(state.image)) {
        return;
      }
    }

    // 尚未有 AI 背景時使用原本世界
    originalDrawBackground();
  };

  /*
   * AI 背景已經包含場景時，
   * 不重複繪製舊的固定世界區域。
   *
   * 原本的實體環境、角色及特效
   * 仍由 draw() 後續流程繪製。
   */
  drawWorldZones = function () {
    if (state.enabled && state.image) {
      return;
    }

    originalDrawWorldZones();
  };

  /*
   * 從 OpenAI 回傳的 data URL 載入圖片。
   *
   * 只有圖片成功解碼後才切換背景，
   * 避免生成中畫面變空白。
   */
  window.setMindspaceAIBackground =
    function (imageData, description = "") {
      return new Promise((resolve, reject) => {

        if (
          typeof imageData !== "string" ||
          !imageData.startsWith("data:image/")
        ) {
          reject(
            new Error("AI 背景不是有效的圖片資料")
          );
          return;
        }

        const generation = ++state.generation;

        state.loading = true;
        state.error = null;

        loadImage(
          imageData,

          img => {
            // 較舊的請求不能覆蓋新背景
            if (generation !== state.generation) {
              resolve({
                success: false,
                superseded: true
              });
              return;
            }

        state.image = img;
state.dataUrl = imageData;
state.description =
  String(description || "");

            state.enabled = true;
            state.loading = false;

            console.log(
              "[Mindspace] AI 背景載入成功",
              img.width,
              img.height
            );

            resolve({
              success: true,
              width: img.width,
              height: img.height,
              description: state.description
            });
          },

          error => {
            if (generation === state.generation) {
              state.loading = false;
              state.error =
                "AI 背景圖片解碼失敗";
            }

            reject(
              new Error(
                "AI 背景圖片載入失敗：" +
                String(error || "")
              )
            );
          }
        );
      });
    };

  /*
   * 關閉 AI 背景時恢復原本世界。
   * 不刪除任何積木角色。
   */
  window.disableMindspaceAIBackground =
    function () {
      state.enabled = false;
    };

  window.enableMindspaceAIBackground =
    function () {
      if (state.image) {
        state.enabled = true;
        return true;
      }

      return false;
    };

  /*
   * 查詢目前背景狀態
   */
  window.getMindspaceAIBackgroundState =
    function () {
      return {
        enabled: state.enabled,
        loading: state.loading,
        hasImage: !!state.image,
        description: state.description,
        error: state.error
      };
    };
  // V6｜取得目前 AI 背景的原始圖片資料
  window.getMindspaceAIBackgroundImage =
    function () {
      return state.enabled && state.dataUrl
        ? state.dataUrl
        : "";
    };
  /*
   * 清空世界時同步清除背景。
   * 只有使用者主動清空才執行。
   */
  const originalClear =
    window.clearMindspaceWorld;

  if (typeof originalClear === "function") {
    window.clearMindspaceWorld = function (...args) {
      state.generation++;
      state.image = null;
state.dataUrl = "";
state.description = "";
      state.loading = false;
      state.enabled = false;
      state.error = null;

      return originalClear(...args);
    };
  }

  console.log(
    "[Mindspace] AI 滿版背景繪製模組已載入"
  );
})();

/* =====================================================
   MINDSPACE｜AI Plus-Plus Blueprint Renderer
   不覆蓋原始 PNG、角色技能或既有配角
===================================================== */

(function () {
  "use strict";

  const blueprints = new Map();

  function validColor(value) {
    return (
      typeof value === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(value)
    )
      ? value
      : "#FFCF5D";
  }

  function normalizeGrid(grid) {
    if (!Array.isArray(grid)) return [];

    return grid.slice(0, 32).map(row => {
      if (typeof row === "string") {
        return row.slice(0, 32).split("");
      }

      if (Array.isArray(row)) {
        return row.slice(0, 32);
      }

      return [];
    });
  }

  function normalizeBlueprint(data) {
    if (!data || typeof data !== "object") {
      return null;
    }

    const grid = normalizeGrid(data.grid);

    if (!grid.length) return null;

    const palette = Array.isArray(data.palette)
      ? data.palette.slice(0, 16)
          .map(validColor)
      : ["#FFCF5D"];

    return {
      grid,
      palette,
      feature: String(data.feature || ""),
      anchor: String(data.anchor || ""),
      motion: String(data.motion || ""),
      scale: Number(data.scale) || 1
    };
  }

  function findTarget(operation) {
    const id =
      operation.targetId ||
      window.mindspaceSelectedId;

    return window.mindspaceCreations?.find(
      item => item.id === id
    ) || null;
  }

  function saveBlueprints(operations) {
    for (const operation of operations) {
      if (
        !operation ||
        operation.type !== "appearance" ||
        !operation.plusBlueprint
      ) {
        continue;
      }

      const target = findTarget(operation);

      if (!target || target.kind !== "character") {
        continue;
      }

      const blueprint =
        normalizeBlueprint(
          operation.plusBlueprint
        );

      if (!blueprint) continue;

      const list =
        blueprints.get(target.id) || [];

      list.push(blueprint);

      blueprints.set(
        target.id,
        list.slice(-12)
      );
    }
  }

  function getAnchorPosition(
    blueprint,
    item
  ) {
    const anchor =
      blueprint.anchor.toLowerCase();

    if (/left|左/.test(anchor)) {
      return {
        x: -item.w * .48,
        y: -item.h * .08
      };
    }

    if (/right|右/.test(anchor)) {
      return {
        x: item.w * .48,
        y: -item.h * .08
      };
    }

    if (/top|head|上|頭/.test(anchor)) {
      return {
        x: 0,
        y: -item.h * .52
      };
    }

    if (/bottom|tail|下|尾/.test(anchor)) {
      return {
        x: 0,
        y: item.h * .42
      };
    }

    return {
      x: 0,
      y: 0
    };
  }

  function drawBlueprint(
    blueprint,
    item,
    index
  ) {
    const grid = blueprint.grid;

    const rows = grid.length;
    const cols = Math.max(
      1,
      ...grid.map(row => row.length)
    );

    const maxDimension =
      Math.max(rows, cols);

    const size =
      Math.max(
        5,
        Math.min(
          16,
          Math.min(item.w, item.h) /
            maxDimension *
            Math.max(
              .4,
              Math.min(2, blueprint.scale)
            )
        )
      );

    const anchor =
      getAnchorPosition(blueprint, item);

    push();

    translate(
      item.x + anchor.x,
      item.y + anchor.y
    );

    // 積木配件具有輕微自主動畫。
    const time =
      typeof worldTime === "number"
        ? worldTime
        : 0;

    const motion =
      blueprint.motion.toLowerCase();

    if (/flap|wing|翅|拍/.test(motion)) {
      rotate(Math.sin(time * 5 + index) * .13);
    } else if (/swing|tail|擺|尾/.test(motion)) {
      rotate(Math.sin(time * 3 + index) * .18);
    } else if (/float|浮|飄/.test(motion)) {
      translate(
        0,
        Math.sin(time * 2 + index) * 5
      );
    }

    for (let y = 0; y < rows; y++) {
      for (
        let x = 0;
        x < grid[y].length;
        x++
      ) {
        const cell = grid[y][x];

        if (
          cell === null ||
          cell === 0 ||
          cell === "0" ||
          cell === "." ||
          cell === " " ||
          cell === false
        ) {
          continue;
        }

        let colorIndex = 0;

        if (
          typeof cell === "number"
        ) {
          colorIndex = Math.max(
            0,
            cell - 1
          );
        } else if (
          /^[1-9]$/.test(String(cell))
        ) {
          colorIndex =
            Number(cell) - 1;
        }

        const color =
          blueprint.palette[
            colorIndex %
            blueprint.palette.length
          ] || "#FFCF5D";

        plusBlock(
          (x - (cols - 1) / 2) * size,
          (y - (rows - 1) / 2) * size,
          size * 1.05,
          color
        );
      }
    }

    pop();
  }

  // 包裝原本的 AI 操作執行器。
  const originalApply =
    window.applyMindspaceAIOperations;

  if (typeof originalApply === "function") {
    window.applyMindspaceAIOperations =
      function (operations) {
        const result =
          originalApply(operations);

        const commit = execution => {
          if (
            execution &&
            execution.success !== false &&
            Array.isArray(operations)
          ) {
            saveBlueprints(operations);
          }

          return execution;
        };

        return result &&
          typeof result.then === "function"
          ? result.then(commit)
          : commit(result);
      };
  }

  // 在原本角色繪製完成後，疊加積木藍圖。
  const originalDrawCreation =
    drawCreation;

  drawCreation = function (item) {
    originalDrawCreation(item);

    const list =
      blueprints.get(item.id);

    if (!list || item.kind !== "character") {
      return;
    }

    list.forEach((blueprint, index) => {
      drawBlueprint(
        blueprint,
        item,
        index
      );
    });
  };

  // 清空世界時移除積木藍圖。
  const originalClear =
    window.clearMindspaceWorld;

  if (typeof originalClear === "function") {
    window.clearMindspaceWorld =
      function (...args) {
        blueprints.clear();

        return originalClear(...args);
      };
  }

  window.getMindspaceBlueprintCount =
    function () {
      let count = 0;

      for (const list of blueprints.values()) {
        count += list.length;
      }

      return count;
    };

/* =========================================================
   MINDSPACE｜PLUS-PLUS BLUEPRINT RENDERER
   角色積木造型 + 碰牆轉向
   不修改原始 PNG
========================================================= */

(function () {
  "use strict";

  const previousApply =
    window.applyMindspaceAIOperations;

  const previousDrawCreation =
    drawCreation;

  if (
    typeof previousApply !== "function" ||
    typeof previousDrawCreation !== "function"
  ) {
    console.error(
      "[Mindspace] 原始 AI 指令或繪製器尚未載入"
    );
    return;
  }

  const PALETTE_KEYS = "ABCDEFGH";

  function validBlueprint(bp) {
    return !!(
      bp &&
      bp.success === true &&
      Array.isArray(bp.grid) &&
      bp.grid.length > 0 &&
      Array.isArray(bp.palette) &&
      bp.palette.length > 0
    );
  }

  function getBlueprintColor(bp, char) {
    const index = PALETTE_KEYS.indexOf(char);

    if (
      index < 0 ||
      index >= bp.palette.length
    ) {
      return null;
    }

    const color = bp.palette[index];

    return /^#[0-9a-f]{6}$/i.test(color)
      ? color
      : null;
  }

  function drawBlueprintGrid(bp, targetW, targetH) {
    const rows = bp.grid.length;

    const cols = Math.max(
      1,
      ...bp.grid.map(row =>
        String(row).length
      )
    );

    const cell = Math.max(
      2,
      Math.min(
        targetW / cols,
        targetH / rows
      )
    );

    const offsetX = -cols * cell / 2;
    const offsetY = -rows * cell / 2;

    for (let y = 0; y < rows; y++) {
      const row = String(bp.grid[y]);

      for (let x = 0; x < row.length; x++) {
        const color =
          getBlueprintColor(bp, row[x]);

        if (!color) continue;

        plusBlock(
          offsetX + (x + .5) * cell,
          offsetY + (y + .5) * cell,
          cell * .94,
          color,
          0
        );
      }
    }
  }

  function getAttachmentPosition(
    feature,
    item,
    index,
    count
  ) {
    const name = String(
      feature.feature ||
      feature.description ||
      ""
    ).toLowerCase();

    const placement = String(
      feature.placement || ""
    ).toLowerCase();

    const side =
      index % 2 === 0 ? -1 : 1;

    const layer =
      Math.floor(index / 2);

    if (
      /wing|翅膀|翅/.test(name)
    ) {
      return {
        x: side * item.w * .46,
        y: -item.h * .12 +
          layer * item.h * .10,
        angle: side * .18,
        mirror: side === 1
      };
    }

    if (
      /horn|角/.test(name) ||
      placement === "head"
    ) {
      return {
        x:
          (index - (count - 1) / 2) *
          Math.min(22, item.w / (count + 1)),
        y: -item.h * .52,
        angle: 0,
        mirror: false
      };
    }

    if (
      /tail|尾巴/.test(name)
    ) {
      return {
        x: item.w * .47,
        y: item.h * .10 +
          index * 10,
        angle: .2,
        mirror: false
      };
    }

    if (
      /tentacle|觸手/.test(name)
    ) {
      return {
        x:
          (index - (count - 1) / 2) *
          Math.min(18, item.w / (count + 1)),
        y: item.h * .50,
        angle: 0,
        mirror: false
      };
    }

    const angle =
      TWO_PI * index / count;

    return {
      x: Math.cos(angle) * item.w * .5,
      y: Math.sin(angle) * item.h * .5,
      angle,
      mirror: false
    };
  }

  function drawBlueprintFeature(feature, item) {
    const bp = feature.plusBlueprint;

    if (!validBlueprint(bp)) {
      return;
    }

    const count = Math.min(
      30,
      Math.max(
        1,
        Math.round(
          Number(feature.count) || 1
        )
      )
    );

    const targetW =
      Math.max(22, item.w * .35);

    const targetH =
      Math.max(18, item.h * .35);

    for (let i = 0; i < count; i++) {
      const position =
        getAttachmentPosition(
          feature,
          item,
          i,
          count
        );

      const motion = String(
        bp.motion || "none"
      );

      const phase =
        worldTime * 5 + i * .7;

      let animation = 0;

      if (motion === "flap") {
        animation =
          Math.sin(phase) * .28;
      } else if (
        motion === "swing" ||
        motion === "wave"
      ) {
        animation =
          Math.sin(phase) * .17;
      } else if (motion === "rotate") {
        animation = worldTime * .8;
      }

      let pulse = 1;

      if (motion === "pulse") {
        pulse =
          1 + Math.sin(phase) * .10;
      }

      let bounceY = 0;

      if (motion === "bounce") {
        bounceY =
          -Math.abs(Math.sin(phase)) * 7;
      }

      push();

      translate(
        position.x,
        position.y + bounceY
      );

      rotate(
        position.angle +
        animation *
        (i % 2 === 0 ? -1 : 1)
      );

      if (position.mirror) {
        scale(-1, 1);
      }

      const blueprintScale =
        Math.min(
          2.5,
          Math.max(
            .4,
            Number(bp.scale) || 1
          )
        );

      scale(
        blueprintScale * pulse
      );

      drawBlueprintGrid(
        bp,
        targetW,
        targetH
      );

      pop();
    }
  }

  /* -----------------------------------------------------
     將 AI 產生的藍圖保存到角色身上
  ----------------------------------------------------- */

  window.applyMindspaceAIOperations =
    function (operations) {
      const result =
        previousApply(operations);

      if (
        !Array.isArray(operations) ||
        !result ||
        result.applied <= 0
      ) {
        return result;
      }

      const allCreations =
        typeof creations !== "undefined"
          ? creations
          : [];

      for (const operation of operations) {
        if (
          operation?.type !== "appearance" ||
          !validBlueprint(
            operation.plusBlueprint
          )
        ) {
          continue;
        }

        const targetId =
          operation.targetId ||
          window.mindspaceSelectedId;

        const item = allCreations.find(
          creation =>
            creation.id === targetId
        );

        if (!item) continue;

        if (!Array.isArray(
          item.mindspaceBlueprintFeatures
        )) {
          item.mindspaceBlueprintFeatures = [];
        }

        item.mindspaceBlueprintFeatures.push({
          feature: operation.feature,
          description: operation.description,
          count: operation.count,
          color: operation.color,
          placement: operation.placement,
          plusBlueprint: operation.plusBlueprint
        });

        item.mindspaceBlueprintFeatures =
          item.mindspaceBlueprintFeatures.slice(-20);
      }

      return result;
    };

  /* -----------------------------------------------------
     原始角色 PNG + AI 積木藍圖
     角色轉向時一起水平翻轉
  ----------------------------------------------------- */

  drawCreation = function (item) {
  const direction =
    Number(item.aiDirection) < 0
      ? 1
      : -1;

    const features =
      Array.isArray(
        item.mindspaceBlueprintFeatures
      )
        ? item.mindspaceBlueprintFeatures
        : [];

    // 保留原本 PNG 與技能繪製器，
    // 同時讓整個角色朝向移動方向。
    push();

    translate(item.x, item.y);
    scale(direction, 1);
    translate(-item.x, -item.y);

    previousDrawCreation(item);

    // 藍圖積木附加於角色身體座標。
    if (features.length) {
      push();

      translate(item.x, item.y);

      for (const feature of features) {
        drawBlueprintFeature(
          feature,
          item
        );
      }

      pop();
    }

    pop();
  };

  /* -----------------------------------------------------
     角色邊界方向修正
     沿用原本 updateCreation 的碰牆反彈，
     這裡額外確保圖片方向正確。
  ----------------------------------------------------- */

  const previousUpdateCreation =
    updateCreation;

  updateCreation = function (item) {
    previousUpdateCreation(item);

    if (
      !item ||
      item.kind !== "character" ||
      item === dragging
    ) {
      return;
    }

    const margin = 12;

    const minX =
      item.w / 2 + margin;

    const maxX =
      Math.max(
        minX,
        width - item.w / 2 - margin
      );

    if (item.x <= minX) {
      item.x = minX;
      item.aiDirection = 1;
    } else if (item.x >= maxX) {
      item.x = maxX;
      item.aiDirection = -1;
    }
  };

  console.log(
    "[Mindspace] Plus-Plus 藍圖與碰牆轉向已載入"
  );
})();

/* =========================================================
   MINDSPACE｜OPENAI IMAGE ACCESSORY RENDERER V1

   真實 OpenAI PNG 配件附著系統

   - 保留孩子原始積木 PNG
   - 每個角色有獨立 AI 配件
   - 可指定 1～30 個配件
   - 翅膀拍動、其他配件跟隨角色
   - 不修改原本 AI operations
   ========================================================= */

(function () {
  "use strict";

  const MAX_ACCESSORIES = 20;

  function getCharacter(id) {
    return creations.find(item => item.id === id);
  }

  function loadAccessoryImage(dataURL) {
    return new Promise((resolve, reject) => {
      if (
        typeof dataURL !== "string" ||
        !dataURL.startsWith(
          "data:image/png;base64,"
        )
      ) {
        reject(new Error("無效的 AI PNG"));
        return;
      }

      loadImage(
        dataURL,
        image => resolve(image),
        () => reject(
          new Error("AI 配件圖片載入失敗")
        )
      );
    });
  }

  function isWing(feature) {
    return /wing|翅|翼/i.test(
      String(feature || "")
    );
  }

  function isTail(feature) {
    return /tail|尾巴|尾翼/i.test(
      String(feature || "")
    );
  }

  function isHorn(feature) {
    return /horn|角/i.test(
      String(feature || "")
    );
  }

  function getAccessoryPosition(
    accessory,
    item,
    index
  ) {
    const count = accessory.count;

    const feature = accessory.feature;

    if (isWing(feature)) {
      const side =
        index % 2 === 0 ? -1 : 1;

      const layer = Math.floor(index / 2);

      const layers = Math.ceil(count / 2);

      const spread =
        layer - (layers - 1) / 2;

      return {
        x: side * item.w * .47,
        y: spread * item.h * .17,
        angle:
          side * (
            .18 +
            Math.sin(
              worldTime * 6.5 +
              layer * .7
            ) * .28
          ),
        mirror: side === 1,
        width: item.w * .42,
        height: item.h * .55
      };
    }

    if (isHorn(feature)) {
      const gap =
        item.w * .18;

      return {
        x:
          (index - (count - 1) / 2) *
          gap,
        y: -item.h * .48,
        angle: 0,
        mirror: false,
        width: item.w * .22,
        height: item.h * .35
      };
    }

    if (isTail(feature)) {
      return {
        x: item.w * .48,
        y:
          (index - (count - 1) / 2) *
          item.h * .12,
        angle:
          Math.sin(
            worldTime * 4 + index
          ) * .20,
        mirror: false,
        width: item.w * .38,
        height: item.h * .35
      };
    }

    const angle =
      TWO_PI * index / count;

    return {
      x: Math.cos(angle) *
        item.w * .48,
      y: Math.sin(angle) *
        item.h * .48,
      angle: angle,
      mirror: false,
      width: item.w * .28,
      height: item.h * .28
    };
  }

  function drawAccessory(
    accessory,
    item
  ) {
    if (!accessory.image) return;

    const count = Math.max(
      1,
      Math.min(30, accessory.count)
    );

    for (let i = 0; i < count; i++) {
      const position =
        getAccessoryPosition(
          accessory,
          item,
          i
        );

      push();

      translate(
        position.x,
        position.y
      );

      rotate(position.angle);

      if (position.mirror) {
        scale(-1, 1);
      }

      const pulse =
        isWing(accessory.feature)
          ? 1 + Math.sin(
              worldTime * 6 + i
            ) * .045
          : 1;

      scale(pulse);

      imageMode(CENTER);

      image(
        accessory.image,
        0,
        0,
        position.width,
        position.height
      );

      pop();
    }
  }

  function drawAllAIAccessories(item) {
    const accessories =
      item.mindspaceAIAccessories;

    if (
      !Array.isArray(accessories) ||
      accessories.length === 0
    ) {
      return;
    }

    push();

    translate(item.x, item.y);

    for (const accessory of accessories) {
      drawAccessory(accessory, item);
    }

    pop();
  }

  // 公開給 index.html 呼叫。
  window.addMindspaceAIAccessory =
    async function (data) {

    const targetId = String(
      data?.targetId ||
      window.mindspaceSelectedId ||
      ""
    );

    const item = getCharacter(targetId);

    if (!item) {
      throw new Error(
        "找不到要附加 AI 配件的角色"
      );
    }

    const png = data?.image;

    const accessoryImage =
      await loadAccessoryImage(png);

    if (!Array.isArray(
      item.mindspaceAIAccessories
    )) {
      item.mindspaceAIAccessories = [];
    }

    const accessory = {
      id:
        "ai-accessory-" +
        Date.now() + "-" +
        Math.random().toString(36).slice(2),

      feature: String(
        data.feature || "accessory"
      ),

      description: String(
        data.description || ""
      ),

      count: Math.max(
        1,
        Math.min(
          30,
          Math.round(
            Number(data.count) || 1
          )
        )
      ),

      image: accessoryImage,

      model: String(
        data.model || "unknown"
      ),

      createdAt: Date.now()
    };

    item.mindspaceAIAccessories.push(
      accessory
    );

    if (
      item.mindspaceAIAccessories.length >
      MAX_ACCESSORIES
    ) {
      item.mindspaceAIAccessories.shift();
    }

    console.log(
      "[Mindspace] OpenAI 配件已附著",
      {
        targetId,
        feature: accessory.feature,
        count: accessory.count,
        model: accessory.model
      }
    );

    window.dispatchEvent(
      new CustomEvent(
        "mindspace:ai-accessory-added",
        {
          detail: {
            targetId,
            feature: accessory.feature,
            count: accessory.count,
            model: accessory.model
          }
        }
      )
    );

    return {
      success: true,
      targetId,
      accessoryId: accessory.id,
      count: accessory.count
    };
  };

  // 包裝目前最終版本的 drawCreation，
  // 不取代既有角色、技能或積木藍圖繪製。
  const previousDrawCreation =
    drawCreation;

  drawCreation = function (item) {
    drawAllAIAccessories(item);

    previousDrawCreation(item);
  };

  console.log(
    "[Mindspace] OpenAI PNG 配件渲染器已啟動"
  );
})();

  console.log(
    "[Mindspace] AI Plus-Plus Blueprint Renderer 已載入"
  );
})();

/* =========================================================
   MINDSPACE｜OPENAI PLACED PNG ACCESSORY V3

   保留：
   - 原始積木 PNG
   - 既有 AI 分類、環境、技能、藍圖
   - 角色自主移動與拖曳
   - 舊版配件

   新增：
   - 接收 OpenAI placement.points
   - 依 AI 位置附著透明 PNG
   - 翅膀持續拍動
   - 配件跟隨角色移動
   - 圖片載入成功才回報 success
========================================================= */

(function installMindspacePlacedAccessoriesV3() {
  "use strict";

  const previousDrawCreation = drawCreation;

  function findTarget(id) {
    return (window.mindspaceCreations || []).find(
      item => String(item.id) === String(id)
    );
  }

  function isValidPNG(value) {
    return (
      typeof value === "string" &&
      /^data:image\/png;base64,/i.test(value)
    );
  }

  function loadPNG(dataURL) {
    return new Promise((resolve, reject) => {
      if (!isValidPNG(dataURL)) {
        reject(new Error(
          "OpenAI 沒有回傳有效的透明 PNG"
        ));
        return;
      }

      loadImage(
        dataURL,
        img => resolve(img),
        () => reject(new Error(
          "OpenAI 配件 PNG 載入失敗"
        ))
      );
    });
  }

  function finiteNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function isWing(feature) {
    return /wing|翅|翼/i.test(
      String(feature || "")
    );
  }

  /*
    AI 座標約定：
    x、y：以角色原始照片中心為基準，
          -0.5～0.5 為一般相對座標
    width、height：相對角色尺寸
    angle：弧度
    layer：front / back
    mirror：是否水平鏡射

    若後端提供的是其他座標格式，
    必須同步調整這裡的轉換。
  */
  function normalizePoint(point) {
    if (!point || typeof point !== "object") {
      throw new Error(
        "OpenAI 配件定位點格式錯誤"
      );
    }

    const x = Number(point.x);
    const y = Number(point.y);
    const width = Number(point.width);
    const height = Number(point.height);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    ) {
      throw new Error(
        "OpenAI 回傳的配件位置或尺寸無效"
      );
    }

    return {
      x,
      y,
      width,
      height,
      angle: finiteNumber(point.angle, 0),
      mirror: point.mirror === true,
      layer:
        point.layer === "back"
          ? "back"
          : "front"
    };
  }

  window.addMindspaceAIAccessory =
    async function(data) {

      if (!data || typeof data !== "object") {
        throw new Error(
          "缺少 AI 配件資料"
        );
      }

      const targetId = String(
        data.targetId ||
        window.mindspaceSelectedId ||
        ""
      );

      const item = findTarget(targetId);

      if (!item) {
        throw new Error(
          "找不到指定的積木角色"
        );
      }

      if (item.kind !== "character") {
        throw new Error(
          "目前只能將 AI 配件附著到角色"
        );
      }

      const count = Math.round(
        Number(data.count) || 1
      );

      if (count < 1 || count > 30) {
        throw new Error(
          "配件數量必須介於 1～30"
        );
      }

      const placement = data.placement;

      if (
        !placement ||
        placement.success !== true ||
        !Array.isArray(placement.points)
      ) {
        throw new Error(
          "OpenAI 沒有提供有效的配件定位"
        );
      }

      if (placement.points.length !== count) {
        throw new Error(
          "AI 定位數量與配件數量不一致：" +
          placement.points.length +
          " / " +
          count
        );
      }

      const points = placement.points.map(
        normalizePoint
      );

      // 真正載入 OpenAI 回傳的圖片。
      // 不是使用 p5.js 假造積木配件。
      const accessoryImage = await loadPNG(
        data.image
      );

      if (!Array.isArray(
        item.mindspacePlacedAccessoriesV3
      )) {
        item.mindspacePlacedAccessoriesV3 = [];
      }

      const accessory = {
        id:
          "placed-accessory-" +
          Date.now() + "-" +
          Math.random().toString(36).slice(2),

        image: accessoryImage,
        feature: String(
          data.feature || "accessory"
        ),
        description: String(
          data.description || ""
        ),
        model: String(
          data.model || "OpenAI"
        ),
        count,
        points,
        createdAt: Date.now()
      };

      item.mindspacePlacedAccessoriesV3.push(
        accessory
      );

      console.log(
        "[Mindspace] AI 定位配件已成功附著",
        {
          targetId,
          feature: accessory.feature,
          count,
          points
        }
      );

      window.dispatchEvent(
        new CustomEvent(
          "mindspace:ai-accessory-added",
          {
            detail: {
              targetId,
              feature: accessory.feature,
              count,
              model: accessory.model
            }
          }
        )
      );

      return {
        success: true,
        targetId,
        accessoryId: accessory.id,
        count
      };
    };

  function drawPoint(accessory, point, item, index) {
    const px = point.x * item.w;
    const py = point.y * item.h;

    const w = point.width * item.w;
    const h = point.height * item.h;

    const wing = isWing(accessory.feature);

    const flap = wing
      ? Math.sin(
          worldTime * 7 +
          index * 0.65
        ) * 0.24
      : 0;

    push();

    translate(px, py);
    rotate(point.angle + flap);

    if (point.mirror) {
      scale(-1, 1);
    }

    imageMode(CENTER);

    image(
      accessory.image,
      0,
      0,
      w,
      h
    );

    pop();
  }

  function drawAccessoryLayer(item, layer) {
    const accessories =
      item.mindspacePlacedAccessoriesV3;

    if (
      !Array.isArray(accessories) ||
      accessories.length === 0
    ) {
      return;
    }

    push();

    translate(item.x, item.y);

    for (const accessory of accessories) {
      accessory.points.forEach(
        (point, index) => {
          if (point.layer !== layer) return;

          drawPoint(
            accessory,
            point,
            item,
            index
          );
        }
      );
    }

    pop();
  }

  // 保留舊版 drawCreation 的所有內容。
  // 只在其前後增加 AI 配件圖層。
  drawCreation = function(item) {
    drawAccessoryLayer(item, "back");

    previousDrawCreation(item);

    drawAccessoryLayer(item, "front");
  };

  console.log(
    "[Mindspace] AI 定位 PNG 配件 V3 已載入"
  );

})();

/* =====================================================
   MINDSPACE｜MANUAL ACCESSORY + ENVIRONMENT V4

   1. 孩子自由放置 OpenAI PNG 配件
   2. 配件跟隨角色移動與旋轉
   3. AI 環境完成後隱藏原始環境照片
   4. 保留原始角色與其他功能
===================================================== */

(function () {
  "use strict";

  const loadAccessoryImage = dataURL =>
    new Promise((resolve, reject) => {
      loadImage(
        dataURL,
        resolve,
        () => reject(
          new Error("無法載入 OpenAI 配件 PNG")
        )
      );
    });

  function findCreation(id) {
    return creations.find(
      item => String(item.id) === String(id)
    );
  }

  // 只有 Environment 可以被隱藏。
  // 不刪除圖片或創作資料。
  window.hideMindspaceEnvironmentOriginal =
    function(id) {
      const item = findCreation(id);

      if (!item || item.kind !== "environment") {
        return false;
      }

      const background =
        window.getMindspaceAIBackgroundState?.();

      if (
        !background ||
        !background.enabled ||
        !background.hasImage
      ) {
        return false;
      }

      item.mindspaceEnvironmentOriginalHidden = true;

      console.log(
        "[Mindspace] 環境原始照片已隱藏",
        id
      );

      return true;
    };

  window.showMindspaceEnvironmentOriginal =
    function(id) {
      const item = findCreation(id);
      if (!item) return false;

      item.mindspaceEnvironmentOriginalHidden = false;
      return true;
    };

  // 保存孩子確認的配件位置。
  window.attachMindspaceManualAccessory =
    async function(data) {

      const item = findCreation(data?.targetId);

      if (!item || item.kind !== "character") {
        throw new Error("找不到要附著配件的角色");
      }

      if (
        typeof data.image !== "string" ||
        !data.image.startsWith(
          "data:image/png;base64,"
        )
      ) {
        throw new Error("缺少 OpenAI 透明 PNG");
      }

      if (!Array.isArray(data.parts) ||
          !data.parts.length) {
        throw new Error("尚未設定配件位置");
      }

      const img = await loadAccessoryImage(
        data.image
      );

      if (!Array.isArray(item.manualAIAccessories)) {
        item.manualAIAccessories = [];
      }

      const parts = data.parts.map(part => {
        const x = Number(part.x);
        const y = Number(part.y);
        const scale = Number(part.scale);
        const angle = Number(part.angle);

        if (
          ![x, y, scale, angle].every(
            Number.isFinite
          ) ||
          scale <= 0
        ) {
          throw new Error("配件座標或尺寸無效");
        }

        return {
          x,
          y,
          scale,
          angle
        };
      });

      item.manualAIAccessories.push({
        id: crypto.randomUUID(),
        img,
        feature: String(
          data.feature || "accessory"
        ),
        parts
      });

      return {
        success: true,
        count: parts.length
      };
    };

  function drawManualAccessories(item) {
    if (
      !Array.isArray(item.manualAIAccessories) ||
      !item.manualAIAccessories.length
    ) {
      return;
    }

    push();
    translate(item.x, item.y);

    // 與原始角色使用相同的擺動角度。
    if (item.kind === "character") {
      const amount =
        item.movement === "swim"
          ? .12
          : item.movement === "run"
            ? .06
            : .045;

      rotate(
        sin(worldTime * 1.4 + item.phase) *
        amount
      );
    }

    imageMode(CENTER);

    for (const accessory of
      item.manualAIAccessories) {

      for (const part of accessory.parts) {
        push();

        translate(
          part.x * item.w,
          part.y * item.h
        );

        rotate(part.angle);

        const displayWidth =
          item.w * part.scale;

        const imageRatio =
          accessory.img.height /
          Math.max(1, accessory.img.width);

        image(
          accessory.img,
          0,
          0,
          displayWidth,
          displayWidth * imageRatio
        );

        pop();
      }
    }

    pop();
  }

  const previousDrawCreation = drawCreation;

  drawCreation = function(item) {
    if (
      item.kind === "environment" &&
      item.mindspaceEnvironmentOriginalHidden
    ) {
      return;
    }

    previousDrawCreation(item);

    if (item.kind === "character") {
      drawManualAccessories(item);
    }
  };

/* =====================================================
   MINDSPACE｜WHOLE CHARACTER SPRITE V5

   功能：
   - 保留 originalPNG
   - 使用新 PNG 替換 item.img
   - 保留角色 ID、位置、能力、移動方式
   - 保留環境與其他角色
   - 避免舊配件重複顯示
===================================================== */

(function () {
  "use strict";

  function findCharacter(id) {
    return creations.find(
      item =>
        String(item.id) === String(id) &&
        item.kind === "character"
    );
  }

  function loadTransformationPNG(dataURL) {
    return new Promise((resolve, reject) => {
      if (
        typeof dataURL !== "string" ||
        !dataURL.startsWith(
          "data:image/png;base64,"
        )
      ) {
        reject(
          new Error("變身圖片不是有效的 PNG 資料")
        );
        return;
      }

      loadImage(
        dataURL,
        imageObject => {
          if (
            !imageObject ||
            !imageObject.width ||
            !imageObject.height
          ) {
            reject(
              new Error("變身圖片尺寸無效")
            );
            return;
          }

          resolve(imageObject);
        },
        () => reject(
          new Error("p5.js 無法載入變身圖片")
        )
      );
    });
  }

  window.replaceMindspaceCharacterImage =
    async function(data) {
      data = data || {};

      const item = findCharacter(data.targetId);

      if (!item) {
        throw new Error(
          "找不到要進行整體變身的角色"
        );
      }

      const newImage =
        await loadTransformationPNG(data.image);

      // 第一次變身時記錄原本尺寸。
      if (!item.mindspaceOriginalSpriteSize) {
        item.mindspaceOriginalSpriteSize = {
          w: item.w,
          h: item.h
        };
      }

      const originalSize =
        item.mindspaceOriginalSpriteSize;

      // 保留目前的角色中心與活動屬性。
      const oldX = item.x;
      const oldY = item.y;
      const oldBaseY = item.baseY;

      // 新增翅膀等部位後，允許圖片變大，
      // 但限制最大顯示尺寸。
      const maxWidth = Math.max(
        80,
        originalSize.w * 1.6
      );

      const maxHeight = Math.max(
        80,
        originalSize.h * 1.6
      );

      const scale = Math.min(
        maxWidth / newImage.width,
        maxHeight / newImage.height
      );

      const newW = newImage.width * scale;
      const newH = newImage.height * scale;

      // 不修改 item.originalPNG。
      // 保留上一張成功變身圖片，供連續變身。
      const previousPNG =
        item.mindspaceCurrentPNG ||
        item.originalPNG;

      // 新圖片成功載入後才正式替換。
      item.img = newImage;
      item.mindspaceCurrentPNG = data.image;

      item.w = newW;
      item.h = newH;

      item.x = oldX;
      item.y = oldY;
      item.baseY = oldBaseY;

      // 新圖片已包含完整角色與新增部位。
      // 避免以前的 V3/V4 配件又疊在上面。
      item.manualAIAccessories = [];
      item.mindspaceAIAccessories = [];

      item.mindspacePreviousPNG = previousPNG;

      item.mindspaceLastTransformation = {
        description: String(
          data.description || ""
        ),
        feature: String(
          data.feature || ""
        ),
        model: String(
          data.model || ""
        ),
        timestamp: Date.now()
      };

      console.log(
        "[Mindspace] 整體角色圖片替換成功",
        {
          id: item.id,
          model: data.model,
          originalPreserved:
            Boolean(item.originalPNG),
          newWidth: item.w,
          newHeight: item.h
        }
      );

      return {
        success: true,
        targetId: item.id,
        originalPreserved:
          Boolean(item.originalPNG)
      };
    };
})();

  console.log(
    "[Mindspace] 手動配件與環境隱藏 V4 已載入"
  );
})();

/* =====================================================
   MINDSPACE｜WHOLE CHARACTER SPRITE V5

   功能：
   - 保留 originalPNG
   - 使用新 PNG 替換 item.img
   - 保留角色 ID、位置、能力、移動方式
   - 保留環境與其他角色
   - 避免舊配件重複顯示
===================================================== */

(function () {
  "use strict";

  function findCharacter(id) {
    return creations.find(
      item =>
        String(item.id) === String(id) &&
        item.kind === "character"
    );
  }

  function loadTransformationPNG(dataURL) {
    return new Promise((resolve, reject) => {
      if (
        typeof dataURL !== "string" ||
        !dataURL.startsWith(
          "data:image/png;base64,"
        )
      ) {
        reject(
          new Error("變身圖片不是有效的 PNG 資料")
        );
        return;
      }

      loadImage(
        dataURL,
        imageObject => {
          if (
            !imageObject ||
            !imageObject.width ||
            !imageObject.height
          ) {
            reject(
              new Error("變身圖片尺寸無效")
            );
            return;
          }

          resolve(imageObject);
        },
        () => reject(
          new Error("p5.js 無法載入變身圖片")
        )
      );
    });
  }

  window.replaceMindspaceCharacterImage =
    async function(data) {
      data = data || {};

      const item = findCharacter(data.targetId);

      if (!item) {
        throw new Error(
          "找不到要進行整體變身的角色"
        );
      }

      const newImage =
        await loadTransformationPNG(data.image);

      // 第一次變身時記錄原本尺寸。
      if (!item.mindspaceOriginalSpriteSize) {
        item.mindspaceOriginalSpriteSize = {
          w: item.w,
          h: item.h
        };
      }

      const originalSize =
        item.mindspaceOriginalSpriteSize;

      // 保留目前的角色中心與活動屬性。
      const oldX = item.x;
      const oldY = item.y;
      const oldBaseY = item.baseY;

      // 新增翅膀等部位後，允許圖片變大，
      // 但限制最大顯示尺寸。
      const maxWidth = Math.max(
        80,
        originalSize.w * 1.6
      );

      const maxHeight = Math.max(
        80,
        originalSize.h * 1.6
      );

      const scale = Math.min(
        maxWidth / newImage.width,
        maxHeight / newImage.height
      );

      const newW = newImage.width * scale;
      const newH = newImage.height * scale;

      // 不修改 item.originalPNG。
      // 保留上一張成功變身圖片，供連續變身。
      const previousPNG =
        item.mindspaceCurrentPNG ||
        item.originalPNG;

      // 新圖片成功載入後才正式替換。
      item.img = newImage;
      item.mindspaceCurrentPNG = data.image;

      item.w = newW;
      item.h = newH;

      item.x = oldX;
      item.y = oldY;
      item.baseY = oldBaseY;

      // 新圖片已包含完整角色與新增部位。
      // 避免以前的 V3/V4 配件又疊在上面。
      item.manualAIAccessories = [];
      item.mindspaceAIAccessories = [];

      item.mindspacePreviousPNG = previousPNG;

      item.mindspaceLastTransformation = {
        description: String(
          data.description || ""
        ),
        feature: String(
          data.feature || ""
        ),
        model: String(
          data.model || ""
        ),
        timestamp: Date.now()
      };

      console.log(
        "[Mindspace] 整體角色圖片替換成功",
        {
          id: item.id,
          model: data.model,
          originalPreserved:
            Boolean(item.originalPNG),
          newWidth: item.w,
          newHeight: item.h
        }
      );

      return {
        success: true,
        targetId: item.id,
        originalPreserved:
          Boolean(item.originalPNG)
      };
    };
})();
