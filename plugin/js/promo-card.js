/**
 * 私域引流卡片模块 (§3.5)
 * 纯原生 JS，离线本地运行，零 AI、零联网、零 npm 依赖。
 *
 * 核心职责：
 * 1. 占位符集中配置：单一真理源（Single Source of Truth），统一管理二维码路径、官网链接、CTA文案等。
 * 2. 回填 DOM：页面加载时自动将 CONFIG 回填至卡片对应节点，避免多处配置脱节。
 * 3. 链接打开与三级兜底：
 *    - 一级：优先原生 <a href target="_blank" rel="noopener">
 *    - 二级：若宿主 WebView 拦截，用 JS 兜底：先 window.open(url, "_blank")
 *    - 三级：若仍失败或被拦截，将网址展示为可选中复制的文本提示用户手动打开（不弹窗、不抛异常、不静默失败）
 */

(function attachPromoCard(global) {
  "use strict";

  // ↓↓↓ 上线前只需替换这里的配置 ↓↓↓
  const CONFIG = Object.freeze({
    QR_IMAGE_PATH: "./img/qrcode-placeholder.png",
    SITE_URL: "https://your-site.com",
    CTA_TEXT: "扫码领取《公文格式自查表》+ 10 篇范文",
    SITE_BTN_TEXT: "进入公文素材库官网",
    WECHAT_CONTACT: "" // 留空占位：上线前填客服微信号或留空
  });

  /**
   * 将配置同步回填至卡片 DOM 元素（单一真理源）
   */
  function applyConfigToDom() {
    try {
      const qrImg = document.getElementById("promoQrImg");
      const ctaText = document.getElementById("promoCtaText");
      const siteBtn = document.getElementById("promoSiteBtn");
      const fallbackUrl = document.getElementById("promoFallbackUrl");
      const wechatEl = document.getElementById("promoWechatContact");

      if (qrImg && CONFIG.QR_IMAGE_PATH) {
        qrImg.src = CONFIG.QR_IMAGE_PATH;
        qrImg.alt = "公文素材库二维码";
      }

      if (ctaText && CONFIG.CTA_TEXT) {
        ctaText.textContent = CONFIG.CTA_TEXT;
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
   * 展示兜底提示行：打不开？复制链接到浏览器：https://your-site.com
   */
  function showFallbackUrl(url) {
    try {
      const targetUrl = url || CONFIG.SITE_URL || "https://your-site.com";
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
   * 处理「进入公文素材库官网」点击事件
   * 实现三级打开与兜底策略：
   * 1. 优先原生 <a href target="_blank" rel="noopener">
   * 2. 若宿主 WebView 拦截，用 JS 兜底：先 window.open(url, "_blank")（并支持宿主 WPS API）
   * 3. 若仍失败或被拦截，将 URL 显示为可选中复制文本提示用户手动打开（不弹窗、不抛异常、不静默失败）
   */
  function handleSiteLinkClick(ev) {
    const url = CONFIG.SITE_URL || "https://your-site.com";

    // 检查 WPS 宿主专属打开接口（若宿主环境禁用了原生 target="_blank"，OpenUrl 是最直接的外部浏览器调用）
    try {
      if (global.wps && typeof global.wps.OpenUrl === "function") {
        global.wps.OpenUrl(url);
        if (ev && typeof ev.preventDefault === "function") {
          ev.preventDefault();
        }
        return;
      }
    } catch (eWps) {}

    try {
      if (global.WpsAiAddon && typeof global.WpsAiAddon.getApplicationSync === "function") {
        const app = global.WpsAiAddon.getApplicationSync();
        if (app && typeof app.OpenUrl === "function") {
          app.OpenUrl(url);
          if (ev && typeof ev.preventDefault === "function") {
            ev.preventDefault();
          }
          return;
        }
      }
    } catch (eApp) {}

    // JS 兜底：先 window.open(url, "_blank")
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win && !win.closed) {
        if (ev && typeof ev.preventDefault === "function") {
          ev.preventDefault();
        }
        return;
      }
    } catch (eOpen) {
      // 捕获异常，继续走到可选中复制文本兜底
    }

    // 若 window.open 失败（返回 null 或被拦截抛错）或宿主拦截：
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
    showFallback: showFallbackUrl,
    hideFallback: hideFallbackUrl
  };
})(typeof window !== "undefined" ? window : globalThis);
