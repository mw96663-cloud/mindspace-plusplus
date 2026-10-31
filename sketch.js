
/*
 * Mindspace Plus-Plus
 * sketch.js｜Character + Environment v2
 *
 * 功能：
 * 1. 原始積木圖片進入世界
 * 2. 多個作品持續共存
 * 3. Character 依 AI 特質活動
 * 4. Environment 延伸場景
 * 5. 環境專屬 3 秒特效
 * 6. 孩子可拖曳作品
 *
 * 不會自行呼叫假 AI。
 * AI 資料由 index.html 的真實後端請求提供。
 */

const creations = [];
const environments = [];
const particles = [];

window.mindspaceCreations = creations;

let worldTime = 0;
let activeEffects = [];
let dragging = null;
let dragDX = 0;
let dragDY = 0;

function setup() {
  const canvas = createCanvas(
    windowWidth,
    windowHeight
  );

  canvas.parent("scene");

  imageMode(CENTER);
  rectMode(CENTER);
  noStroke();

  for (let i = 0; i < 40; i++) {
    particles.push({
      x: random(width),
      y: random(height),
      r: random(2, 10),
      speed: random(.2, .9),
      alpha: random(25, 100)
    });
  }

  window.updateMindspaceCount?.(0);
}

function draw() {
  worldTime += deltaTime / 1000;

  drawBackground();
  drawEnvironmentLayers();
  drawAmbientParticles();

  // 原始積木永遠顯示在場景中。
  for (const item of creations) {
    updateCreation(item);
    drawCreation(item);
  }

  drawEffects();
}

function drawBackground() {
  const topColor = color(147, 220, 243);
  const bottomColor = color(35, 94, 150);

  for (let y = 0; y < height; y += 5) {
    const t = y / height;

    stroke(lerpColor(topColor, bottomColor, t));
    strokeWeight(5);
    line(0, y, width, y);
  }

  noStroke();

  fill(255, 255, 255, 12);

  for (let i = 0; i < 7; i++) {
    const x = width * i / 6;
    const drift = sin(worldTime * .2 + i) * 30;

    triangle(
      x + drift, 0,
      x + drift - 110, height,
      x + drift + 110, height
    );
  }
}

function drawAmbientParticles() {
  noStroke();

  for (const p of particles) {
    p.y -= p.speed;

    if (p.y < -20) {
      p.y = height + 20;
      p.x = random(width);
    }

    fill(255, 255, 255, p.alpha);
    circle(p.x, p.y, p.r);
  }
}

/* 加入原始積木 */

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
            max(w / 2 + 21, width - w / 2 - 20)
          ),

          y: random(
            h / 2 + 40,
            max(h / 2 + 41, height - h / 2 - 40)
          ),

          baseY: 0,
          w,
          h,

          vx: random(-.6, .6),
          phase: random(TWO_PI),
          floatRange: random(5, 13),

          kind: "unclassified",
          name: "",
          description: "",

          personality: "",
          movement: "float",
          speed: 1,
          energy: .5,
          interaction: "",

          environmentData: null,
          rotation: random(-.04, .04)
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

/* 套用孩子確認的角色／環境 */

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

  // 有 AI 回覆時，套用真實辨識資料。
  // 沒有 AI 回覆時，使用基礎互動行為，
  // 不宣稱它是 AI 生成。
  if (aiData) {
    item.name = String(aiData.name || "");

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
        palette: ["#B6DDF6", "#FFE6A5"],
        elements: ["sparkle"],
        effect: "sparkle"
      });
    }
  }

  return true;
};

/* Character */

function applyCharacterData(item, data) {
  item.personality =
    String(data.personality || "充滿好奇");

  item.movement =
    ["float", "swim", "walk", "fly", "bounce"]
      .includes(data.movement)
      ? data.movement
      : "float";

  item.speed = constrain(
    Number(data.speed) || 1,
    .2,
    3
  );

  item.energy = constrain(
    Number(data.energy) || .5,
    0,
    1
  );

  item.interaction =
    String(data.interaction || "自由探索");

  // 讓角色的活動速度反映 AI 特質。
  item.vx =
    (random() < .5 ? -1 : 1) *
    (.3 + item.speed * .45);

  item.floatRange =
    5 + item.energy * 24;
}

