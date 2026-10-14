/**
 * 私域引流卡片模块 (§3.5)
 * 纯原生 JS，离线本地运行，零 AI、零联网、零 npm 依赖。
 *
 * 核心职责：
 * 1. 占位符集中配置：单一真理源（Single Source of Truth），统一管理二维码路径、官网链接、CTA文案等。
 * 2. 回填 DOM：页面加载时自动将 CONFIG 回填至卡片对应节点，避免多处配置脱节。
 * 3. 链接打开与三级兜底（统一姿势集中在 openExternal，全仓库唯一实现）：
 *    - 一级：优先 WPS 原生接口 global.wps.OAAssist.ShellExecute（唤起系统浏览器）
 *    - 二级：若宿主不支持，用 JS 兜底：window.open(url, "_blank", "noopener,noreferrer")
 *    - 三级：若仍失败或被拦截，将网址展示为可选中复制的文本提示用户手动打开（不弹窗、不抛异常、不静默失败）
 *
 *    注意：WPS 并不存在 wps.OpenUrl / app.OpenUrl 接口，禁止使用（用了也永远进不去，只会白白丢掉一次跳转机会）。
 */

(function attachPromoCard(global) {
  "use strict";

  // ↓↓↓ 上线前只需替换这里的配置 ↓↓↓
  const CONFIG = Object.freeze({
    QR_IMAGE_PATH: "./img/qrcode.jpg",
    SITE_URL: "http://ape.xiaolvzhilian.com/index.php?mod=mobile&act=shopwap&do=service&beid=70&shareid=U240323092873558953",
    CTA_TEXT: "陈年笔头网 · 120万篇公文素材库",
    CTA_SUB_TEXT: "每日更新：党课讲稿、述职述廉、年终总结、讲话致辞等公文材料",
    SITE_BTN_TEXT: "进入陈年笔头网",
    WECHAT_CONTACT: "" // 留空占位：上线前填客服微信号或留空
  });

  /**
   * 将配置同步回填至卡片 DOM 元素（单一真理源）
   */
  function applyConfigToDom() {
    try {
      const qrImg = document.getElementById("promoQrImg");
      const ctaText = document.getElementById("promoCtaText");
      const ctaSub = document.getElementById("promoCtaSub");
      const siteBtn = document.getElementById("promoSiteBtn");
      const fallbackUrl = document.getElementById("promoFallbackUrl");
      const wechatEl = document.getElementById("promoWechatContact");

      if (qrImg && CONFIG.QR_IMAGE_PATH) {
        qrImg.src = CONFIG.QR_IMAGE_PATH;
        qrImg.alt = "扫码添加客服";
      }

      if (ctaText && CONFIG.CTA_TEXT) {
        ctaText.textContent = CONFIG.CTA_TEXT;
      }

      if (ctaSub && CONFIG.CTA_SUB_TEXT) {
        ctaSub.textContent = CONFIG.CTA_SUB_TEXT;
      }

      if (siteBtn) {
        if (CONFIG.SITE_BTN_TEXT) {
          siteBtn.textContent = CONFIG.SITE_BTN_TEXT;
        }
        if (CONFIG.SITE_URL) {
          siteBtn.href = CONFIG.SITE_URL;
        }
      }

      if (fallbackUrl && CONFIG.SITE_URL) {
        fallbackUrl.textContent = CONFIG.SITE_URL;
      }

      if (wechatEl) {
        if (CONFIG.WECHAT_CONTACT && CONFIG.WECHAT_CONTACT.trim() !== "") {
          wechatEl.textContent = "客服微信：" + CONFIG.WECHAT_CONTACT.trim();
          wechatEl.classList.remove("hidden");
        } else {
          wechatEl.textContent = "";
          wechatEl.classList.add("hidden");
        }
      }
    } catch (err) {
      // 容错保护：静默捕获不抛异常
    }
  }

  /**
   * 复制文本到剪贴板（离线安全实现，降级到 execCommand）
   */
  function copyTextToClipboard(text) {
    if (!text) return;
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        navigator.clipboard.writeText(text).catch(function () {});
        return;
      }
    } catch (e) {}

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      ta.setAttribute("readonly", "");
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch (e2) {}
  }

  /**
   * 展示兜底提示行：打不开？复制链接到浏览器：http://ape.xiaolvzhilian.com/index.php?mod=mobile&act=shopwap&do=service&beid=70&shareid=U240323092873558953
   */
  function showFallbackUrl(url) {
    try {
      const targetUrl = url || CONFIG.SITE_URL || "http://ape.xiaolvzhilian.com/index.php?mod=mobile&act=shopwap&do=service&beid=70&shareid=U240323092873558953";
      const fallbackEl = document.getElementById("promoFallback");
      const fallbackUrlEl = document.getElementById("promoFallbackUrl");

      if (fallbackUrlEl) {
        fallbackUrlEl.textContent = targetUrl;
      }
      if (fallbackEl) {
        fallbackEl.classList.remove("hidden");
      }
    } catch (err) {}
  }

  /**
   * 隐藏兜底提示行
   */
  function hideFallbackUrl() {
    try {
      const fallbackEl = document.getElementById("promoFallback");
      if (fallbackEl) {
        fallbackEl.classList.add("hidden");
      }
    } catch (err) {}
  }

  /**
   * 统一外部跳转姿势（三级降级，顺序写死，DRY：全仓库只此一份实现）
   * ① global.wps.OAAssist.ShellExecute —— WPS 原生唤起系统浏览器的正路
   * ② window.open(url, "_blank", "noopener,noreferrer") —— 返回非 null 且未被 closed 即算成功
   * ③ 都失败 → 返回 false，由调用方展示「打不开？复制链接到浏览器：」兜底行
   *
   * 注意：WPS 没有 wps.OpenUrl / app.OpenUrl 接口，禁止再依赖（那两个分支永远进不去）。
   * @param {string} url 目标地址
   * @returns {boolean} 是否已成功唤起浏览器
   */
  function openExternal(url) {
    if (!url) return false;

    // 一级：WPS 原生 ShellExecute（唤起系统浏览器）
    try {
      if (global.wps && global.wps.OAAssist && typeof global.wps.OAAssist.ShellExecute === "function") {
        global.wps.OAAssist.ShellExecute(url);
        return true;
      }
    } catch (eWps) {
      // 捕获异常，继续降级
    }

    // 二级：宿主 WebView 允许时用 window.open 兜底
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win && !win.closed) {
        return true;
      }
    } catch (eOpen) {
      // 捕获异常，继续降级
    }

    // 三级：交给调用方展示可选中复制的兜底文本，绝不静默失败
    return false;
  }

  /**
   * 处理「进入公文素材库官网」点击事件
   * 调用统一姿势 openExternal：
   * 1. 成功唤起（ShellExecute 或 window.open）→ ev.preventDefault() 阻止 <a> 默认行为，避免双开
   * 2. 都失败 → 不阻止原生 <a> 事件（宿主若支持原生仍有机会触发），
   *    同时展示可选中复制文本兜底（不弹窗、不抛异常、不静默失败）
   */
  function handleSiteLinkClick(ev) {
    const url = CONFIG.SITE_URL || "http://ape.xiaolvzhilian.com/index.php?mod=mobile&act=shopwap&do=service&beid=70&shareid=U240323092873558953";

    if (openExternal(url)) {
      if (ev && typeof ev.preventDefault === "function") {
        ev.preventDefault();
      }
      return;
    }

    // window.open 失败（返回 null 或被拦截抛错）或宿主拦截：
    // 不阻止原生 <a> 事件（让宿主若支持原生时仍有机会触发）；
    // 同时展示可选中复制的兜底文本，绝不静默失败
    showFallbackUrl(url);
  }

  /**
   * 初始化事件监听与绑定
   */
  function initPromoCard() {
    applyConfigToDom();

    const siteBtn = document.getElementById("promoSiteBtn");
    if (siteBtn) {
      siteBtn.addEventListener("click", handleSiteLinkClick);
    }

    const fallbackUrl = document.getElementById("promoFallbackUrl");
    if (fallbackUrl) {
      fallbackUrl.addEventListener("click", function () {
        copyTextToClipboard(CONFIG.SITE_URL);
      });
    }

    const copyBtn = document.getElementById("promoFallbackCopyBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", function (ev) {
        if (ev && typeof ev.stopPropagation === "function") {
          ev.stopPropagation();
        }
        copyTextToClipboard(CONFIG.SITE_URL);
      });
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initPromoCard);
    } else {
      initPromoCard();
    }
  }

  // 挂载到全局命名空间
  global.WpsAiPromoCard = {
    CONFIG: CONFIG,
    applyConfig: applyConfigToDom,
    openSite: handleSiteLinkClick,
    openExternal: openExternal,
    showFallback: showFallbackUrl,
    hideFallback: hideFallbackUrl
  };
})(typeof window !== "undefined" ? window : globalThis);
