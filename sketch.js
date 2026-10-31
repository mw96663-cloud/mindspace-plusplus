
/*
 * Mindspace Plus-Plus
 * sketch.js | World Fusion v3
 *
 * 保留：
 * - 原始積木 PNG
 * - 多角色共存
 * - AI 角色動作
 * - Environment 作品
 * - 3 秒特效
 * - 拖曳
 * - 原本前端呼叫介面
 *
 * 新增：
 * - Character 也生成世界
 * - AI 身分決定場景
 * - AI 身分決定移動
 * - Plus-Plus 積木風格
 * - 不同世界逐漸融合
 *
 * 本檔不直接呼叫 OpenAI。
 * AI 資料由現有 index.html + GAS 提供。
 */

const creations = [];
const environments = [];
const particles = [];
const worldZones = [];

window.mindspaceCreations = creations;
window.mindspaceWorldZones = worldZones;

let worldTime = 0;
let activeEffects = [];

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
   01. 初始化
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
}

/* =====================================
   02. AI 世界判斷
===================================== */

function detectWorldType(text) {
  const s = String(text || "").toLowerCase();

  // 特殊想像優先於普通動物身分。
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

  // 優先使用 AI 回傳的世界類型。
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

  // 每個新世界加入時播放一次特效。
  startEnvironmentEffect(
    env.effect || "sparkle",
    item.x,
    item.y
  );
}

/* =====================================
   03. Plus-Plus 風格積木繪製
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
   04. 積木環境物件
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
   05. 世界融合背景
===================================== */

function drawBackground() {
  // 沒有任何作品時，顯示中性的想像空間。
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

  // 使用每個世界的天空色建立連續漸層。
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
   06. 氛圍粒子
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
   07. 原始積木進入世界
===================================== */

window.addMindspaceCreation = function(dataURL) {
  return new Promise((resolve, reject) => {
    loadImage(
      dataURL,

      img => {
        const maxSize = min(
          width * .27,
          height * .34,
          260
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
          directionTimer: 0
        };

        item.baseY = item.y;

        creations.push(item);

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
   08. 套用 AI 分類
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

    // 核心升級：
    // Character 和 Environment
    // 都可以帶來自己的世界。
    createOrUpdateWorld(
      item,
      aiData
    );

  } else {
    // 沒有 AI 回覆時，保留基本互動。
    // 不宣稱這是 AI 生成的內容。
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
};

/* =====================================
   09. AI 角色行為
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

  // 地面型角色初始位置移至地面。
  if ([
    "run", "walk", "crawl", "bounce"
  ].includes(item.movement)) {
    item.baseY = min(
      height - item.h / 2 - 15,
      height * .87 - item.h / 2
    );

    item.y = item.baseY;
  }

  // 飛行角色從天空開始。
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

function updateCreation(item) {
  if (dragging === item) return;

  if (item.kind === "environment") {
    item.y =
      item.baseY +
      sin(worldTime * .5 + item.phase) * 3;
    return;
  }

  const speed = item.speed || 1;
  const energy = item.energy ?? .5;
  const t = worldTime;

  const groundY = constrain(
    height * .87 - item.h / 2,
    item.h / 2 + 10,
    height - item.h / 2 - 15
  );

  // 未分類作品沿用原本的漂浮行為。
  if (item.kind !== "character") {
    item.x += item.vx * .45;
    item.y =
      item.baseY +
      sin(t + item.phase) *
      item.floatRange;
  } else {

    switch (item.movement) {
      case "run":
        item.baseY = groundY;
        item.x += item.vx * 1.6;

        item.y =
          groundY -
          abs(
            sin(
              t * (6 + speed * 2) +
              item.phase
            )
          ) * (4 + energy * 16);
        break;

      case "walk":
        item.baseY = groundY;
        item.x += item.vx * .65;

        item.y =
          groundY -
          abs(
            sin(
              t * (3 + speed) +
              item.phase
            )
          ) * (2 + energy * 7);
        break;

      case "crawl":
        item.baseY = groundY;
        item.x += item.vx * .25;

        item.y =
          groundY +
          sin(t * 3 + item.phase) * 2;
        break;

      case "bounce":
        item.baseY = groundY;
        item.x += item.vx * .8;

        item.y =
          groundY -
          abs(
            sin(
              t * (2 + speed) +
              item.phase
            )
          ) * (20 + energy * 55);
        break;

      case "swim":
        item.x += item.vx;

        item.y =
          item.baseY +
          sin(
            t * (1.8 + speed) +
            item.phase
          ) * (8 + energy * 18);
        break;

      case "fly":
        item.x += item.vx * 1.3;

        item.y =
          item.baseY +
          sin(
            t * (1.2 + speed) +
            item.phase
          ) * (20 + energy * 35);
        break;

      case "hover":
        item.x += item.vx * .25;

        item.y =
          item.baseY +
          sin(
            t * (1.5 + speed) +
            item.phase
          ) * (15 + energy * 20);
        break;

      default:
        item.x += item.vx * .45;

        item.y =
          item.baseY +
          sin(
            t * (1 + speed) +
            item.phase
          ) * item.floatRange;
        break;
    }
  }

  // 保留在畫面範圍內。
  const margin = item.w / 2 + 12;

  if (item.x < margin) {
    item.x = margin;
    item.vx = abs(item.vx);
  }

  if (item.x > width - margin) {
    item.x = width - margin;
    item.vx = -abs(item.vx);
  }

  item.y = constrain(
    item.y,
    item.h / 2 + 10,
    height - item.h / 2 - 15
  );
}

/* =====================================
   10. 原始積木繪製
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

  // 不修改圖片、不重新生成角色。
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
   11. Environment 資料
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
   12. 三秒環境特效
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
   13. 拖曳作品
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
  dragging = null;
}

/* =====================================
   14. 清空世界
===================================== */

window.clearMindspaceWorld = function() {
  creations.length = 0;
  environments.length = 0;
  worldZones.length = 0;
  activeEffects.length = 0;

  window.updateMindspaceCount?.(0);
};

/* =====================================
   15. 視窗大小調整
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
   16. 檢查 AI 世界資料
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
