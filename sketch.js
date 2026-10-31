
/*
 * Mindspace Plus-Plus
 * sketch.js｜互動世界 v1
 *
 * 功能：
 * - p5.js 全螢幕世界
 * - 接收去背 PNG
 * - 多個作品持續共存
 * - 每個作品獨立漂浮與活動
 * - 不因新增作品清空世界
 *
 * 目前尚未接入 AI 角色／環境分類。
 */

const creations = [];

let bubbles = [];
let worldTime = 0;

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
    bubbles.push(makeBubble());
  }

  window.updateMindspaceCount?.(0);
}

function makeBubble() {
  return {
    x: random(width),
    y: random(height),
    r: random(3, 14),
    speed: random(.25, 1.1),
    alpha: random(35, 110)
  };
}

function draw() {
  worldTime += .01;

  drawBackground();
  drawBubbles();
  drawGround();

  for (const creation of creations) {
    updateCreation(creation);
    drawCreation(creation);
  }
}

/*
 * 目前使用中性的數位世界。
 * 後續由 AI 根據角色或環境改變。
 */
function drawBackground() {
  const topColor = color(141, 221, 239);
  const bottomColor = color(23, 83, 139);

  for (let y = 0; y < height; y += 5) {
    const t = y / height;

    stroke(lerpColor(topColor, bottomColor, t));
    strokeWeight(5);
    line(0, y, width, y);
  }

  noStroke();

  // 柔和的光線
  fill(255, 255, 255, 13);

  for (let i = 0; i < 7; i++) {
    const x = width * (i / 6);
    const drift = sin(worldTime + i) * 30;

    triangle(
      x + drift, 0,
      x + drift - 110, height,
      x + drift + 110, height
    );
  }
}

function drawBubbles() {
  for (const b of bubbles) {
    b.y -= b.speed;
    b.x += sin(worldTime + b.y * .01) * .12;

    if (b.y < -20) {
      b.y = height + 20;
      b.x = random(width);
    }

    fill(255, 255, 255, b.alpha);
    circle(b.x, b.y, b.r);
  }
}

function drawGround() {
  fill(14, 66, 105, 70);

  ellipse(
    width / 2,
    height + 35,
    width * 1.5,
    190
  );

  fill(255, 255, 255, 15);

  for (let i = 0; i < 12; i++) {
    const x = i * width / 11;

    ellipse(
      x,
      height - 35 + sin(i) * 12,
      70,
      10
    );
  }
}

/*
 * 接收透明 PNG。
 *
 * 成功載入後才加入 creations。
 * 不會清空既有作品。
 */
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

        const itemWidth = img.width * scale;
        const itemHeight = img.height * scale;

        const item = {
          id: crypto.randomUUID(),
          img: img,

          x: random(
            itemWidth / 2 + 20,
            max(itemWidth / 2 + 21,
                width - itemWidth / 2 - 20)
          ),

          y: random(
            max(100, itemHeight / 2 + 30),
            max(101, height - itemHeight / 2 - 50)
          ),

          baseY: 0,
          w: itemWidth,
          h: itemHeight,

          vx: random(-.65, .65),
          phase: random(TWO_PI),
          floatSpeed: random(.8, 1.5),
          floatRange: random(5, 15),

          rotation: random(-.05, .05),
          rotationSpeed: random(-.002, .002),

          selected: false,

          // STEP 04 後續會使用
          kind: "unclassified",
          description: ""
        };

        item.baseY = item.y;

        creations.push(item);

        window.updateMindspaceCount?.(
          creations.length
        );

        resolve(item.id);
      },
      error => {
        reject(
          new Error("p5.js 無法載入去背圖片")
        );
      }
    );
  });
};

/*
 * 每個作品獨立移動。
 *
 * 現在是基礎漂浮行為。
 * 後續依 AI 角色特質調整。
 */
function updateCreation(c) {
  c.x += c.vx;
  c.phase += .015 * c.floatSpeed;
  c.rotation += c.rotationSpeed;

  const margin = c.w / 2 + 15;

  if (c.x < margin) {
    c.x = margin;
    c.vx = abs(c.vx);
  }

  if (c.x > width - margin) {
    c.x = width - margin;
    c.vx = -abs(c.vx);
  }

  c.y =
    c.baseY +
    sin(c.phase) * c.floatRange;
}

function drawCreation(c) {
  push();

  translate(c.x, c.y);
  rotate(sin(c.rotation) * .06);

  // 輕微陰影
  drawingContext.shadowColor =
    "rgba(0,0,0,.24)";

  drawingContext.shadowBlur = 16;
  drawingContext.shadowOffsetY = 9;

  image(
    c.img,
    0,
    0,
    c.w,
    c.h
  );

  pop();
}

/*
 * 清空世界：
 * 只在孩子明確按下清空按鈕時執行。
 */
window.clearMindspaceWorld = function() {
  creations.length = 0;
  window.updateMindspaceCount?.(0);
};

/*
 * 保留作品並調整畫布。
 */
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  for (const c of creations) {
    c.x = constrain(
      c.x,
      c.w / 2,
      max(c.w / 2, width - c.w / 2)
    );

    c.baseY = constrain(
      c.baseY,
      c.h / 2,
      max(c.h / 2, height - c.h / 2)
    );
  }
}

/*
 * 允許滑鼠拖曳積木。
 */
let dragging = null;
let dragDX = 0;
let dragDY = 0;

function mousePressed() {
  // 不攔截工作台與視窗操作
  if (document.querySelector(".modal:not(.hidden)")) {
    return;
  }

  if (
    document.getElementById("sidebar")
      .classList.contains("open")
  ) {
    return;
  }

  for (let i = creations.length - 1; i >= 0; i--) {
    const c = creations[i];

    if (
      mouseX > c.x - c.w / 2 &&
      mouseX < c.x + c.w / 2 &&
      mouseY > c.y - c.h / 2 &&
      mouseY < c.y + c.h / 2
    ) {
      dragging = c;
      dragDX = mouseX - c.x;
      dragDY = mouseY - c.y;
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