function updateCreation(item) {
  if (dragging === item) return;

  if (item.kind === "environment") {
    // 環境作品本體保留，緩慢漂浮。
    item.y =
      item.baseY +
      sin(worldTime * .5 + item.phase) * 3;
    return;
  }

  const speed =
    item.kind === "character"
      ? item.speed
      : 1;

  const energy =
    item.kind === "character"
      ? item.energy
      : .5;

  const t = worldTime;

  switch (item.movement) {

    case "swim":
      item.x += item.vx;
      item.y =
        item.baseY +
        sin(t * (1.8 + speed) + item.phase) *
        (8 + energy * 18);
      break;

    case "fly":
      item.x += item.vx * 1.3;
      item.y =
        item.baseY +
        sin(t * (1.2 + speed) + item.phase) *
        (20 + energy * 35);
      break;

    case "walk":
      item.x += item.vx * .55;
      item.y =
        item.baseY +
        abs(sin(t * (3 + speed) + item.phase)) *
        (3 + energy * 8);
      break;

    case "bounce":
      item.x += item.vx * .8;
      item.y =
        item.baseY -
        abs(sin(t * (2 + speed) + item.phase)) *
        (20 + energy * 55);
      break;

    default:
      item.x += item.vx * .45;
      item.y =
        item.baseY +
        sin(t * (1 + speed) + item.phase) *
        item.floatRange;
      break;
  }

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

function drawCreation(item) {
  push();

  translate(item.x, item.y);

  if (item.kind === "character") {
    const rotationAmount =
      item.movement === "swim"
        ? .12
        : .045;

    rotate(
      sin(worldTime * 1.4 + item.phase) *
      rotationAmount
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

/* Environment */

function applyEnvironmentData(item, data) {
  const palette =
    Array.isArray(data.palette)
      ? data.palette.filter(
          value =>
            typeof value === "string" &&
            /^#[0-9a-fA-F]{6}$/.test(value)
        )
      : [];

  const elements =
    Array.isArray(data.elements)
      ? data.elements
      : [];

  const effect =
    ["sparkle", "rain", "bubbles", "glow", "wind"]
      .includes(data.effect)
      ? data.effect
      : "sparkle";

  item.environmentData = {
    theme: String(data.theme || "想像世界"),
    palette:
      palette.length
        ? palette
        : ["#A7DDF6", "#FFE5A6"],
    elements: elements.slice(0, 6),
    effect: effect
  };

  // 若重複確認同一個作品，更新而不複製環境。
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

  startEnvironmentEffect(
    effect,
    item.x,
    item.y
  );
}

function drawEnvironmentLayers() {
  for (const env of environments) {
    const data = env.data;
    const palette = data.palette;

    const c1 = color(
      palette[0] || "#B5E2F5"
    );

    const c2 = color(
      palette[1] || "#FFE7B0"
    );

    // 不清除其他環境，讓不同作品共存。
    push();

    noStroke();

    fill(
      red(c1),
      green(c1),
      blue(c1),
      25
    );

    ellipse(
      width * .5,
      height * .83,
      width * 1.2,
      height * .28
    );

    for (let i = 0; i < data.elements.length; i++) {
      drawEnvironmentElement(
        data.elements[i],
        i,
        env.seed,
        c1,
        c2
      );
    }

    pop();
  }
}

function drawEnvironmentElement(
  type, index, seed, c1, c2
) {
  const x =
    width * (.13 + ((index * .17 + seed * .001) % .74));

  const y =
    height * (.2 + ((index * .13 + seed * .0001) % .55));

  const s = min(width, height) * .07;

  push();
  translate(x, y);
  noStroke();

  if (type === "cloud") {
    fill(255, 255, 255, 95);
    ellipse(-s * .4, 0, s, s * .6);
    ellipse(0, -s * .15, s * 1.2, s * .85);
    ellipse(s * .5, 0, s, s * .6);
  }

  if (type === "star" || type === "sparkle") {
    fill(c2);
    drawStar(0, 0, s * .18, s * .45, 5);
  }

  if (type === "bubble") {
    noFill();
    stroke(255, 255, 255, 120);
    strokeWeight(2);
    circle(0, 0, s);
  }

  if (type === "plant") {
    stroke(c1);
    strokeWeight(7);
    noFill();
    bezier(0, s, -s, 0, s, 0, 0, -s);
  }

  if (type === "rock") {
    fill(c1);
    ellipse(0, 0, s * 1.4, s * .8);
  }

  if (type === "mountain") {
    fill(c1);
    triangle(
      -s, s * .6,
      0, -s,
      s, s * .6
    );
  }

  if (type === "light") {
    fill(
      red(c2),
      green(c2),
      blue(c2),
      35
    );
    circle(0, 0, s * 2.3);

    fill(c2);
    circle(0, 0, s * .25);
  }

  pop();
}

function drawStar(x, y, r1, r2, points) {
  beginShape();

  for (let i = 0; i < points * 2; i++) {
    const angle =
      -HALF_PI + i * PI / points;

    const radius =
      i % 2 === 0 ? r2 : r1;

    vertex(
      x + cos(angle) * radius,
      y + sin(angle) * radius
    );
  }

  endShape(CLOSE);
}

/* 3 秒環境特效 */

function startEnvironmentEffect(type, x, y) {
  activeEffects.push({
    type,
    x,
    y,
    start: millis(),
    duration: 3000,
    particles: Array.from(
      {length: 48},
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
      now - effect.start < effect.duration
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
          x += progress * 300 * p.speed -
            150;

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

/* 拖曳作品 */

function mousePressed() {
  if (
    document.querySelector(
      ".modal:not(.hidden)"
    )
  ) return;

  if (
    document.getElementById("sidebar")
      .classList.contains("open")
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

/* 世界清空 */

window.clearMindspaceWorld = function() {
  creations.length = 0;
  environments.length = 0;
  activeEffects.length = 0;

  window.updateMindspaceCount?.(0);
};

/* 視窗大小調整 */

function windowResized() {
  resizeCanvas(
    windowWidth,
    windowHeight
  );

  for (const item of creations) {
    item.x = constrain(
      item.x,
      item.w / 2,
      max(item.w / 2, width - item.w / 2)
    );

    item.baseY = constrain(
      item.baseY,
      item.h / 2,
      max(item.h / 2, height - item.h / 2)
    );
  }
}
