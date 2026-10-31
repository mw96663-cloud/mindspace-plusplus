
"use strict";

/*
============================================================
Mindspace Plus-Plus
ai-director.js

功能：
1. 長輩語音輸入
2. 錄音並送至 OpenAI 語音辨識
3. AI 理解自由口述
4. AI 多步驟規劃世界變化
5. 新增 Plus-Plus 角色
6. 新增 Plus-Plus 場景物件
7. 角色造型 / 配件變化
8. 角色移動方式改變
9. 技能與動態特效
10. 故事與角色互動
11. AI 自然語音回應
12. 角色主動歡迎與後續引導

依賴：
- sketch.js
- Code.gs
- Bridge.html

API Key 不得放在此檔案。
============================================================
*/

(() => {

  const $ = (id) => document.getElementById(id);

  const DIRECTOR_CONFIG = {
    RECORDING_MAX_MS: 30000,

    MIN_RECORDING_MS: 350,

    TRANSCRIBE_TIMEOUT: 90000,

    DIRECTOR_TIMEOUT: 90000,

    IMAGE_TIMEOUT: 180000,

    SPEECH_TIMEOUT: 90000,

    MAX_OPERATIONS: 8,

    DEFAULT_VOICE: "nova",

    DEFAULT_LANGUAGE: "zh-TW"
  };

  const directorState = {
    initialized: false,

    recording: false,

    processing: false,

    microphoneStream: null,

    mediaRecorder: null,

    recordingChunks: [],

    recordingStartedAt: 0,

    recordingTimer: null,

    speechEnabled: true,

    currentAudio: null,

    currentAudioUrl: null,

    currentSpeechRequest: 0,

    conversation: [],

    story: [],

    lastTranscript: "",

    lastReply: "",

    generationCount: 0
  };

  /* =======================================================
     基本工具
  ======================================================= */

  function safeText(value, fallback = "") {
    return typeof value === "string" && value.trim()
      ? value.trim()
      : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function delay(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  function setText(id, value) {
    const element = $(id);

    if (element) {
      element.textContent = String(value || "");
    }
  }

  function getWorld() {
    if (!window.MindspaceWorld) {
      throw new Error(
        "MindspaceWorld 尚未載入，請確認 sketch.js 已正確載入。"
      );
    }

    return window.MindspaceWorld;
  }

  function getWorldState() {
    return getWorld().state;
  }

  function callAI(type, data, timeout) {
    return getWorld().callAI(
      type,
      data,
      timeout
    );
  }

  function normalizeResult(result) {
    if (result && result.ok === false) {
      throw new Error(
        result.error ||
        result.message ||
        "AI 後端執行失敗"
      );
    }

    if (
      result &&
      result.ok === true &&
      Object.prototype.hasOwnProperty.call(
        result,
        "result"
      )
    ) {
      return result.result;
    }

    return result;
  }

  function reportError(error) {
    const message = error instanceof Error
      ? error.message
      : String(error);

    console.error(
      "[Mindspace AI Director]",
      error
    );

    setText(
      "aiReply",
      "❌ " + message
    );

    setText(
      "voiceStatus",
      "操作失敗，請再試一次"
    );

    return message;
  }

  function updateBubble(message) {
    getWorld().updateSpeechBubble(message);
  }

  function setProcessing(processing) {
    directorState.processing = Boolean(processing);

    const ids = [
      "voiceButton",
      "workbenchVoiceButton",
      "sendTextCommand"
    ];

    for (const id of ids) {
      const button = $(id);

      if (button) {
        button.disabled = processing;
      }
    }

    if (processing) {
      setText(
        "voiceStatus",
        "AI 正在理解你的想像……"
      );
    } else if (!directorState.recording) {
      setText(
        "voiceStatus",
        "點擊麥克風，開始創作"
      );
    }
  }

  /* =======================================================
     音訊處理
  ======================================================= */

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = String(reader.result || "");

        const commaIndex = result.indexOf(",");

        if (commaIndex < 0) {
          reject(
            new Error("音訊轉換失敗")
          );
          return;
        }

        resolve({
          base64: result.slice(commaIndex + 1),
          mimeType: blob.type || "audio/webm"
        });
      };

      reader.onerror = () => {
        reject(
          new Error("無法讀取錄音資料")
        );
      };

      reader.readAsDataURL(blob);
    });
  }

  function chooseRecordingMimeType() {
    if (
      typeof MediaRecorder === "undefined"
    ) {
      return "";
    }

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus"
    ];

    for (const mimeType of candidates) {
      if (
        MediaRecorder.isTypeSupported(mimeType)
      ) {
        return mimeType;
      }
    }

    return "";
  }

  function stopMicrophoneTracks() {
    const stream =
      directorState.microphoneStream;

    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }

    directorState.microphoneStream = null;
  }

  function updateRecordingButtons(recording) {
    const mainButton = $("voiceButton");

    const workbenchButton =
      $("workbenchVoiceButton");

    if (mainButton) {
      mainButton.classList.toggle(
        "recording",
        recording
      );

      mainButton.textContent = recording
        ? "⏹"
        : "🎤";

      mainButton.title = recording
        ? "停止錄音並送出"
        : "開始語音創作";
    }

    if (workbenchButton) {
      workbenchButton.textContent = recording
        ? "⏹ 停止錄音並送出"
        : "🎤 開始語音創作";
    }
  }

  /* =======================================================
     開始錄音
  ======================================================= */

  async function startRecording() {
    if (
      directorState.processing ||
      directorState.recording
    ) {
      return;
    }

    try {
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        throw new Error(
          "瀏覽器不支援麥克風，或網站不是 HTTPS。"
        );
      }

      if (
        typeof MediaRecorder === "undefined"
      ) {
        throw new Error(
          "此瀏覽器不支援 MediaRecorder 錄音。"
        );
      }

      stopSpeaking();

      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },
          video: false
        });

      directorState.microphoneStream = stream;

      directorState.recordingChunks = [];

      const mimeType =
        chooseRecordingMimeType();

      const recorder = mimeType
        ? new MediaRecorder(
            stream,
            { mimeType }
          )
        : new MediaRecorder(stream);

      directorState.mediaRecorder = recorder;

      recorder.ondataavailable = (event) => {
        if (
          event.data &&
          event.data.size > 0
        ) {
          directorState.recordingChunks.push(
            event.data
          );
        }
      };

      recorder.onerror = (event) => {
        console.error(
          "MediaRecorder error",
          event
        );

        stopMicrophoneTracks();

        directorState.recording = false;

        updateRecordingButtons(false);

        reportError(
          new Error("錄音發生錯誤")
        );
      };

      recorder.onstop = async () => {
        stopMicrophoneTracks();

        directorState.recording = false;

        updateRecordingButtons(false);

        if (directorState.recordingTimer) {
          clearTimeout(
            directorState.recordingTimer
          );

          directorState.recordingTimer = null;
        }

        const elapsed =
          Date.now() -
          directorState.recordingStartedAt;

        const blob = new Blob(
          directorState.recordingChunks,
          {
            type:
              recorder.mimeType ||
              "audio/webm"
          }
        );

        directorState.recordingChunks = [];

        if (
          elapsed <
            DIRECTOR_CONFIG.MIN_RECORDING_MS ||
          blob.size < 100
        ) {
          setText(
            "voiceStatus",
            "錄音太短，請再試一次"
          );

          return;
        }

        try {
          await processRecordedAudio(blob);
        } catch (error) {
          reportError(error);
        }
      };

      recorder.start(250);

      directorState.recording = true;

      directorState.recordingStartedAt =
        Date.now();

      updateRecordingButtons(true);

      setText(
        "voiceStatus",
        "正在聆聽……再按一次送出"
      );

      directorState.recordingTimer =
        setTimeout(() => {
          stopRecording();
        }, DIRECTOR_CONFIG.RECORDING_MAX_MS);

    } catch (error) {
      stopMicrophoneTracks();

      directorState.recording = false;

      updateRecordingButtons(false);

      reportError(error);
    }
  }

  /* =======================================================
     停止錄音
  ======================================================= */

  function stopRecording() {
    if (!directorState.recording) {
      return;
    }

    const recorder =
      directorState.mediaRecorder;

    if (
      recorder &&
      recorder.state !== "inactive"
    ) {
      recorder.stop();
    }
  }

  function toggleRecording() {
    if (directorState.recording) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  /* =======================================================
     語音辨識
  ======================================================= */

  async function processRecordedAudio(blob) {
    setProcessing(true);

    try {
      setText(
        "voiceStatus",
        "正在辨識你的聲音……"
      );

      const audio =
        await blobToBase64(blob);

      const result = await callAI(
        "transcribe",
        {
          audio: audio.base64,

          mimeType: audio.mimeType,

          language: "zh",

          prompt:
            "這是長輩使用繁體中文描述 Plus-Plus " +
            "積木、角色、造型、技能、場景與故事的語音。"
        },
        DIRECTOR_CONFIG.TRANSCRIBE_TIMEOUT
      );

      const data = normalizeResult(result);

      const transcript =
        typeof data === "string"
          ? data
          : safeText(
              data.text ||
              data.transcript
            );

      if (!transcript) {
        throw new Error(
          "AI 沒有辨識到語音內容，請再說一次。"
        );
      }

      directorState.lastTranscript =
        transcript;

      setText(
        "aiReply",
        "你說：「" + transcript + "」"
      );

      await processUserCommand(
        transcript,
        true
      );
    } finally {
      setProcessing(false);
    }
  }

  /* =======================================================
     世界上下文

     AI 必須知道目前有哪些角色、
     哪個角色正在被選取、
     世界是角色模式還是場景模式。
  ======================================================= */

  function buildWorldContext() {
    const state = getWorldState();

    const activeHero =
      getWorld().getActiveHero();

    return {
      mode:
        state.currentMode || "empty",

      worldName:
        state.currentWorld &&
        state.currentWorld.name,

      worldDescription:
        state.currentWorld &&
        state.currentWorld.description,

      originalAnalysis:
        state.currentAnalysis,

      activeHeroId:
        activeHero ? activeHero.id : null,

      activeHero:
        activeHero
          ? {
              id: activeHero.id,
              name: activeHero.name,
              movement: activeHero.movement,
              personality: activeHero.personality,
              isOriginal: activeHero.isOriginal,
              accessories:
                activeHero.accessories.map(
                  (item) => item.name
                ),
              skills:
                activeHero.skills
            }
          : null,

      heroes:
        state.heroes.map((hero) => ({
          id: hero.id,
          name: hero.name,
          movement: hero.movement,
          personality: hero.personality,
          isOriginal: hero.isOriginal,
          skills: hero.skills,
          accessories:
            hero.accessories.map(
              (item) => item.name
            )
        })),

      worldObjects:
        state.worldObjects.map(
          (item) => ({
            id: item.id,
            name: item.name
          })
        ),

      recentConversation:
        directorState.conversation.slice(-10),

      recentStory:
        directorState.story.slice(-6)
    };
  }

  /* =======================================================
     AI Director 規劃

     這裡不使用中文關鍵字判斷指令。
     由後端 AI 理解長輩語意，回傳結構化操作。

     支援操作：
     add_character
     add_object
     add_accessory
     change_movement
     add_skill
     play_effect
     change_background
     story_event
     speak
  ======================================================= */

  async function requestDirectorPlan(text) {
    const result = await callAI(
      "directWorld",
      {
        message: text,

        context: buildWorldContext(),

        style:
          "All newly generated visual elements " +
          "must look physically constructed from " +
          "authentic Plus-Plus interlocking " +
          "plastic construction toy pieces.",

        instructions:
          "Understand the older adult's free-form " +
          "creative intent. Preserve the original " +
          "physical creation. Return a JSON plan " +
          "with a natural Traditional Chinese reply " +
          "and executable operations. " +
          "Support multiple operations from one " +
          "utterance. Do not require fixed keywords."
      },
      DIRECTOR_CONFIG.DIRECTOR_TIMEOUT
    );

    const data = normalizeResult(result);

    if (!data || typeof data !== "object") {
      throw new Error(
        "AI 沒有回傳有效的互動計畫。"
      );
    }

    const operations = Array.isArray(
      data.operations
    )
      ? data.operations
      : [];

    return {
      reply: safeText(
        data.reply ||
        data.message,
        "好呀！我們一起讓這個世界更有趣！"
      ),

      operations:
        operations.slice(
          0,
          DIRECTOR_CONFIG.MAX_OPERATIONS
        ),

      story:
        data.story || null
    };
  }

  /* =======================================================
     AI 圖像生成共用方法
  ======================================================= */

  async function generateVisual(
    requestType,
    data
  ) {
    const result = await callAI(
      requestType,
      {
        ...data,

        style:
          "Authentic Plus-Plus interlocking " +
          "construction toy pieces. " +
          "Clearly recognizable double-plus " +
          "plastic building pieces. " +
          "Colorful, playful, dimensional. " +
          "No text, no watermark."
      },
      DIRECTOR_CONFIG.IMAGE_TIMEOUT
    );

    return getWorld().extractImage(result);
  }

  /* =======================================================
     新增 AI 角色
  ======================================================= */

  async function executeAddCharacter(op) {
    setText(
      "voiceStatus",
      "正在創造新的積木朋友……"
    );

    const image = await generateVisual(
      "generateCharacter",
      {
        description:
          op.description ||
          op.prompt ||
          op.name ||
          "friendly imaginary creature",

        name:
          op.name || "積木朋友",

        background: "transparent",

        preservePlusPlusStyle: true
      }
    );

    const hero =
      await getWorld().addGeneratedCharacter({
        image,

        name:
          op.name ||
          op.description ||
          "新朋友",

        movement:
          op.movement ||
          "wander",

        personality:
          op.personality ||
          "友善、好奇"
      });

    return {
      type: "add_character",
      heroId: hero.id,
      name: hero.name
    };
  }

  /* =======================================================
     新增場景物件
  ======================================================= */

  async function executeAddObject(op) {
    setText(
      "voiceStatus",
      "正在為世界增加積木物件……"
    );

    const image = await generateVisual(
      "generateEnvironmentObject",
      {
        description:
          op.description ||
          op.prompt ||
          op.name ||
          "Plus-Plus environment object",

        background: "transparent",

        preservePlusPlusStyle: true
      }
    );

    const object =
      await getWorld().addWorldObject({
        image,

        name:
          op.name ||
          "新積木物件",

        x:
          Number.isFinite(Number(op.x))
            ? Number(op.x)
            : 50,

        y:
          Number.isFinite(Number(op.y))
            ? Number(op.y)
            : 58,

        width:
          Number.isFinite(Number(op.width))
            ? Number(op.width)
            : 25,

        height:
          Number.isFinite(Number(op.height))
            ? Number(op.height)
            : 35
      });

    return {
      type: "add_object",
      objectId: object.id,
      name: object.name
    };
  }

  /* =======================================================
     角色新增造型 / 配件

     原始角色照片不被替換。
     配件作為獨立透明圖層附加。
  ======================================================= */

  async function executeAddAccessory(op) {
    const world = getWorld();

    const state = getWorldState();

    const hero = op.heroId
      ? state.heroes.find(
          (item) => item.id === op.heroId
        )
      : world.getActiveHero();

    if (!hero) {
      throw new Error(
        "目前沒有可以添加造型的角色。"
      );
    }

    setText(
      "voiceStatus",
      "正在製作角色的新積木造型……"
    );

    const image = await generateVisual(
      "generateAccessory",
      {
        description:
          op.description ||
          op.prompt ||
          op.name ||
          "Plus-Plus character accessory",

        characterName: hero.name,

        characterImage: hero.image,

        background: "transparent",

        preserveOriginal: true
      }
    );

    world.attachHeroAccessory(
      hero.id,
      image,
      {
        name:
          op.name ||
          op.description ||
          "新造型",

        x:
          Number.isFinite(Number(op.x))
            ? Number(op.x)
            : 50,

        y:
          Number.isFinite(Number(op.y))
            ? Number(op.y)
            : 45,

        width:
          Number.isFinite(Number(op.width))
            ? Number(op.width)
            : 70,

        height:
          Number.isFinite(Number(op.height))
            ? Number(op.height)
            : 70
      }
    );

    return {
      type: "add_accessory",
      heroId: hero.id,
      name: op.name || "新造型"
    };
  }

  /* =======================================================
     改變角色動作
  ======================================================= */

  async function executeChangeMovement(op) {
    const world = getWorld();

    const state = getWorldState();

    const hero = op.heroId
      ? state.heroes.find(
          (item) => item.id === op.heroId
        )
      : world.getActiveHero();

    if (!hero) {
      throw new Error(
        "目前沒有可以改變動作的角色。"
      );
    }

    const movement =
      op.movement ||
      op.motion ||
      "wander";

    world.setHeroMovement(
      hero.id,
      movement
    );

    return {
      type: "change_movement",
      heroId: hero.id,
      movement
    };
  }

  /* =======================================================
     技能與特效

     技能不只是文字標籤，
     必須在螢幕播放可見動畫。
  ======================================================= */

  async function executeAddSkill(op) {
    const world = getWorld();

    const state = getWorldState();

    const hero = op.heroId
      ? state.heroes.find(
          (item) => item.id === op.heroId
        )
      : world.getActiveHero();

    const skillName =
      op.name ||
      op.description ||
      "神奇技能";

    if (hero) {
      hero.skills.push(skillName);
    }

    const effectType =
      op.effectType ||
      op.effect ||
      "sparkles";

    world.playPlusPlusEffect(
      effectType,
      clamp(
        Number(op.duration) || 3000,
        500,
        10000
      ),
      {
        count:
          clamp(
            Number(op.count) || 40,
            5,
            100
          ),

        colors:
          Array.isArray(op.colors)
            ? op.colors
            : undefined
      }
    );

    return {
      type: "add_skill",
      heroId:
        hero ? hero.id : null,
      name: skillName,
      effectType
    };
  }

  /* =======================================================
     單純播放特效
  ======================================================= */

  async function executePlayEffect(op) {
    getWorld().playPlusPlusEffect(
      op.effectType ||
      op.effect ||
      "sparkles",

      clamp(
        Number(op.duration) || 3000,
        500,
        10000
      ),
      {
        count:
          clamp(
            Number(op.count) || 35,
            5,
            100
          ),

        colors:
          Array.isArray(op.colors)
            ? op.colors
            : undefined
      }
    );

    return {
      type: "play_effect",
      effectType:
        op.effectType ||
        op.effect ||
        "sparkles"
    };
  }

  /* =======================================================
     改變滿版背景

     不刪除原始角色與場景作品。
  ======================================================= */

  async function executeChangeBackground(op) {
    setText(
      "voiceStatus",
      "正在改造 Plus-Plus 世界……"
    );

    const worldState = getWorldState();

    const image = await generateVisual(
      "generateWorld",
      {
        mode: "background",

        description:
          op.description ||
          op.prompt ||
          "a magical Plus-Plus world",

        originalAnalysis:
          worldState.currentAnalysis,

        originalImage:
          worldState.originalPhoto,

        backgroundOnly: true,

        aspectRatio: "16:9",

        fullBleed: true
      }
    );

    await getWorld().replaceWorldBackground(
      image
    );

    return {
      type: "change_background",
      description:
        op.description ||
        op.prompt ||
        ""
    };
  }

  /* =======================================================
     故事事件
  ======================================================= */

  async function executeStoryEvent(op) {
    const eventText =
      safeText(
        op.description ||
        op.story ||
        op.text
      );

    if (eventText) {
      directorState.story.push({
        time: Date.now(),
        text: eventText
      });
    }

    if (
      op.effectType ||
      op.effect
    ) {
      getWorld().playPlusPlusEffect(
        op.effectType ||
        op.effect,
        clamp(
          Number(op.duration) || 3000,
          500,
          10000
        )
      );
    }

    return {
      type: "story_event",
      description: eventText
    };
  }

  /* =======================================================
     執行單一 AI 操作
  ======================================================= */

  async function executeOperation(op) {
    if (!op || typeof op !== "object") {
      return null;
    }

    const type = String(
      op.type ||
      op.action ||
      ""
    ).toLowerCase();

    switch (type) {
      case "add_character":
      case "create_character":
        return executeAddCharacter(op);

      case "add_object":
      case "create_object":
      case "add_environment_object":
        return executeAddObject(op);

      case "add_accessory":
      case "change_appearance":
      case "transform_character":
        return executeAddAccessory(op);

      case "change_movement":
      case "set_movement":
        return executeChangeMovement(op);

      case "add_skill":
      case "create_skill":
        return executeAddSkill(op);

      case "play_effect":
      case "add_effect":
        return executePlayEffect(op);

      case "change_background":
      case "change_scene":
        return executeChangeBackground(op);

      case "story_event":
      case "create_story":
        return executeStoryEvent(op);

      case "speak":
        return {
          type: "speak",
          text:
            op.text ||
            op.message ||
            ""
        };

      default:
        console.warn(
          "未知的 AI 操作：",
          type,
          op
        );

        return null;
    }
  }

  /* =======================================================
     依序執行 AI 多步驟計畫

     例如：
     長輩說：
     「讓魚長翅膀、飛起來、發射彩虹光線」

     AI 可以回傳：
     1. add_accessory
     2. change_movement
     3. add_skill

     前端依序執行。
  ======================================================= */

  async function executeDirectorPlan(plan) {
    const completed = [];

    const failed = [];

    for (const operation of plan.operations) {
      try {
        const result =
          await executeOperation(operation);

        if (result) {
          completed.push(result);
        }
      } catch (error) {
        console.error(
          "AI operation failed",
          operation,
          error
        );

        failed.push({
          operation,
          error:
            error instanceof Error
              ? error.message
              : String(error)
        });
      }
    }

    return {
      completed,
      failed
    };
  }

  /* =======================================================
     長輩自由指令入口
  ======================================================= */

  async function processUserCommand(
    text,
    alreadyProcessing = false
  ) {
    const message = safeText(text);

    if (!message) return;

    if (
      directorState.processing &&
      !alreadyProcessing
    ) {
      return;
    }

    if (!alreadyProcessing) {
      setProcessing(true);
    }

    try {
      const worldState = getWorldState();

      if (!worldState.currentWorld) {
        const reply =
          "我們先一起創造一個世界吧！" +
          "請拍攝你的 Plus-Plus 積木，" +
          "我就能讓它進入螢幕裡。";

        updateBubble(reply);

        setText("aiReply", reply);

        await speak(reply);

        return;
      }

      directorState.conversation.push({
        role: "user",
        content: message
      });

      setText(
        "voiceStatus",
        "AI 正在理解並創造……"
      );

      const plan =
        await requestDirectorPlan(message);

      const execution =
        await executeDirectorPlan(plan);

      directorState.generationCount++;

      let reply = plan.reply;

      if (execution.failed.length > 0) {
        const count =
          execution.failed.length;

        reply +=
          " 不過有 " +
          count +
          " 個變化暫時沒完成，我們可以再試一次。";

        console.warn(
          "未完成的操作",
          execution.failed
        );
      }

      directorState.lastReply = reply;

      directorState.conversation.push({
        role: "assistant",
        content: reply
      });

      if (
        directorState.conversation.length > 30
      ) {
        directorState.conversation =
          directorState.conversation.slice(-30);
      }

      updateBubble(reply);

      setText(
        "aiReply",
        "你說：「" + message + "」\n\n" +
        "AI：「" + reply + "」"
      );

      await speak(reply);

    } catch (error) {
      reportError(error);
    } finally {
      if (!alreadyProcessing) {
        setProcessing(false);
      }
    }
  }

  /* =======================================================
     AI 自然語音

     優先使用 OpenAI TTS。
     若 API 失敗，可使用瀏覽器語音作為備援。

     備援不代表 OpenAI API 已正常運作。
  ======================================================= */

  function stopSpeaking() {
    directorState.currentSpeechRequest++;

    if (directorState.currentAudio) {
      directorState.currentAudio.pause();

      directorState.currentAudio.src = "";

      directorState.currentAudio = null;
    }

    if (directorState.currentAudioUrl) {
      URL.revokeObjectURL(
        directorState.currentAudioUrl
      );

      directorState.currentAudioUrl = null;
    }

    if (
      "speechSynthesis" in window
    ) {
      window.speechSynthesis.cancel();
    }
  }

  function base64ToAudioBlob(
    base64,
    mimeType = "audio/mpeg"
  ) {
    const binary = atob(base64);

    const bytes = new Uint8Array(
      binary.length
    );

    for (
      let i = 0;
      i < binary.length;
      i++
    ) {
      bytes[i] = binary.charCodeAt(i);
    }

    return new Blob(
      [bytes],
      { type: mimeType }
    );
  }

  async function playAudioBlob(blob, requestId) {
    if (
      requestId !==
      directorState.currentSpeechRequest
    ) {
      return;
    }

    const url = URL.createObjectURL(blob);

    directorState.currentAudioUrl = url;

    const audio = new Audio(url);

    directorState.currentAudio = audio;

    try {
      await audio.play();

      await new Promise((resolve, reject) => {
        audio.onended = resolve;

        audio.onerror = () => {
          reject(
            new Error("語音播放失敗")
          );
        };
      });
    } finally {
      if (
        directorState.currentAudio === audio
      ) {
        directorState.currentAudio = null;
      }

      if (
        directorState.currentAudioUrl === url
      ) {
        URL.revokeObjectURL(url);

        directorState.currentAudioUrl = null;
      }
    }
  }

  function browserSpeak(text) {
    return new Promise((resolve) => {
      if (
        !("speechSynthesis" in window)
      ) {
        resolve();
        return;
      }

      const utterance =
        new SpeechSynthesisUtterance(text);

      utterance.lang = "zh-TW";

      utterance.rate = 0.92;

      utterance.pitch = 1.05;

      utterance.volume = 1;

      utterance.onend = resolve;

      utterance.onerror = resolve;

      window.speechSynthesis.speak(
        utterance
      );
    });
  }

  async function speak(text) {
    const message = safeText(text);

    if (
      !message ||
      !directorState.speechEnabled
    ) {
      return;
    }

    stopSpeaking();

    const requestId =
      directorState.currentSpeechRequest;

    try {
      const result = await callAI(
        "speakNatural",
        {
          text: message,

          voice:
            DIRECTOR_CONFIG.DEFAULT_VOICE,

          language:
            DIRECTOR_CONFIG.DEFAULT_LANGUAGE
        },
        DIRECTOR_CONFIG.SPEECH_TIMEOUT
      );

      if (
        requestId !==
        directorState.currentSpeechRequest
      ) {
        return;
      }

      const data = normalizeResult(result);

      let audioBase64 = "";

      let mimeType = "audio/mpeg";

      if (typeof data === "string") {
        audioBase64 = data;
      } else if (data) {
        audioBase64 =
          data.audio ||
          data.base64 ||
          data.audioBase64 ||
          "";

        mimeType =
          data.mimeType ||
          "audio/mpeg";
      }

      if (!audioBase64) {
        throw new Error(
          "AI 沒有回傳語音資料"
        );
      }

      if (
        audioBase64.startsWith("data:")
      ) {
        const comma =
          audioBase64.indexOf(",");

        if (comma >= 0) {
          audioBase64 =
            audioBase64.slice(comma + 1);
        }
      }

      const blob = base64ToAudioBlob(
        audioBase64,
        mimeType
      );

      await playAudioBlob(
        blob,
        requestId
      );

    } catch (error) {
      console.warn(
        "OpenAI TTS 失敗，改用瀏覽器語音：",
        error
      );

      if (
        requestId ===
        directorState.currentSpeechRequest
      ) {
        await browserSpeak(message);
      }
    }
  }

  /* =======================================================
     語音輸出開關
  ======================================================= */

  function toggleSpeechOutput() {
    directorState.speechEnabled =
      !directorState.speechEnabled;

    const button =
      $("toggleVoiceOutput");

    if (button) {
      button.textContent =
        directorState.speechEnabled
          ? "🔊 語音回應：開"
          : "🔇 語音回應：關";
    }

    if (!directorState.speechEnabled) {
      stopSpeaking();
    }
  }

  /* =======================================================
     文字指令
  ======================================================= */

  async function sendTextCommand() {
    const input = $("textCommand");

    if (!input) return;

    const message = input.value.trim();

    if (!message) {
      setText(
        "aiReply",
        "請先輸入想讓世界發生什麼變化。"
      );

      return;
    }

    input.value = "";

    await processUserCommand(message);
  }

  /* =======================================================
     AI 主動歡迎

     sketch.js 會呼叫：
     MindspaceDirector.speak(welcome)
  ======================================================= */

  async function welcomeCreation(message) {
    const welcome = safeText(
      message,
      "歡迎來到你的 Plus-Plus 世界！"
    );

    updateBubble(welcome);

    await speak(welcome);
  }

  /* =======================================================
     綁定介面
  ======================================================= */

  function bindButton(id, handler) {
    const button = $(id);

    if (!button) {
      console.warn(
        "找不到 AI Director 按鈕：",
        id
      );

      return;
    }

    button.addEventListener(
      "click",
      handler
    );
  }

  function initializeDirector() {
    if (directorState.initialized) {
      return;
    }

    directorState.initialized = true;

    bindButton(
      "voiceButton",
      toggleRecording
    );

    bindButton(
      "workbenchVoiceButton",
      toggleRecording
    );

    bindButton(
      "toggleVoiceOutput",
      toggleSpeechOutput
    );

    bindButton(
      "stopSpeakingButton",
      stopSpeaking
    );

    bindButton(
      "sendTextCommand",
      sendTextCommand
    );

    const input = $("textCommand");

    if (input) {
      input.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();

            sendTextCommand();
          }
        }
      );
    }

    console.log(
      "[Mindspace Plus-Plus] AI Director initialized"
    );
  }

  /* =======================================================
     對外公開介面
  ======================================================= */

  window.MindspaceDirector = {
    get state() {
      return directorState;
    },

    speak,

    stopSpeaking,

    welcomeCreation,

    startRecording,

    stopRecording,

    toggleRecording,

    processUserCommand,

    buildWorldContext,

    executeDirectorPlan,

    toggleSpeechOutput
  };

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initializeDirector
    );
  } else {
    initializeDirector();
  }

})();
