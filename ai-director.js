
"use strict";

/* ==================================================
   Mindspace Plus-Plus
   AI Director
   ================================================== */

const AIDirector = (() => {
  const history = [];
  const MAX_HISTORY = 12;

  function cleanSVG(source) {
    if (typeof source !== "string" || !source.trim()) {
      return "";
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(
      source,
      "image/svg+xml"
    );

    if (doc.querySelector("parsererror")) {
      throw new Error("AI 生成的 SVG 格式不正確");
    }

    const root = doc.documentElement;

    if (root.localName !== "svg") {
      throw new Error("AI 沒有回傳 SVG 圖像");
    }

    const allowedTags = new Set([
      "svg", "g", "path", "rect", "circle",
      "ellipse", "line", "polyline", "polygon",
      "defs", "linearGradient", "radialGradient",
      "stop", "clipPath", "mask", "pattern",
      "text", "tspan"
    ]);

    const allowedAttributes = new Set([
      "xmlns", "viewBox", "width", "height",
      "x", "y", "x1", "y1", "x2", "y2",
      "cx", "cy", "r", "rx", "ry",
      "d", "points", "transform",
      "fill", "stroke", "stroke-width",
      "stroke-linecap", "stroke-linejoin",
      "stroke-dasharray", "stroke-dashoffset",
      "opacity", "fill-opacity", "stroke-opacity",
      "offset", "stop-color", "stop-opacity",
      "gradientUnits", "gradientTransform",
      "id", "clip-path", "mask",
      "font-size", "font-family",
      "font-weight", "text-anchor"
    ]);

    function inspect(element) {
      for (const child of [...element.children]) {
        if (!allowedTags.has(child.localName)) {
          child.remove();
          continue;
        }
        inspect(child);
      }

      for (const attr of [...element.attributes]) {
        const name = attr.name;
        const value = attr.value;

        const valid =
          allowedAttributes.has(name) &&
          !/url\s*\(\s*['"]?\s*(?!#)/i.test(value) &&
          !/javascript:|data:|https?:|@import/i.test(value);

        if (!valid) {
          element.removeAttribute(name);
        }
      }
    }

    inspect(root);

    root.setAttribute(
      "xmlns",
      "http://www.w3.org/2000/svg"
    );

    root.setAttribute("width", "512");
    root.setAttribute("height", "512");

    if (!root.getAttribute("viewBox")) {
      root.setAttribute("viewBox", "0 0 512 512");
    }

    const output = new XMLSerializer()
      .serializeToString(root);

    if (output.length > 80000) {
      throw new Error("SVG 圖像過大");
    }

    return output;
  }

  function loadSVG(node) {
    if (!node.svg) return;

    try {
      const svg = cleanSVG(node.svg);
      const blob = new Blob(
        [svg],
        { type: "image/svg+xml" }
      );

      const url = URL.createObjectURL(blob);
      const img = new Image();

      img.onload = () => URL.revokeObjectURL(url);
      img.onerror = () => URL.revokeObjectURL(url);

      img.src = url;
      node.visual = img;

    } catch (error) {
      console.warn("SVG 載入失敗", error);
    }
  }

  function sceneSummary() {
    return app.nodes.map(node => ({
      id: node.id,
      type: node.type,
      name: node.name,
      description: node.description,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      layer: node.layer,
      hasOriginalPhoto: !!node.image,
      hasGeneratedSVG: !!node.svg
    }));
  }

  function normalizeMotion(motion) {
    if (!motion || typeof motion !== "object") {
      return null;
    }

    const result = {};

    for (const key of [
      "x", "y", "rotation", "scale"
    ]) {
      const spec = motion[key];

      if (!spec || typeof spec !== "object") continue;

      result[key] = {
        amplitude: clamp(
          spec.amplitude ?? 0,
          -1000, 1000
        ),
        speed: clamp(
          spec.speed ?? 0,
          -20, 20
        ),
        phase: clamp(
          spec.phase ?? 0,
          -1000, 1000
        )
      };
    }

    return Object.keys(result).length
      ? result
      : null;
  }

  function applyChanges(changes) {
    if (!Array.isArray(changes)) return;

    for (const change of changes.slice(0, 15)) {
      const node = app.nodes.find(
        item => item.id === change.id
      );

      if (!node) continue;

      if (typeof change.name === "string") {
        node.name = change.name.slice(0, 100);
      }

      if (typeof change.description === "string") {
        node.description =
          change.description.slice(0, 1000);
      }

      if (Number.isFinite(change.x)) {
        node.x = clamp(change.x, 0, 1200);
      }

      if (Number.isFinite(change.y)) {
        node.y = clamp(change.y, 0, 750);
      }

      if (Number.isFinite(change.width)) {
        node.width = clamp(change.width, 15, 900);
      }

      if (Number.isFinite(change.height)) {
        node.height = clamp(change.height, 15, 900);
      }

      if (Number.isFinite(change.layer)) {
        node.layer = clamp(change.layer, -10, 10);
      }

      if (Number.isFinite(change.opacity)) {
        node.opacity = clamp(change.opacity, 0, 1);
      }

      if (Number.isFinite(change.rotation)) {
        node.rotation = change.rotation;
      }

      if (change.motion !== undefined) {
        node.motion = normalizeMotion(change.motion);
      }

      // AI 可以更換自己生成的視覺，
      // 但不覆蓋孩子原始積木照片。
      if (
        typeof change.svg === "string" &&
        !node.image
      ) {
        try {
          node.svg = cleanSVG(change.svg);
          loadSVG(node);
        } catch (error) {
          console.warn(error);
        }
      }
    }
  }

  function applySpawns(spawns) {
    if (!Array.isArray(spawns)) return;

    for (const item of spawns.slice(0, 12)) {
      if (!item.svg) continue;

      try {
        const svg = cleanSVG(item.svg);

        addNode({
          type: item.type,
          name: item.name || "想像中的新作品",
          description: item.description || "",
          svg,
          x: item.x ?? 600,
          y: item.y ?? 350,
          width: item.width ?? 140,
          height: item.height ?? 140,
          layer: item.layer ?? 1,
          opacity: item.opacity ?? 1,
          motion: normalizeMotion(item.motion)
        });

      } catch (error) {
        console.warn("略過無效的 AI 圖像", error);
      }
    }
  }

  function applyResult(result) {
    // 修改既有物件，並新增生成物件。
    // 不會重建或清空整個世界。
    applyChanges(result.changes);
    applySpawns(result.spawns);

    refreshLists();

    const reply = String(
      result.reply || "我們的世界又有新變化了！"
    );

    logMessage("想像世界", reply);
    speak(reply);

    status("想像已呈現在世界中");
  }

  async function send() {
    const message = $("prompt").value.trim();

    if (!message || app.busy) return;

    app.busy = true;
    $("send").disabled = true;
    $("prompt").value = "";

    logMessage("孩子", message, true);
    status("AI 正在理解並創造畫面……");

    try {
      const result = await askBackend(
        "imagine",
        {
          message,
          selectedId: app.selectedId,
          world: sceneSummary(),
          history: history.slice(-MAX_HISTORY)
        },
        180000
      );

      applyResult(result);

      history.push(
        { role: "user", content: message },
        {
          role: "assistant",
          content: result.reply || ""
        }
      );

      while (history.length > MAX_HISTORY) {
        history.shift();
      }

    } catch (error) {
      status("AI 創作失敗：" + error.message);
      logMessage("系統", error.message);

    } finally {
      app.busy = false;
      $("send").disabled = false;
    }
  }

  async function onNewCreation(candidate, name, type) {
    const node = [...app.nodes].reverse().find(
      item =>
        item.name === name &&
        item.type === type &&
        item.image === candidate.image
    );

    if (!node) return;

    status("AI 正在為新作品構思互動方式……");

    try {
      const result = await askBackend(
        "imagine",
        {
          message:
            "孩子剛剛親手創造了一件名叫「" +
            name +
            "」的 Plus-Plus 積木作品。" +
            "孩子已經決定它是" +
            (type === "character" ? "角色" : "環境") +
            "。孩子描述：" +
            (candidate.description || "沒有額外描述") +
            "。請保留原始積木照片，" +
            "讓這件作品自然加入既有世界。" +
            "可以生成少量適合的周圍元素或動態，" +
            "但不要替孩子決定固定故事或能力。",

          selectedId: node.id,
          world: sceneSummary(),
          history: history.slice(-MAX_HISTORY)
        }
      );

      applyResult(result);

    } catch (error) {
      status("作品已加入，但 AI 延伸失敗：" +
        error.message);
    }
  }

  return {
    send,
    onNewCreation,
    loadSVG,
    cleanSVG
  };
})();

window.AIDirector = AIDirector;
