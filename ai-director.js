
/**
 * Plus-Plus Layered AI Director v3
 */

window.PPDirector = (() => {
  "use strict";

  function getPlacement(value) {
    return accessoryPlacement(value || "front");
  }

  function targetHero(decision) {
    return findHero(String(decision.target || ""));
  }

  function movement(value) {
    const allowed = [
      "float", "walk", "fly",
      "swim", "bounce", "glide"
    ];

    return allowed.includes(value) ? value : "float";
  }

  function setMovement(hero, value) {
    if (!hero) return false;

    hero.movement = movement(value);

    const y = {
      fly: .42,
      swim: .62,
      walk: .76,
      bounce: .7,
      float: .65,
      glide: .48
    };

    hero.baseY = y[hero.movement];
    hero.y = hero.baseY;

    burst(hero.x * width, hero.y * height, 30);
    return true;
  }

  /* ===================================
     新增 Plus-Plus 造型圖層
  =================================== */

  async function addAccessory(decision) {
    const hero = targetHero(decision);

    if (!hero) {
      throw new Error(
        "目前沒有角色，請先拍攝積木角色。"
      );
    }

    const description = String(
      decision.description ||
      decision.name ||
      "a colorful fantasy accessory"
    );

    busy(
      true,
      "🧩 正在為「" + hero.name +
      "」製作新的 Plus-Plus 積木造型……"
    );

    const result = await ai(
      "generateAccessory",
      {
        description,
        originalDescription: hero.description
      },
      180000
    );

    const image = await loadPicture(result.image);

    const preset = getPlacement(
      decision.placement
    );

    const name =
      String(decision.name || "新造型");

    const isWing =
      /wing|翅膀|羽翼/i.test(
        name + " " + description
      );

    const part = {
      id: uid(),
      name,
      description,
      image,
      imageData: result.image,

      // 獨立圖層，不修改 hero.original
      layer: preset.layer,
      position: {
        x: preset.position.x,
        y: preset.position.y
      },
      scale: preset.scale,

      animate: isWing ? "flap" : "none"
    };

    hero.accessories.push(part);

    updateHeroList();

    burst(
      hero.x * width,
      hero.y * height,
      65,
      "#d8c4ff"
    );

    confirmSound();

    // 若長輩同時說要飛起來，能力同步改變
    if (
      decision.movement === "fly" ||
      (isWing &&
       /fly|flying|飛/i.test(
         String(decision.description || "") +
         String(decision.reply || "")
       ))
    ) {
      setMovement(hero, "fly");
    }

    return hero;
  }

  /* ===================================
     移除新增造型，不影響原始角色
  =================================== */

  function removeAccessory(decision) {
    const hero = targetHero(decision);

    if (!hero) return false;

    const name = String(decision.name || "").trim();

    if (!name) {
      const removed = hero.accessories.pop();

      updateHeroList();

      return !!removed;
    }

    const index = hero.accessories.findIndex(
      a => a.name.includes(name) ||
        name.includes(a.name)
    );

    if (index < 0) return false;

    hero.accessories.splice(index, 1);

    updateHeroList();

    burst(
      hero.x * width,
      hero.y * height,
      25
    );

    return true;
  }

  /* ===================================
     新增 Plus-Plus 背景物件
  =================================== */

  async function addEnvironmentObject(decision) {
    const description = String(
      decision.description ||
      decision.name ||
      "a colorful tree"
    );

    busy(
      true,
      "🌳 正在為世界增加新的 Plus-Plus 積木物件……"
    );

    const result = await ai(
      "generateEnvironmentObject",
      { description },
      180000
    );

    const img = await loadPicture(result.image);

    const count = S.environmentObjects.length;

    const locations = [
      {x: .22, y: .69},
      {x: .78, y: .67},
      {x: .35, y: .78},
      {x: .66, y: .78},
      {x: .5, y: .47}
    ];

    const pos = locations[count % locations.length];

    const obj = {
      id: uid(),
      name: String(decision.name || "新物件"),
      description,
      image: img,
      imageData: result.image,

      x: pos.x,
      y: pos.y,
      size: .28,
      phase: Math.random() * Math.PI * 2
    };

    S.environmentObjects.push(obj);

    burst(
      obj.x * width,
      obj.y * height,
      55,
      "#b8e7cb"
    );

    confirmSound();

    return obj;
  }

  /* ===================================
     重新生成周圍背景
     原始積木圖層不會被修改
  =================================== */

  async function regenerateWorld(decision) {
    const prompt = String(
      decision.worldPrompt ||
      decision.description ||
      ""
    ).trim();

    if (!prompt) {
      throw new Error(
        "AI 沒有提供新背景描述"
      );
    }

    busy(
      true,
      "🌈 正在改變周圍的 Plus-Plus 世界……"
    );

    const info = {
      name: decision.name || S.worldName,
      worldName: decision.name || S.worldName,
      worldPrompt: prompt,
      description: prompt
    };

    let result;

    if (
      S.originalScene &&
      S.lastPhoto
    ) {
      result = await ai(
        "generateEnvironmentLayer",
        {
          image: S.lastPhoto,
          info
        },
        180000
      );
    } else {
      result = await ai(
        "generateWorld",
        { info },
        180000
      );
    }

    await setWorld(
      result.image,
      info.worldName
    );

    S.worldPrompt = prompt;

    effect(decision.effect || "sparkle");
  }

  /* ===================================
     新增另一個獨立角色
  =================================== */

  async function addCharacter(decision) {
    busy(
      true,
      "🧩 正在創造新的 Plus-Plus 朋友……"
    );

    const result = await ai(
      "generateCharacter",
      {
        description: decision.description ||
          decision.name ||
          "a friendly creature"
      },
      180000
    );

    const img = await loadPicture(result.image);

    const hero = {
      id: uid(),
      name: decision.name || "新朋友",
      description: decision.description || "",

      original: img,
      originalData: result.image,

      accessories: [],

      x: .3 + Math.random() * .4,
      y: .67,
      baseY: .67,
      size: 270,
      scale: 1,
      direction: 1,
      speed: .00007,
      movement: movement(decision.movement),
      phase: Math.random() * Math.PI * 2,

      entering: false,
      speech: "",
      speechUntil: 0
    };

    S.heroes.push(hero);
    S.selectedId = hero.id;

    updateHeroList();

    burst(
      hero.x * width,
      hero.y * height,
      55
    );

    return hero;
  }

  /* ===================================
     語音動作分流
  =================================== */

  async function execute(decision) {
    if (!decision || typeof decision !== "object") {
      throw new Error("AI 沒有回傳有效操作指令");
    }

    const action = String(decision.action || "none");
    let hero = targetHero(decision);

    switch (action) {
      case "addAccessory":
        hero = await addAccessory(decision);
        break;

      case "removeAccessory":
        if (!removeAccessory(decision)) {
          throw new Error("找不到要移除的造型");
        }
        break;

      case "addEnvironmentObject":
        await addEnvironmentObject(decision);
        hero = null;
        break;

      case "regenerateWorld":
        await regenerateWorld(decision);
        hero = null;
        break;

      case "addCharacter":
        hero = await addCharacter(decision);
        break;

      case "changeMovement":
        if (!setMovement(hero, decision.movement)) {
          throw new Error("目前沒有可以操作的角色");
        }
        break;

      case "move":
        if (!hero) {
          throw new Error("目前沒有角色");
        }

        hero.direction *= -1;
        burst(hero.x * width, hero.y * height, 25);
        break;

      case "changeSize":
        if (!hero) {
          throw new Error("目前沒有角色");
        }

        hero.scale = clamp(
          Number(decision.size) || 1,
          .5,
          2
        );

        burst(hero.x * width, hero.y * height, 30);
        break;

      case "effect":
        effect(decision.effect || "sparkle");
        break;

      case "none":
      default:
        break;
    }

    speak(
      decision.reply ||
      "你的想像已經加入世界了！接下來還想創造什麼呢？",
      hero
    );
  }

  return {
    execute,
    addAccessory,
    removeAccessory,
    addEnvironmentObject,
    regenerateWorld
  };
})();
