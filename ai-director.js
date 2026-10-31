
"use strict";

/* =========================================================
   MINDSPACE PLUS-PLUS — AI DIRECTOR

   長輩創作版

   功能：
   1. 文字輸入與 AI 自由對話
   2. 麥克風錄音
   3. 錄音轉 16kHz WAV
   4. GAS transcribe 語音辨識
   5. GAS directWorld 自由理解
   6. 多步驟 operations 執行
   7. AI 自然語音回應
   8. AI 技能與角色互動
   9. 避免按鈕重複觸發
   10. 保留原始 Plus-Plus 積木作品

   依賴：
   sketch.js

   注意：
   本檔案必須在 sketch.js 之後載入。
========================================================= */

(function () {

  const APP =
    "Mindspace Plus-Plus AI Director";

  const D = {
    initialized: false,

    busy: false,

    recording: false,

    recorder: null,

    stream: null,

    chunks: [],

    recordTimer: null,

    recordStarted: 0,

    maxRecordingMs: 30000,

    transcribing: false,

    commandSerial: 0
  };

  /* =====================================================
     01. 基本工具
  ===================================================== */

  function el(id) {
    return document.getElementById(id);
  }

  function messageStatus(text) {
    if (
      typeof status ===
      "function"
    ) {
      status(text);

    } else {
      console.log(
        APP,
        text
      );
    }
  }

  function setButtonDisabled(
    id,
    disabled
  ) {
    const button =
      el(id);

    if (button) {
      button.disabled =
        Boolean(disabled);
    }
  }

  function updateMicButton() {
    const button =
      el("micButton");

    if (!button) {
      return;
    }

    if (D.transcribing) {
      button.textContent =
        "🧠 正在辨識語音";

      button.disabled =
        true;

    } else if (D.recording) {
      button.textContent =
        "⏹️ 結束錄音";

      button.disabled =
        false;

    } else {
      button.textContent =
        "🎙️ 開始說話";

      button.disabled =
        D.busy;
    }
  }

  function updateBusyButtons() {
    setButtonDisabled(
      "sendButton",
      D.busy
    );

    setButtonDisabled(
      "skillButton",
      D.busy
    );

    updateMicButton();
  }

  function getSelectedHero() {
    if (
      typeof heroNow ===
      "function"
    ) {
      return heroNow();
    }

    return null;
  }

  /* =====================================================
     02. 檢查 AI 指令介面

     新版 sketch.js 提供：
     performPlusPlusCommand()
  ===================================================== */

  function checkDirectorDependencies() {
    const required = [
      "performPlusPlusCommand",
      "requestPlusPlusDirection",
      "executePlusPlusOperations",
      "callAI",
      "speak"
    ];

    const missing =
      required.filter(name => {
        try {
          return (
            typeof evalLocalFunction(
              name
            ) !== "function"
          );

        } catch (error) {
          return true;
        }
      });

    if (missing.length) {
      console.warn(
        APP,
        "缺少必要功能：",
        missing.join(", ")
      );
    }

    return missing.length === 0;
  }

  /*
    不使用 eval。
    以明確對應表檢查函式。
  */

  function evalLocalFunction(name) {
    const functions = {
      performPlusPlusCommand:
        typeof performPlusPlusCommand ===
        "function"
          ? performPlusPlusCommand
          : null,

      requestPlusPlusDirection:
        typeof requestPlusPlusDirection ===
        "function"
          ? requestPlusPlusDirection
          : null,

      executePlusPlusOperations:
        typeof executePlusPlusOperations ===
        "function"
          ? executePlusPlusOperations
          : null,

      callAI:
        typeof callAI ===
        "function"
          ? callAI
          : null,

      speak:
        typeof speak ===
        "function"
          ? speak
          : null
    };

    return functions[name];
  }

  /* =====================================================
     03. AI 自由指令

     不做中文關鍵字比對。

     所有語意由後端 directWorld 理解。
  ===================================================== */

  async function command(message) {
    const text =
      String(
        message || ""
      ).trim();

    if (!text) {
      return null;
    }

    if (D.busy) {
      messageStatus(
        "⏳ AI 正在處理上一個想法，請稍候"
      );

      return null;
    }

    if (!state.heroes.length) {
      messageStatus(
        "🧩 請先拍照並建立 Plus-Plus 積木作品"
      );

      return null;
    }

    D.busy = true;
    state.busy = true;

    D.commandSerial++;

    updateBusyButtons();

    try {
      messageStatus(
        "🧠 AI 正在理解你的想法……"
      );

      /*
        這個函式在 sketch.js 第 5 段，
        已經負責：

        - 顯示使用者對話
        - 呼叫 directWorld
        - 執行 operations
        - 顯示 AI 回話
        - 播放 AI 自然語音

        因此這裡不能再重複呼叫
        requestPlusPlusDirection，
        否則同一段語音會執行兩次。
      */

      const result =
        await performPlusPlusCommand(
          text
        );

      return result;

    } catch (error) {
      console.error(
        APP,
        "AI 指令失敗：",
        error
      );

      messageStatus(
        "❌ AI 回應失敗：" +
        error.message
      );

      throw error;

    } finally {
      D.busy = false;
      state.busy = false;

      updateBusyButtons();
    }
  }

  /* =====================================================
     04. 文字送出

     只清除成功送出的文字。
     失敗時恢復輸入內容。
  ===================================================== */

  async function sendText() {
    const input =
      el("chatInput");

    if (!input) {
      throw new Error(
        "找不到 chatInput"
      );
    }

    const text =
      input.value.trim();

    if (!text) {
      return;
    }

    if (D.busy) {
      messageStatus(
        "⏳ 請等待 AI 完成上一個操作"
      );

      return;
    }

    input.value = "";

    try {
      await command(text);

    } catch (error) {
      input.value = text;
    }
  }

  /* =====================================================
     05. 錄音 Blob 轉 Base64
  ===================================================== */

  async function blobToBase64(blob) {
    return await new Promise(
      (resolve, reject) => {
        const reader =
          new FileReader();

        reader.onload = () => {
          const data =
            String(
              reader.result || ""
            );

          const comma =
            data.indexOf(",");

          resolve(
            comma >= 0
              ? data.slice(comma + 1)
              : data
          );
        };

        reader.onerror = () => {
          reject(
            new Error(
              "無法讀取錄音資料"
            )
          );
        };

        reader.readAsDataURL(
          blob
        );
      }
    );
  }

  /* =====================================================
     06. WAV 寫入工具
  ===================================================== */

  function writeAscii(
    view,
    offset,
    text
  ) {
    for (
      let i = 0;
      i < text.length;
      i++
    ) {
      view.setUint8(
        offset + i,
        text.charCodeAt(i)
      );
    }
  }

  function encodeWav16(
    samples,
    sampleRate = 16000
  ) {
    const buffer =
      new ArrayBuffer(
        44 +
        samples.length * 2
      );

    const view =
      new DataView(buffer);

    writeAscii(
      view,
      0,
      "RIFF"
    );

    view.setUint32(
      4,
      36 +
      samples.length * 2,
      true
    );

    writeAscii(
      view,
      8,
      "WAVE"
    );

    writeAscii(
      view,
      12,
      "fmt "
    );

    view.setUint32(
      16,
      16,
      true
    );

    view.setUint16(
      20,
      1,
      true
    );

    view.setUint16(
      22,
      1,
      true
    );

    view.setUint32(
      24,
      sampleRate,
      true
    );

    view.setUint32(
      28,
      sampleRate * 2,
      true
    );

    view.setUint16(
      32,
      2,
      true
    );

    view.setUint16(
      34,
      16,
      true
    );

    writeAscii(
      view,
      36,
      "data"
    );

    view.setUint32(
      40,
      samples.length * 2,
      true
    );

    let offset = 44;

    for (
      let i = 0;
      i < samples.length;
      i++
    ) {
      const sample =
        Math.max(
          -1,
          Math.min(
            1,
            samples[i]
          )
        );

      view.setInt16(
        offset,
        sample < 0
          ? sample * 32768
          : sample * 32767,
        true
      );

      offset += 2;
    }

    return new Blob(
      [buffer],
      {
        type: "audio/wav"
      }
    );
  }

  /* =====================================================
     07. 音訊轉成 16kHz 單聲道 WAV

     保留一評使用的轉錄流程，
     不直接將 webm 交給後端。
  ===================================================== */

  async function convertToWav16k(
    blob
  ) {
    const bytes =
      await blob.arrayBuffer();

    const AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioContextClass) {
      throw new Error(
        "瀏覽器不支援音訊處理"
      );
    }

    const audioContext =
      new AudioContextClass();

    try {
      const decoded =
        await audioContext
          .decodeAudioData(
            bytes.slice(0)
          );

      const duration =
        decoded.duration;

      if (
        !Number.isFinite(duration) ||
        duration <= 0
      ) {
        throw new Error(
          "錄音內容無效"
        );
      }

      const targetRate =
        16000;

      const length =
        Math.max(
          1,
          Math.ceil(
            duration * targetRate
          )
        );

      const offline =
        new OfflineAudioContext(
          1,
          length,
          targetRate
        );

      const source =
        offline.createBufferSource();

      source.buffer = decoded;

      source.connect(
        offline.destination
      );

      source.start(0);

      const rendered =
        await offline
          .startRendering();

      const samples =
        rendered.getChannelData(0);

      return encodeWav16(
        samples,
        targetRate
      );

    } finally {
      await audioContext
        .close()
        .catch(() => {});
    }
  }

  /* =====================================================
     08. 選擇 MediaRecorder 格式
  ===================================================== */

  function preferredMimeType() {
    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      return "";
    }

    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus"
    ];

    for (const type of candidates) {
      if (
        MediaRecorder.isTypeSupported(
          type
        )
      ) {
        return type;
      }
    }

    return "";
  }

  /* =====================================================
     09. 開始錄音
  ===================================================== */

  async function startRecording() {
    if (
      D.recording ||
      D.transcribing ||
      D.busy
    ) {
      return;
    }

    if (
      !navigator.mediaDevices ||
      !navigator.mediaDevices
        .getUserMedia
    ) {
      throw new Error(
        "瀏覽器不支援麥克風，請使用 HTTPS 網站"
      );
    }

    if (
      typeof MediaRecorder ===
      "undefined"
    ) {
      throw new Error(
        "瀏覽器不支援 MediaRecorder"
      );
    }

    if (!state.bridgeReady) {
      throw new Error(
        "AI 尚未連線，請先測試 AI 連線"
      );
    }

    /*
      避免錄下 AI 自己正在說的話。
    */

    if (
      typeof stopSpeech ===
      "function"
    ) {
      stopSpeech();
    }

    const stream =
      await navigator.mediaDevices
        .getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          },

          video: false
        });

    const mime =
      preferredMimeType();

    let recorder;

    try {
      recorder =
        new MediaRecorder(
          stream,
          mime
            ? {
                mimeType: mime
              }
            : undefined
        );

    } catch (error) {
      stream
        .getTracks()
        .forEach(
          track => track.stop()
        );

      throw error;
    }

    D.stream = stream;
    D.recorder = recorder;
    D.chunks = [];

    D.recordStarted =
      Date.now();

    D.recording = true;

    recorder.addEventListener(
      "dataavailable",
      event => {
        if (
          event.data &&
          event.data.size > 0
        ) {
          D.chunks.push(
            event.data
          );
        }
      }
    );

    recorder.addEventListener(
      "error",
      event => {
        console.error(
          "MediaRecorder error:",
          event
        );

        messageStatus(
          "❌ 麥克風錄音發生錯誤"
        );
      }
    );

    recorder.addEventListener(
      "stop",
      async () => {
        await finishRecording();
      },
      {
        once: true
      }
    );

    recorder.start();

    D.recordTimer =
      setTimeout(() => {
        if (D.recording) {
          stopRecording();
        }
      }, D.maxRecordingMs);

    updateMicButton();

    messageStatus(
      "🎙️ 正在聆聽你的想法，說完請按「結束錄音」"
    );
  }

  /* =====================================================
     10. 停止錄音
  ===================================================== */

  function stopRecording() {
    if (!D.recording) {
      return;
    }

    clearTimeout(
      D.recordTimer
    );

    D.recordTimer = null;

    D.recording = false;

    if (
      D.recorder &&
      D.recorder.state !==
      "inactive"
    ) {
      D.recorder.stop();
    }

    updateMicButton();
  }

  /* =====================================================
     11. 錄音完成與 AI 語音辨識

     後端：
     transcribe

     預期：
     { text: "..." }
  ===================================================== */

  async function finishRecording() {
    clearTimeout(
      D.recordTimer
    );

    D.recordTimer = null;

    const stream =
      D.stream;

    const recorder =
      D.recorder;

    const chunks =
      [...D.chunks];

    D.stream = null;
    D.recorder = null;
    D.chunks = [];

    if (stream) {
      stream
        .getTracks()
        .forEach(
          track => track.stop()
        );
    }

    if (!chunks.length) {
      messageStatus(
        "⚠️ 沒有收到錄音資料"
      );

      return;
    }

    D.transcribing = true;

    updateMicButton();

    try {
      messageStatus(
        "🧠 AI 正在辨識語音……"
      );

      const blob =
        new Blob(
          chunks,
          {
            type:
              recorder?.mimeType ||
              chunks[0]?.type ||
              "audio/webm"
          }
        );

      const wav =
        await convertToWav16k(
          blob
        );

      const audio =
        await blobToBase64(
          wav
        );

      if (
        audio.length > 7000000
      ) {
        throw new Error(
          "錄音資料過大，請縮短說話時間"
        );
      }

      const result =
        await callAI(
          "transcribe",
          {
            audio
          },
          120000
        );

      const recognized =
        String(
          result?.text ||
          ""
        ).trim();

      if (!recognized) {
        messageStatus(
          "⚠️ 沒有辨識到清楚的說話內容，請再試一次"
        );

        return;
      }

      messageStatus(
        "🎤 已辨識：" +
        recognized
      );

      /*
        讓長輩看見辨識結果。
      */

      const input =
        el("chatInput");

      if (input) {
        input.value =
          recognized;
      }

      /*
        這裡直接執行 AI 指令，
        不再另外觸發 sendButton。
      */

      if (input) {
        input.value = "";
      }

      try {
        await command(
          recognized
        );

      } catch (error) {
        if (input) {
          input.value =
            recognized;
        }

        throw error;
      }

    } catch (error) {
      console.error(
        APP,
        "語音處理失敗：",
        error
      );

      messageStatus(
        "❌ 語音辨識失敗：" +
        error.message
      );

    } finally {
      D.transcribing = false;

      updateMicButton();
    }
  }

  /* =====================================================
     12. 麥克風切換
  ===================================================== */

  async function toggleRecording() {
    if (D.transcribing) {
      return;
    }

    if (D.recording) {
      stopRecording();

    } else {
      await startRecording();
    }
  }

  /* =====================================================
     13. AI 自由技能按鈕

     技能不是固定種類。

     例如：
     「我的積木龍可以吐出彩色的雲」
     「讓小鳥留下發光的積木腳印」

     全部交給 AI Director 判斷。
  ===================================================== */

  async function activateSkillFromInput() {
    const hero =
      getSelectedHero();

    if (!hero) {
      throw new Error(
        "請先選擇積木角色"
      );
    }

    const input =
      el("transformInput");

    const description =
      String(
        input?.value ||
        ""
      ).trim();

    if (!description) {
      const saved =
        Array.isArray(
          hero.aiSkills
        )
          ? hero.aiSkills
          : [];

      if (!saved.length) {
        messageStatus(
          "✨ 請先描述想讓角色擁有什麼能力"
        );

        return;
      }

      const skill =
        saved[saved.length - 1];

      await activatePlusPlusSkill(
        hero,
        {
          name: skill.name,
          description:
            skill.description,
          duration: 3000
        }
      );

      return;
    }

    await command(
      description
    );
  }

  /* =====================================================
     14. 防止重複按鈕事件

     使用 capture 階段攔截
     一評舊版可能殘留的 click handler。

     不重新呼叫 setupButtons()，
     也不重複包裝 animateHeroes()。
  ===================================================== */

  function takeOverClick(
    id,
    handler
  ) {
    const button =
      el(id);

    if (!button) {
      console.warn(
        APP,
        "找不到按鈕：",
        id
      );

      return;
    }

    const marker =
      "mindspaceDirectorBound";

    if (
      button.dataset[marker] ===
      "true"
    ) {
      return;
    }

    button.dataset[marker] =
      "true";

    button.addEventListener(
      "click",
      event => {
        event.preventDefault();

        event.stopImmediatePropagation();

        Promise.resolve()
          .then(handler)
          .catch(error => {
            console.error(
              APP,
              error
            );

            messageStatus(
              "❌ " +
              error.message
            );
          });
      },
      true
    );
  }

  /* =====================================================
     15. 文字輸入 Enter 送出

     Shift + Enter 可換行。
  ===================================================== */

  function setupChatKeyboard() {
    const input =
      el("chatInput");

    if (!input) {
      return;
    }

    if (
      input.dataset
        .mindspaceDirectorKeyboard ===
      "true"
    ) {
      return;
    }

    input.dataset
      .mindspaceDirectorKeyboard =
      "true";

    input.addEventListener(
      "keydown",
      event => {
        if (
          event.key !==
          "Enter"
        ) {
          return;
        }

        if (event.shiftKey) {
          return;
        }

        event.preventDefault();

        sendText().catch(
          error => {
            messageStatus(
              "❌ " +
              error.message
            );
          }
        );
      }
    );
  }

  /* =====================================================
     16. 初始化按鈕
  ===================================================== */

  function setupDirectorButtons() {
    takeOverClick(
      "sendButton",
      sendText
    );

    takeOverClick(
      "micButton",
      toggleRecording
    );

    takeOverClick(
      "skillButton",
      activateSkillFromInput
    );

    setupChatKeyboard();

    updateBusyButtons();
  }

  /* =====================================================
     17. 結束時釋放麥克風
  ===================================================== */

  function cleanupDirector() {
    clearTimeout(
      D.recordTimer
    );

    D.recordTimer = null;

    if (
      D.recorder &&
      D.recorder.state !==
      "inactive"
    ) {
      try {
        D.recorder.stop();
      } catch (error) {
        console.warn(error);
      }
    }

    if (D.stream) {
      D.stream
        .getTracks()
        .forEach(
          track => track.stop()
        );
    }

    D.stream = null;
    D.recorder = null;
    D.recording = false;
  }

  /* =====================================================
     18. 對外介面

     保留其他程式呼叫 Director 的能力。
  ===================================================== */

  window.MindspaceAIDirector = {
    command,

    sendText,

    toggleRecording,

    startRecording,

    stopRecording,

    get busy() {
      return D.busy;
    },

    get recording() {
      return D.recording;
    }
  };

  /*
    與 sketch.js 的 Plus-Plus Director
    使用同一個 command。
  */

  if (
    window.MindspacePlusPlusDirector
  ) {
    window.MindspacePlusPlusDirector
      .command = command;
  }

  /* =====================================================
     19. 啟動
  ===================================================== */

  function initializeDirector() {
    if (D.initialized) {
      return;
    }

    D.initialized = true;

    checkDirectorDependencies();

    setupDirectorButtons();

    window.addEventListener(
      "pagehide",
      cleanupDirector
    );

    console.log(
      APP,
      "initialized"
    );
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initializeDirector,
      {
        once: true
      }
    );

  } else {
    initializeDirector();
  }

})();
