// WpsAiQrZoom：客服二维码点击放大（全屏遮罩，方便手机扫码）。
//
// 设计要点：
//   1. 事件委托：只在 document 上挂一个 click 监听，覆盖三张客服二维码——
//      #promoQrImg（面板底部引流卡）、#paywallContactQr（AI 付费弹窗，运行时动态生成）、
//      .feedback-qr-img（反馈设置区）。不逐节点绑定，动态节点自动生效。
//   2. 遮罩懒创建、之后复用；大图 src 取被点那张图当前的 src（不写死路径）。
//   3. 关闭：点遮罩任意处（含大图本身）或按 Esc。Esc 的 keydown 监听关闭时必定解绑，
//      反复 open/close 不累积监听。
//   4. 幂等：script 重复加载 / init() 重复调用只生效一次；无宿主（没有 document）
//      或拿不到 src / document.body 时全部静默返回，绝不抛异常。
//   5. 纯原生 JS、零依赖、零联网（无 fetch / XMLHttpRequest / sendBeacon / 图片预加载）。
(function attachQrZoom(global) {
  "use strict";

  if (!global) return;
  // 幂等：script 被重复加载时直接返回，避免挂第二份 document 监听
  if (global.WpsAiQrZoom && global.WpsAiQrZoom.__installed) return;

  var TARGET_SELECTOR = "#promoQrImg, #paywallContactQr, .feedback-qr-img";
  var OVERLAY_CLASS = "qr-zoom-overlay";
  var IMG_CLASS = "qr-zoom-overlay__img";
  var HINT_CLASS = "qr-zoom-overlay__hint";
  // 提示文案，词条见 js/i18n.js（英文模式下由 i18n 观察器按原文精确匹配翻译）
  var HINT_TEXT = "点击任意处关闭";
  var ESC_KEY = "Escape";
  var ESC_KEY_CODE = 27;

  var installed = false; // document 委托监听已挂载（init 幂等用）
  var overlay = null; // 遮罩节点：只在第一次点击时创建，之后复用
  var overlayImg = null;
  var isOpen = false; // 遮罩当前是否可见
  var escHandler = null; // 当前挂着的 Esc 处理器引用；close 时必定解绑

  function getDoc() {
    try {
      if (global && global.document) return global.document;
      if (typeof document !== "undefined") return document;
    } catch (e) {}
    return null;
  }

  /**
   * 命中判断（可单独调用/单测）：这个节点本身是否为三张客服二维码之一
   * @param {Element} el
   * @returns {boolean}
   */
  function matchesTarget(el) {
    if (!el || el.nodeType !== 1) return false;
    var id = el.id || "";
    if (id === "promoQrImg" || id === "paywallContactQr") return true;
    var cls = el.className;
    if (typeof cls === "string" && cls) {
      var parts = cls.split(/\s+/);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === "feedback-qr-img") return true;
      }
    }
    return false;
  }

  /**
   * 从点击目标向上找命中的二维码节点（可单独调用/单测）。
   * 允许直接传事件对象（取 ev.target）；不命中返回 null。
   * @param {Element|Event} node
   * @returns {Element|null}
   */
  function resolveTarget(node) {
    try {
      if (node && node.target) node = node.target;
      var el = node;
      while (el && el.nodeType === 1) {
        if (matchesTarget(el)) return el;
        el = el.parentElement || el.parentNode || null;
      }
    } catch (e) {}
    return null;
  }

  function ensureOverlay(doc) {
    if (overlay) return overlay;
    try {
      if (!doc || !doc.body || typeof doc.createElement !== "function") return null;

      var ov = doc.createElement("div");
      ov.className = OVERLAY_CLASS;
      ov.setAttribute("role", "dialog");
      ov.setAttribute("aria-modal", "true");
      ov.style.display = "none";

      var big = doc.createElement("img");
      big.className = IMG_CLASS;
      big.setAttribute("alt", "");
      ov.appendChild(big);

      var hint = doc.createElement("p");
      hint.className = HINT_CLASS;
      hint.textContent = HINT_TEXT;
      ov.appendChild(hint);

      doc.body.appendChild(ov);

      overlay = ov;
      overlayImg = big;
      return ov;
    } catch (e) {
      return null;
    }
  }

  function onEscKey(ev) {
    if (!ev) return;
    if (ev.key === ESC_KEY || ev.keyCode === ESC_KEY_CODE) close();
  }

  function bindEsc(doc) {
    if (escHandler) return; // 已绑定，不重复挂
    if (!doc || typeof doc.addEventListener !== "function") return;
    escHandler = onEscKey;
    doc.addEventListener("keydown", escHandler);
  }

  function unbindEsc(doc) {
    if (!escHandler) return;
    var d = doc || getDoc();
    try {
      if (d && typeof d.removeEventListener === "function") d.removeEventListener("keydown", escHandler);
    } catch (e) {}
    escHandler = null; // 无论 remove 是否成功都清引用，确保不会累积
  }

  /**
   * 打开遮罩并展示大图。
   * @param {string} src 被点二维码当前的 src（取不到时静默返回 false）
   * @returns {boolean} 是否已打开
   */
  function open(src) {
    try {
      var value = typeof src === "string" ? src.trim() : "";
      if (!value) return false; // 拿不到 src：静默返回
      var doc = getDoc();
      if (!doc || !doc.body) return false; // 拿不到 document.body：静默返回
      var ov = ensureOverlay(doc);
      if (!ov || !overlayImg) return false;
      overlayImg.src = value;
      ov.style.display = "flex";
      isOpen = true;
      bindEsc(doc);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 关闭遮罩：隐藏节点（保留复用），解绑 Esc 监听 */
  function close() {
    try {
      if (overlay) overlay.style.display = "none";
      isOpen = false;
      unbindEsc(getDoc());
    } catch (e) {}
  }

  /** document 级点击委托：遮罩打开时点任意处关闭；否则命中二维码才放大 */
  function onDocumentClick(ev) {
    try {
      if (isOpen) {
        close();
        return;
      }
      var target = resolveTarget(ev);
      if (!target) return;
      open(target.src || "");
    } catch (e) {
      // 任何异常都不得外抛
    }
  }

  /** 挂载事件委托（幂等：重复调用只生效一次） */
  function init() {
    try {
      var doc = getDoc();
      if (!doc || typeof doc.addEventListener !== "function") return false; // 无宿主：静默返回
      if (installed) return true;
      installed = true;
      doc.addEventListener("click", onDocumentClick);
      return true;
    } catch (e) {
      return false;
    }
  }

  global.WpsAiQrZoom = {
    __installed: true,
    TARGET_SELECTOR: TARGET_SELECTOR,
    matchesTarget: matchesTarget, // 命中判断（单测用）
    resolveTarget: resolveTarget, // 向上查找命中节点（单测用）
    open: open,
    close: close,
    init: init,
    isOpen: function () { return isOpen; },
    _getOverlay: function () { return overlay; }, // 测试/调试用
    _getOverlayImg: function () { return overlayImg; } // 测试/调试用
  };

  init();
})(typeof window !== "undefined" ? window : global);
