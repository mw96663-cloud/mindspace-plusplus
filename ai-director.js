
/**
 * Plus-Plus AI Director v2
 *
 * 負責將 AI 的 JSON 決策
 * 轉換為真實的 p5.js 世界操作。
 */

window.PPDirector = (() => {
  "use strict";

  const MOVEMENTS = [
    "float",
    "walk",
    "fly",
    "swim",
    "bounce",
    "glide"
  ];

  const EFFECTS = [
    "sparkle",
    "snow",
    "leaves",
    "bubbles",
    "fireflies",
    "fireworks",
    "glow"
  ];

  function findHero(name) {
    if (!S.heroes.length) {
      return null;
    }

    const target =
      String(name || "").trim();

    if (target) {
      const exact = S.heroes.find(
        h => h.name === target
      );

      if (exact) return exact;

      const partial = S.heroes.find(
        h =>
          h.name.includes(target) ||
          target.includes(h.name)
      );

      if (partial) return partial;
    }

    return getSelectedHero();
  }

  function safeMovement(value) {
    return MOVEMENTS.includes(value)
      ? value
      : "float";
  }

  function safeEffect(value) {
    return EFFECTS.includes(value)
      ? value
      : "sparkle";
  }

  function announce(reply, hero = null) {
    if (!reply) return;

    speak(reply, hero);
  }

  function changeMovement(
    hero,
    movement
  ) {
    if (!hero) return false;

    hero.movement =
      safeMovement(movement);

    hero.phase =
      Math.random() * Math.PI * 2;

    if (hero.movement === "fly") {
      hero.baseY = .42;
    } else if (hero.movement === "swim") {
      hero.baseY = .62;
    } else if (hero.movement === "walk") {
      hero.baseY = .77;
    } else if (hero.movement === "bounce") {
      hero.baseY = .7;
    } else {
      hero.baseY = .65;
    }

    hero.y = hero.baseY;

    updateCharacterList();

    emitParticles(
      hero.x * width,
      hero.y * height,
      35
    );

    return true;
  }

  function moveHero(hero) {
    if (!hero) return false;

    hero.direction *= -1;

    hero.speedMultiplier =
      Math.min(
        2.2,
        (hero.speedMultiplier || 1) + .3
      );

    emitParticles(
      hero.x * width,
      hero.y * height,
      18
    );

    return true;
  }

  function changeSize(hero, size) {
    if (!hero) return false;

    const next = Number(size);

    if (!Number.isFinite(next)) {
      return false;
    }

    hero.scale = clamp(
      next,
      .5,
      2
    );

    emitParticles(
      hero.x * width,
      hero.y * height,
      30
    );

    return true;
  }

  function changeColor(hero, colorName) {
    if (!hero) return false;

    // 保留實體積木原始照片，不直接覆蓋像素顏色。
    // 顏色變化先以周圍光點表現，
    // 避免破壞實體作品的辨識度。
    const colorMap = {
      red: "#ff8b8b",
      blue: "#91c8ff",
      green: "#9de0b4",
      yellow: "#ffe08b",
      purple: "#c9b0ff",
      pink: "#ffb7d5",
      orange: "#ffc18c",
      紅色: "#ff8b8b",
      藍色: "#91c8ff",
      綠色: "#9de0b4",
      黃色: "#ffe08b",
      紫色: "#c9b0ff",
      粉紅色: "#ffb7d5",
      橘色: "#ffc18c"
    };

    const selectedColor =
      colorMap[colorName] ||
      "#ffffff";

    for (let i = 0; i < 45; i++) {
      const angle =
        Math.random() * Math.PI * 2;

      const radius =
        Math.random() * 80;

      S.particles.push({
        x:
          hero.x * width +
          Math.cos(angle) * radius,
        y:
          hero.y * height +
          Math.sin(angle) * radius,
        vx:
          Math.cos(angle) *
          (1 + Math.random() * 2),
        vy:
          Math.sin(angle) *
          (1 + Math.random() * 2),
        size: 5 + Math.random() * 9,
        life: 1500,
        maxLife: 1500,
        color: selectedColor,
        shape: "plus"
      });
    }

    return true;
  }

  async function regenerateWorld(decision) {
    const prompt = String(
      decision.worldPrompt || ""
    ).trim();

    if (!prompt) {
      throw new Error(
        "AI 沒有提供新的背景描述"
      );
    }

    const info = {
      name:
        decision.name ||
        S.worldName,
      description:
        prompt,
      worldName:
        decision.name ||
        "新的想像世界",
      worldPrompt:
        prompt
    };

    let result;

    if (
      S.sceneOriginalData &&
      S.creationImage &&
      S.creationInfo?.kind ===
        "environment"
    ) {
      result = await callAI(
        "generateScene",
        {
          image: S.creationImage,
          info
        },
        180000
      );
    } else {
      result = await callAI(
        "generateWorld",
        { info },
        180000
      );
    }

    await setWorldImage(
      result.image,
      info.worldName
    );

    S.worldPrompt = prompt;

    startSceneEffect(
      safeEffect(
        decision.effect
      )
    );
  }

  async function addCharacter(decision) {
    const description = String(
      decision.characterDescription ||
      decision.name ||
      "一隻友善的幻想生物"
    );

    const result = await callAI(
      "generateCharacter",
      { description },
      180000
    );

    if (!result || !result.image) {
      throw new Error(
        "AI 沒有回傳新角色圖片"
      );
    }

    const img =
      await loadImageAsync(
        result.image
      );

    const hero = {
      id: uid(),

      name:
        decision.name ||
        "新朋友",

      description,
      image: img,
      imageData: result.image,

      x: .3 + Math.random() * .4,
      y: .65,
      baseY: .65,

      size: 240,
      scale: 1,
      direction: 1,

      speed: .000075,
      speedMultiplier: 1,

      movement:
        safeMovement(
          decision.movement
        ),

      phase:
        Math.random() *
        Math.PI * 2,

      entering: false,
      speech: "",
      speechUntil: 0,

      created:
        performance.now()
    };

    S.heroes.push(hero);
    S.selectedId = hero.id;

    updateCharacterList();

    emitParticles(
      hero.x * width,
      hero.y * height,
      60
    );

    return hero;
  }

  async function execute(decision) {
    if (
      !decision ||
      typeof decision !== "object"
    ) {
      throw new Error(
        "AI 導演沒有回傳有效指令"
      );
    }

    const action =
      String(
        decision.action || "none"
      );

    const hero = findHero(
      decision.target
    );

    let speakingHero = hero;
    let completed = false;

    switch (action) {
      case "move":
        completed = moveHero(hero);
        break;

      case "changeMovement":
        completed = changeMovement(
          hero,
          decision.movement
        );
        break;

      case "effect":
        startSceneEffect(
          safeEffect(
            decision.effect
          )
        );
        completed = true;
        break;

      case "regenerateWorld":
        await regenerateWorld(
          decision
        );
        completed = true;
        break;

      case "changeWorldName":
        if (decision.name) {
          S.worldName =
            String(decision.name);

          $("worldTitle").textContent =
            "✨ " + S.worldName;

          completed = true;
        }
        break;

      case "addCharacter":
        speakingHero =
          await addCharacter(
            decision
          );

        completed = true;
        break;

      case "changeSize":
        completed = changeSize(
          hero,
          decision.size
        );
        break;

      case "changeColor":
        completed = changeColor(
          hero,
          decision.color
        );
        break;

      case "none":
      default:
        completed = true;
        break;
    }

    const reply = String(
      decision.reply || ""
    ).trim();

    if (!completed) {
      announce(
        "我聽到你的想法了，" +
        "但目前還沒有可以操作的角色。" +
        "我們可以先拍一張積木照片！"
      );

      return;
    }

    announce(
      reply ||
      "好呀！我們再一起看看這個世界會怎麼變化。",
      speakingHero
    );
  }

  return {
    execute,
    findHero,
    changeMovement,
    moveHero,
    changeSize,
    addCharacter
  };
})();
