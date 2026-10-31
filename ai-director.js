
"use strict";

/* =========================================================
   MINDSPACE PLUS-PLUS
   AI DIRECTOR

   二評核心：

   1. 孩子是創作者與操作者
   2. AI 負責理解與協助轉譯
   3. 不限制孩子的想像內容
   4. 所有生成視覺保持 Plus-Plus 風格
   5. 原始積木作品永遠保留
   6. 角色、環境、配件與故事持續累積
   7. 角色變身必須作用在原本角色身上

   注意：
   本檔案需要搭配新版 sketch.js
   以及新版 Code.gs。
========================================================= */

(function () {

  /* =======================================================
     01｜Director 狀態
  ======================================================= */

  const director = {

    busy: false,

    queue: [],

    running: false,

    objects: new Map(),

    accessories: new Map(),

    activeAnimations: new Map(),

    currentSpeech: null,

    revision: 0,

    maximumOperations: 40

  };

  /* =======================================================
     02｜基礎工具
  ======================================================= */

  const element = id =>
    document.getElementById(id);

  const number = (
    value,
    fallback = 0
  ) => {
    const result = Number(value);

    return Number.isFinite(result)
      ? result
      : fallback;
  };

  const limit = (
    value,
    minimum,
    maximum
  ) =>
    Math.max(
      minimum,
      Math.min(
        maximum,
        value
      )
    );

  const wait = milliseconds =>
    new Promise(resolve =>
      setTimeout(
        resolve,
        milliseconds
      )
    );

  const makeId = () =>
    "pp_" +
    Date.now().toString(36) +
    "_" +
    Math.random()
      .toString(36)
      .slice(2, 9);

  function findCreation(id) {
    if (!id) {
      return null;
    }

    return creationById(id);
  }

  function getCurrentCreation() {
    return creationById(
      state.selectedId
    );
  }

  function getCreationElement(id) {
    return document.querySelector(
      '[data-creation-id="' +
      id +
      '"]'
    );
  }

  function getObjectElement(id) {
    return document.querySelector(
      '[data-plusplus-object-id="' +
      id +
      '"]'
    );
  }

  function getAccessoryElement(id) {
    return document.querySelector(
      '[data-plusplus-accessory-id="' +
      id +
      '"]'
    );
  }

  function getWorldDimensions() {
    const world =
      element("world");

    return {
      width:
        world?.clientWidth ||
        window.innerWidth,

      height:
        world?.clientHeight ||
        window.innerHeight
    };
  }

  function ensureDirectorLayer() {
    let layer =
      element("plusplusDirectorLayer");

    if (!layer) {
      layer =
        document.createElement("div");

      layer.id =
        "plusplusDirectorLayer";

      layer.style.position =
        "absolute";

      layer.style.inset = "0";

      layer.style.zIndex = "5";

      layer.style.pointerEvents =
        "none";

      element("world")
        ?.appendChild(layer);
    }

    return layer;
  }

  /* =======================================================
     03｜解析 AI 指令

     AI 後端應回傳結構化操作。

     例如：

     {
       reply: "好！你的魚要飛起來了！",
       operations: [
         {
           type: "transform",
           targetId: "...",
           prompt: "..."
         },
         {
           type: "create_accessory",
           targetId: "...",
           prompt: "..."
         },
         {
           type: "move",
           targetId: "...",
           to: { x: 0.7, y: 0.2 }
         }
       ]
     }

     這裡的 type 是程式操作類型，
     不是限制孩子能創造什麼。
  ======================================================= */

  function normalizeOperations(result) {
    if (!result) {
      return [];
    }

    let operations =
      result.operations ||
      result.actions ||
      result.timeline ||
      result.events ||
      [];

    if (
      typeof operations === "string"
    ) {
      try {
        operations =
          JSON.parse(operations);
      } catch (error) {
        operations = [];
      }
    }

    if (
      !Array.isArray(operations)
    ) {
      if (
        operations &&
        typeof operations === "object"
      ) {
        operations = [
          operations
        ];
      } else {
        operations = [];
      }
    }

    return operations
      .filter(
        operation =>
          operation &&
          typeof operation === "object"
      )
      .slice(
        0,
        director.maximumOperations
      );
  }

  /* =======================================================
     04｜AI 指令執行入口
  ======================================================= */

  async function executePlusPlusAIResponse(
    result,
    context = {}
  ) {
    const operations =
      normalizeOperations(
        result
      );

    if (
      operations.length === 0
    ) {
      return;
    }

    const request = {
      id: makeId(),

      operations,

      context,

      createdAt:
        Date.now()
    };

    director.queue.push(
      request
    );

    if (!director.running) {
      await runDirectorQueue();
    }
  }

  /* =======================================================
     05｜故事事件佇列
  ======================================================= */

  async function runDirectorQueue() {
    if (director.running) {
      return;
    }

    director.running = true;

    try {
      while (
        director.queue.length > 0
      ) {
        const request =
          director.queue.shift();

        await executeOperationSequence(
          request.operations,
          request.context
        );
      }
    } finally {
      director.running = false;
    }
  }

  async function executeOperationSequence(
    operations,
    context
  ) {
    for (
      const operation of
      operations
    ) {
      try {
        await executeOneOperation(
          operation,
          context
        );
      } catch (error) {
        console.error(
          "[PlusPlus Director]",
          operation,
          error
        );

        status(
          "⚠️ 有一個想像事件未完成：" +
          error.message
        );
      }
    }
  }

  /* =======================================================
     06｜操作分派器
  ======================================================= */

  async function executeOneOperation(
    operation,
    context = {}
  ) {
    const type =
      String(
        operation.type ||
        operation.action ||
        ""
      ).toLowerCase();

    switch (type) {

      case "transform":
      case "morph":
        return await transformPlusPlusCreation(
          operation,
          context
        );

      case "create_accessory":
      case "attach":
      case "accessory":
        return await createPlusPlusAccessory(
          operation,
          context
        );

      case "create_character":
      case "spawn_character":
        return await createPlusPlusCharacter(
          operation,
          context
        );

      case "create_object":
      case "spawn_object":
      case "create":
        return await createPlusPlusObject(
          operation,
          context
        );

      case "move":
      case "fly":
      case "swim":
      case "walk":
        return await movePlusPlusEntity(
          operation,
          context
        );

      case "rotate":
      case "turn":
        return await rotatePlusPlusEntity(
          operation,
          context
        );

      case "scale":
      case "grow":
      case "shrink":
        return await scalePlusPlusEntity(
          operation,
          context
        );

      case "shake":
      case "pulse":
        return await animatePlusPlusEntity(
          operation,
          context
        );

      case "effect":
      case "emit":
      case "particles":
        return await generatePlusPlusEffect(
          operation,
          context
        );

      case "environment":
      case "change_environment":
      case "generate_environment":
        return await modifyPlusPlusEnvironment(
          operation,
          context
        );

      case "speak":
        return await speakPlusPlusLine(
          operation,
          context
        );

      case "wait":
        return await wait(
          limit(
            number(
              operation.duration,
              500
            ),
            0,
            10000
          )
        );

      case "remove":
        return removeGeneratedPlusPlusObject(
          operation,
          context
        );

      default:
        console.warn(
          "未知 AI 操作：",
          type
        );

        return null;
    }
  }

  /* =======================================================
     07｜解析目標

     targetId 優先，
     其次使用目前選擇的角色。

     避免 AI 改錯角色。
  ======================================================= */

  function resolveTargetId(
    operation,
    context
  ) {
    return (
      operation.targetId ||
      operation.creationId ||
      operation.actorId ||
      context.creationId ||
      state.selectedId ||
      null
    );
  }

  function resolveTargetElement(
    operation,
    context
  ) {
    const id =
      resolveTargetId(
        operation,
        context
      );

    return (
      getCreationElement(id) ||
      getObjectElement(id)
    );
  }

  /* =======================================================
     08｜AI 變身

     核心：
     改變原本積木角色，
     不在旁邊另生一隻取代它。
  ======================================================= */

  async function transformPlusPlusCreation(
    operation,
    context
  ) {
    const targetId =
      resolveTargetId(
        operation,
        context
      );

    const creation =
      findCreation(
        targetId
      );

    if (!creation) {
      throw new Error(
        "找不到要變身的原始積木"
      );
    }

    const prompt =
      String(
        operation.prompt ||
        operation.description ||
        operation.instruction ||
        ""
      );

    if (!prompt.trim()) {
      return;
    }

    bubble(
      "✨ " +
      (
        creation.name ||
        "積木角色"
      ) +
      " 正在變身！"
    );

    const result =
      await callAI(
        "transform",
        {
          image:
            await scaledData(
              creation.originalImage,
              900
            ),

          instruction:
            prompt,

          style:
            PLUSPLUS_STYLE,

          preserveOriginal:
            true,

          modifyExistingCharacter:
            true,

          referenceCreationId:
            creation.id
        },
        240000
      );

    const image =
      normalizeAIImage(
        result
      );

    /*
      永遠不覆蓋 originalImage。
    */

    creation.transformedImage =
      image;

    creation.displayImage =
      image;

    creation.updatedAt =
      Date.now();

    updateCreationVisual(
      creation
    );

    const hero =
      state.heroes.find(
        item =>
          item.id === creation.id
      );

    if (hero) {
      hero.transformedImage =
        image;

      hero.currentImage =
        image;
    }

    return creation;
  }

  /* =======================================================
     09｜AI 生成 Plus-Plus 配件

     配件附著在原始角色身上，
     隨角色移動、旋轉與縮放。
  ======================================================= */

  async function createPlusPlusAccessory(
    operation,
    context
  ) {
    const targetId =
      resolveTargetId(
        operation,
        context
      );

    const creation =
      findCreation(
        targetId
      );

    if (!creation) {
      throw new Error(
        "找不到配件的附著角色"
      );
    }

    const prompt =
      String(
        operation.prompt ||
        operation.description ||
        ""
      );

    if (!prompt) {
      return;
    }

    const result =
      await callAI(
        "generatePlusPlusAsset",
        {
          kind:
            "accessory",

          prompt,

          targetImage:
            await scaledData(
              creation.originalImage,
              800
            ),

          style:
            PLUSPLUS_STYLE,

          transparentBackground:
            true,

          preserveOriginal:
            true
        },
        240000
      );

    const source =
      normalizeAIImage(
        result
      );

    const accessory = {
      id: makeId(),

      targetId,

      image: source,

      description:
        prompt,

      x:
        limit(
          number(
            operation.x,
            0.5
          ),
          -1,
          2
        ),

      y:
        limit(
          number(
            operation.y,
            0.25
          ),
          -1,
          2
        ),

      width:
        limit(
          number(
            operation.width,
            0.6
          ),
          0.05,
          3
        ),

      rotation:
        number(
          operation.rotation,
          0
        ),

      createdAt:
        Date.now()
    };

    state.accessories.push(
      accessory
    );

    creation.accessoryIds.push(
      accessory.id
    );

    director.accessories.set(
      accessory.id,
      accessory
    );

    attachAccessoryVisual(
      accessory
    );

    return accessory;
  }

  /* =======================================================
     09-A｜配件附著圖層
  ======================================================= */

  function attachAccessoryVisual(
    accessory
  ) {
    const parent =
      getCreationElement(
        accessory.targetId
      );

    if (!parent) {
      return;
    }

    const image =
      document.createElement("img");

    image.src =
      accessory.image;

    image.alt =
      accessory.description;

    image.dataset.plusplusAccessoryId =
      accessory.id;

    image.style.position =
      "absolute";

    image.style.left =
      accessory.x * 100 + "%";

    image.style.top =
      accessory.y * 100 + "%";

    image.style.width =
      accessory.width * 100 + "%";

    image.style.height =
      "auto";

    image.style.transform =
      "translate(-50%, -50%) " +
      "rotate(" +
      accessory.rotation +
      "deg)";

    image.style.pointerEvents =
      "none";

    image.style.objectFit =
      "contain";

    parent.appendChild(
      image
    );
  }

  /* =======================================================
     10｜AI 生成 Plus-Plus 配角
  ======================================================= */

  async function createPlusPlusCharacter(
    operation,
    context
  ) {
    const prompt =
      String(
        operation.prompt ||
        operation.description ||
        ""
      );

    if (!prompt) {
      return;
    }

    const result =
      await callAI(
        "generatePlusPlusAsset",
        {
          kind:
            "character",

          prompt,

          style:
            PLUSPLUS_STYLE,

          transparentBackground:
            true,

          world:
            getPlusPlusWorldContext()
        },
        240000
      );

    const image =
      normalizeAIImage(
        result
      );

    const creation =
      createPlusPlusRecord({
        image,

        description:
          prompt,

        source:
          "ai-story"
      });

    creation.role =
      "character";

    creation.name =
      String(
        operation.name ||
        result?.name ||
        "積木配角"
      );

    creation.x =
      limit(
        number(
          operation.x,
          0.5
        ),
        0.1,
        0.9
      );

    creation.y =
      limit(
        number(
          operation.y,
          0.5
        ),
        0.1,
        0.9
      );

    creation.scale =
      limit(
        number(
          operation.scale,
          0.8
        ),
        0.2,
        2
      );

    creation.analysisStatus =
      "completed";

    creation.worldStatus =
      "completed";

    state.creations.push(
      creation
    );

    state.heroes.push({
      id:
        creation.id,

      name:
        creation.name,

      image:
        image,

      originalImage:
        image,

      currentImage:
        image,

      transformedImage:
        null,

      role:
        "character",

      x:
        creation.x,

      y:
        creation.y,

      scale:
        creation.scale
    });

    createCreationVisual(
      creation
    );

    initializeCharacterMotion(
      creation
    );

    refreshHeroes();

    return creation;
  }

  /* =======================================================
     11｜AI 生成物件

     可以是任何孩子描述的物件，
     不限定糖果、星星、球等種類。
  ======================================================= */

  async function createPlusPlusObject(
    operation,
    context
  ) {
    const prompt =
      String(
        operation.prompt ||
        operation.description ||
        ""
      );

    if (!prompt) {
      return;
    }

    const result =
      await callAI(
        "generatePlusPlusAsset",
        {
          kind:
            "object",

          prompt,

          style:
            PLUSPLUS_STYLE,

          transparentBackground:
            true,

          world:
            getPlusPlusWorldContext()
        },
        240000
      );

    const source =
      normalizeAIImage(
        result
      );

    const object = {
      id:
        operation.id ||
        makeId(),

      name:
        String(
          operation.name ||
          "積木物件"
        ),

      description:
        prompt,

      image:
        source,

      x:
        limit(
          number(
            operation.x,
            0.5
          ),
          0,
          1
        ),

      y:
        limit(
          number(
            operation.y,
            0.5
          ),
          0,
          1
        ),

      scale:
        limit(
          number(
            operation.scale,
            1
          ),
          0.1,
          4
        ),

      rotation:
        number(
          operation.rotation,
          0
        ),

      createdAt:
        Date.now()
    };

    state.generatedObjects.push(
      object
    );

    director.objects.set(
      object.id,
      object
    );

    createObjectVisual(
      object
    );

    return object;
  }

  /* =======================================================
     11-A｜物件視覺
  ======================================================= */

  function createObjectVisual(
    object
  ) {
    const layer =
      ensureDirectorLayer();

    if (!layer) {
      return;
    }

    const wrapper =
      document.createElement("div");

    wrapper.dataset.plusplusObjectId =
      object.id;

    wrapper.style.position =
      "absolute";

    wrapper.style.left =
      object.x * 100 + "%";

    wrapper.style.top =
      object.y * 100 + "%";

    wrapper.style.width =
      "min(20vw, 200px)";

    wrapper.style.height =
      "min(20vw, 200px)";

    wrapper.style.transform =
      "translate(-50%, -50%) " +
      "scale(" +
      object.scale +
      ") " +
      "rotate(" +
      object.rotation +
      "deg)";

    wrapper.style.transformOrigin =
      "center center";

    const image =
      document.createElement("img");

    image.src =
      object.image;

    image.alt =
      object.description;

    image.style.width =
      "100%";

    image.style.height =
      "100%";

    image.style.objectFit =
      "contain";

    wrapper.appendChild(
      image
    );

    layer.appendChild(
      wrapper
    );
  }

  /* =======================================================
     12｜角色或物件移動
  ======================================================= */

  async function movePlusPlusEntity(
    operation,
    context
  ) {
    const targetId =
      resolveTargetId(
        operation,
        context
      );

    const creation =
      findCreation(
        targetId
      );

    const object =
      director.objects.get(
        targetId
      );

    const target =
      creation || object;

    if (!target) {
      return;
    }

    const destination =
      operation.to ||
      operation.destination ||
      {};

    const endX =
      limit(
        number(
          destination.x ??
          operation.x,
          target.x
        ),
        0.05,
        0.95
      );

    const endY =
      limit(
        number(
          destination.y ??
          operation.y,
          target.y
        ),
        0.05,
        0.95
      );

    const duration =
      limit(
        number(
          operation.duration,
          1600
        ),
        100,
        20000
      );

    const startX =
      target.x;

    const startY =
      target.y;

    const startTime =
      performance.now();

    const creationElement =
      getCreationElement(
        targetId
      );

    const objectElement =
      getObjectElement(
        targetId
      );

    const visual =
      creationElement ||
      objectElement;

    if (!visual) {
      return;
    }

    /*
      暫停角色自主漫遊，
      避免 AI 動畫與自主移動衝突。
    */

    if (creation) {
      creation.motion =
        creation.motion || {};

      creation.motion.directorControlled =
        true;
    }

    await new Promise(resolve => {
      function frame(now) {
        const progress =
          limit(
            (
              now -
              startTime
            ) / duration,
            0,
            1
          );

        const eased =
          progress *
          progress *
          (
            3 -
            2 * progress
          );

        target.x =
          startX +
          (
            endX -
            startX
          ) * eased;

        target.y =
          startY +
          (
            endY -
            startY
          ) * eased;

        if (creation) {
          updateCreationPosition(
            creation
          );
        } else {
          visual.style.left =
            target.x * 100 + "%";

          visual.style.top =
            target.y * 100 + "%";
        }

        if (progress < 1) {
          requestAnimationFrame(
            frame
          );
        } else {
          resolve();
        }
      }

      requestAnimationFrame(
        frame
      );
    });

    if (creation?.motion) {
      creation.motion.directorControlled =
        false;

      creation.motion.targetX =
        creation.x;

      creation.motion.targetY =
        creation.y;

      creation.motion.nextDecision =
        performance.now() + 2000;
    }
  }

  /* =======================================================
     13｜旋轉
  ======================================================= */

  async function rotatePlusPlusEntity(
    operation,
    context
  ) {
    const targetId =
      resolveTargetId(
        operation,
        context
      );

    const creation =
      findCreation(
        targetId
      );

    const object =
      director.objects.get(
        targetId
      );

    const target =
      creation || object;

    if (!target) {
      return;
    }

    const degrees =
      number(
        operation.rotation ??
        operation.angle,
        90
      );

    target.rotation =
      number(
        target.rotation,
        0
      ) + degrees;

    if (creation) {
      updateCreationPosition(
        creation
      );
    } else {
      updateObjectTransform(
        object
      );
    }
  }

  /* =======================================================
     14｜縮放
  ======================================================= */

  async function scalePlusPlusEntity(
    operation,
    context
  ) {
    const targetId =
      resolveTargetId(
        operation,
        context
      );

    const creation =
      findCreation(
        targetId
      );

    const object =
      director.objects.get(
        targetId
      );

    const target =
      creation || object;

    if (!target) {
      return;
    }

    const scale =
      limit(
        number(
          operation.scale ??
          operation.value,
          1.5
        ),
        0.1,
        5
      );

    target.scale =
      scale;

    if (creation) {
      updateCreationPosition(
        creation
      );
    } else {
      updateObjectTransform(
        object
      );
    }
  }

  /* =======================================================
     14-A｜更新 AI 物件 transform
  ======================================================= */

  function updateObjectTransform(
    object
  ) {
    const visual =
      getObjectElement(
        object.id
      );

    if (!visual) {
      return;
    }

    visual.style.transform =
      "translate(-50%, -50%) " +
      "scale(" +
      object.scale +
      ") " +
      "rotate(" +
      object.rotation +
      "deg)";
  }

  /* =======================================================
     15｜通用角色動畫

     shake / pulse 只是動畫引擎，
     不限制孩子創造的技能類型。
  ======================================================= */

  async function animatePlusPlusEntity(
    operation,
    context
  ) {
    const visual =
      resolveTargetElement(
        operation,
        context
      );

    if (!visual) {
      return;
    }

    const type =
      String(
        operation.type ||
        "pulse"
      );

    const duration =
      limit(
        number(
          operation.duration,
          1000
        ),
        100,
        10000
      );

    const original =
      visual.style.filter;

    if (type === "pulse") {
      visual.animate(
        [
          {
            filter:
              "brightness(1)"
          },
          {
            filter:
              "brightness(1.6)"
          },
          {
            filter:
              "brightness(1)"
          }
        ],
        {
          duration,
          iterations: 1
        }
      );
    } else {
      visual.animate(
        [
          {
            translate:
              "0 0"
          },
          {
            translate:
              "-10px 0"
          },
          {
            translate:
              "10px 0"
          },
          {
            translate:
              "0 0"
          }
        ],
        {
          duration,
          iterations: 1
        }
      );
    }

    await wait(
      duration
    );

    visual.style.filter =
      original;
  }

  /* =======================================================
     16｜AI 自由特效

     AI 可以要求生成任意形狀的
     Plus-Plus 特效素材。

     若後端提供圖片，
     以圖片作為特效粒子。
  ======================================================= */

  async function generatePlusPlusEffect(
    operation,
    context
  ) {
    const prompt =
      String(
        operation.prompt ||
        operation.description ||
        ""
      );

    const targetId =
      resolveTargetId(
        operation,
        context
      );

    const creation =
      findCreation(
        targetId
      ) ||
      getCurrentCreation();

    if (!creation) {
      return;
    }

    let image = null;

    if (prompt) {
      try {
        const result =
          await callAI(
            "generatePlusPlusAsset",
            {
              kind:
                "effect",

              prompt,

              style:
                PLUSPLUS_STYLE,

              transparentBackground:
                true
            },
            240000
          );

        image =
          normalizeAIImage(
            result
          );
      } catch (error) {
        console.warn(
          "特效圖片生成失敗，改用積木粒子",
          error
        );
      }
    }

    const effect = {
      description:
        prompt,

      image,

      count:
        number(
          operation.count,
          35
        ),

      direction:
        operation.direction ||
        "down",

      speed:
        number(
          operation.speed,
          1
        ),

      duration:
        number(
          operation.duration,
          3000
        ),

      colors:
        operation.colors ||
        [
          "#ffb6d5",
          "#a4dfff",
          "#ffe29b"
        ]
    };

    /*
      使用第三段的特效系統。
    */

    playPlusPlusEnvironmentEffect(
      effect,
      creation
    );
  }

  /* =======================================================
     17｜修改環境

     可以讓 AI：
     - 增加建築
     - 延伸地形
     - 改變天空
     - 生成特殊場景
     - 改變原有環境

     不限制固定世界主題。
  ======================================================= */

  async function modifyPlusPlusEnvironment(
    operation,
    context
  ) {
    const prompt =
      String(
        operation.prompt ||
        operation.description ||
        ""
      );

    if (!prompt) {
      return;
    }

    const creation =
      findCreation(
        resolveTargetId(
          operation,
          context
        )
      );

    const result =
      await callAI(
        "generateWorld",
        {
          mode:
            "modify",

          instruction:
            prompt,

          sourceCreationId:
            creation?.id ||
            null,

          world:
            getPlusPlusWorldContext(),

          style:
            PLUSPLUS_STYLE,

          accumulate:
            true,

          preserveExisting:
            true
        },
        240000
      );

    await applyGeneratedWorld(
      result,
      creation || {
        id:
          "voice-environment"
      },
      "environment"
    );
  }

  /* =======================================================
     18｜AI 角色說話
  ======================================================= */

  async function speakPlusPlusLine(
    operation,
    context
  ) {
    const text =
      String(
        operation.text ||
        operation.message ||
        ""
      );

    if (!text) {
      return;
    }

    bubble(text);

    if (state.voiceEnabled) {
      await speak(text);
    }
  }

  /* =======================================================
     19｜移除 AI 生成物件

     不刪除孩子原始積木，
     除非孩子明確使用作品管理刪除。
  ======================================================= */

  function removeGeneratedPlusPlusObject(
    operation,
    context
  ) {
    const id =
      resolveTargetId(
        operation,
        context
      );

    const object =
      director.objects.get(
        id
      );

    if (!object) {
      return;
    }

    getObjectElement(id)
      ?.remove();

    director.objects.delete(
      id
    );

    state.generatedObjects =
      state.generatedObjects.filter(
        item =>
          item.id !== id
      );
  }

  /* =======================================================
     20｜公開 Director API
  ======================================================= */

  window.executePlusPlusAIResponse =
    executePlusPlusAIResponse;

  window.plusPlusDirector = {
    execute:
      executePlusPlusAIResponse,

    transform:
      transformPlusPlusCreation,

    createAccessory:
      createPlusPlusAccessory,

    createCharacter:
      createPlusPlusCharacter,

    createObject:
      createPlusPlusObject,

    move:
      movePlusPlusEntity,

    effect:
      generatePlusPlusEffect,

    modifyEnvironment:
      modifyPlusPlusEnvironment,

    getState: () => ({
      running:
        director.running,

      queued:
        director.queue.length,

      objects:
        director.objects.size,

      accessories:
        director.accessories.size
    })
  };

  console.log(
    "🧩 Mindspace Plus-Plus AI Director 已載入"
  );

})();
