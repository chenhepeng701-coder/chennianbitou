/**
 * AI 功能付费钩子模块 (§四)
 * 宪法第四条实现：纯原生 JS，离线本地运行，零 AI 调用、零联网探测、零 npm 依赖。
 *
 * 核心逻辑：
 * - 集中配置常量：客服联系方式、跳转官网、转化提示文案。
 * - 判定是否已配置可用凭据（自填 API Key / Base URL / OAuth 登录态）。
 * - guard(actionName, proceedFn)：已配置 → 直接 proceedFn()（原行为 100% 不变）；未配置 → 弹窗提示，不调用 proceedFn。
 * - 弹窗提供「我已有 API Key，去填」按钮打开项目原有设置入口，不阻断自填 Key 路径。
 */

(function attachPaywall(global) {
  "use strict";

  // ===== 集中配置常量块 =====
  // 客服联系方式：以二维码形式展示（扫码添加客服）。CONTACT 文本可留空，二维码走 CONTACT_QR。
  const CONTACT = "";
  const CONTACT_TIP = "开通获取专属接口与万篇范文库，联系客服：";
  const CONTACT_QR = "./img/qrcode.jpg";
  const SITE_URL = "http://ape.xiaolvzhilian.com/index.php?mod=mobile&act=shopwap&do=service&beid=70&shareid=U240323092873558953";
  const ENABLED = true;

  const CONFIG = {
    CONTACT,
    CONTACT_TIP,
    CONTACT_QR,
    SITE_URL,
    ENABLED
  };

  let _lastUpgradeHint = null;

  /**
   * 判定口径：只要存在任何一种可用凭据（用户自填 API Key / Base URL 配置 / OAuth 登录态）即算已配置。
   * 绝不因为某一种缺失误判为未配置。
   */
  function isConfigured() {
    try {
      // 1. OAuth 登录态（Codex）
      if (global.WpsAiAuth && typeof global.WpsAiAuth.isAuthenticated === "function") {
        if (global.WpsAiAuth.isAuthenticated()) {
          return true;
        }
      }

      // 2. 检查全局注册表或存储中的设置
      let settings = null;
      if (global.WpsAiProviderRegistry && typeof global.WpsAiProviderRegistry.loadSettings === "function") {
        try {
          settings = global.WpsAiProviderRegistry.loadSettings();
        } catch (e) {}
      }

      // 若未从 registry 取到，尝试直接从本地存储读
      if (!settings) {
        try {
          const store = (global.WpsAiStore && typeof global.WpsAiStore.getItem === "function")
            ? global.WpsAiStore
            : (global.localStorage || null);
          const raw = store?.getItem?.("wps_ai_provider_settings_v1");
          if (raw) settings = JSON.parse(raw);
        } catch (e) {}
      }

      if (settings && typeof settings === "object") {
        // 2a. chatProviders 列表（多渠道聊天配置）
        const chatProviders = Array.isArray(settings.chatProviders) ? settings.chatProviders : [];
        for (let i = 0; i < chatProviders.length; i++) {
          const p = chatProviders[i];
          if (!p) continue;
          if (p.apiKey && typeof p.apiKey === "string" && p.apiKey.trim()) {
            return true;
          }
          if (p.type === "codex" && global.WpsAiAuth?.isAuthenticated?.()) {
            return true;
          }
          if (p.baseUrl && typeof p.baseUrl === "string" && p.baseUrl.trim()) {
            if (p.enabled || p.id === "custom" || p.id === "ollama") {
              return true;
            }
          }
        }

        // 2b. 老版 providers 对象（兼容历史导入配置）
        const oldProviders = settings.providers && typeof settings.providers === "object" ? settings.providers : {};
        for (const k in oldProviders) {
          const op = oldProviders[k];
          if (op && op.apiKey && typeof op.apiKey === "string" && op.apiKey.trim()) {
            return true;
          }
        }

        // 2c. 图像渠道 imageProviders
        const imageProviders = Array.isArray(settings.imageProviders) ? settings.imageProviders : [];
        for (let i = 0; i < imageProviders.length; i++) {
          const ip = imageProviders[i];
          if (ip && ip.apiKey && typeof ip.apiKey === "string" && ip.apiKey.trim()) {
            return true;
          }
        }
      }

      // 3. 兜底检查 DOM 中的输入框（如果设置面板在 DOM 中且已被用户填入内容）
      if (typeof document !== "undefined") {
        const keyInputs = document.querySelectorAll?.('input[data-field="apiKey"], #openaiApiKey, #anthropicApiKey');
        if (keyInputs && keyInputs.length > 0) {
          for (let i = 0; i < keyInputs.length; i++) {
            if (keyInputs[i].value && keyInputs[i].value.trim()) {
              return true;
            }
          }
        }
      }

      return false;
    } catch (err) {
      // 容错保护：发生未知异常时兜底放行，不阻断正常业务
      console.warn("[paywall] isConfigured error:", err);
      return true;
    }
  }

  /**
   * 获取联系提示文案（严格照宪法：主文案接客服占位符，为空时显示明确占位，不编造）
   */
  function getContactTipText() {
    // 有二维码时下面直接展示二维码，文案只保留宪法原文，不再显示「待填」占位
    if (CONFIG.CONTACT_QR) return CONFIG.CONTACT_TIP;
    const contact = (CONFIG.CONTACT && CONFIG.CONTACT.trim()) || "（客服联系方式待填）";
    return CONFIG.CONTACT_TIP + contact;
  }

  /**
   * HTML 转义防注入
   */
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * 打开项目原有的设置/凭据配置入口
   */
  function openExistingSettings() {
    try {
      if (typeof document !== "undefined") {
        const btn = document.getElementById("openSettingsModalBtn");
        if (btn && typeof btn.click === "function") {
          btn.click();
          return "openSettingsModalBtn";
        }
      }
      if (typeof global.openSettingsAsDialog === "function") {
        global.openSettingsAsDialog("chat");
        return "openSettingsAsDialog";
      }
      if (typeof global.openSettingsModal === "function") {
        global.openSettingsModal("chat");
        return "openSettingsModal";
      }
      if (typeof document !== "undefined") {
        const modal = document.getElementById("settingsModal");
        if (modal) {
          modal.classList.remove("hidden");
          return "settingsModal";
        }
      }
    } catch (e) {
      console.warn("[paywall] 打开原有设置入口失败:", e);
    }
    return "openSettingsAsDialog";
  }

  /**
   * 统一外部跳转姿势的本地等价实现（与 promo-card.js 的 openExternal 行为完全一致）
   * ① global.wps.OAAssist.ShellExecute —— WPS 原生唤起系统浏览器
   * ② window.open(url, "_blank", "noopener,noreferrer") —— 返回非 null 且未被 closed 即算成功
   * ③ 都失败 → 返回 false，由调用方展示兜底行
   *
   * 注意：WPS 没有 wps.OpenUrl / app.OpenUrl 接口，禁止再依赖（那两个分支永远进不去）。
   * @param {string} url 目标地址
   * @returns {boolean} 是否已成功唤起浏览器
   */
  function openExternalLocal(url) {
    if (!url) return false;

    // 一级：WPS 原生 ShellExecute（唤起系统浏览器）
    try {
      if (global.wps && global.wps.OAAssist && typeof global.wps.OAAssist.ShellExecute === "function") {
        global.wps.OAAssist.ShellExecute(url);
        return true;
      }
    } catch (eWps) {}

    // 二级：宿主 WebView 允许时用 window.open 兜底
    try {
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (win && !win.closed) return true;
    } catch (eOpen) {}

    return false;
  }

  /**
   * 统一跳转入口：优先复用 promo-card.js 导出的 openExternal（DRY，两边行为完全一致），
   * 取不到时用本地等价实现兜底。
   */
  function openExternal(url) {
    const shared = global.WpsAiPromoCard;
    if (shared && typeof shared.openExternal === "function") {
      return !!shared.openExternal(url);
    }
    return openExternalLocal(url);
  }

  /**
   * 官网跳转（复用统一三级打开与兜底策略，不引入新依赖）
   */
  function openSiteUrl(targetUrl) {
    const url = targetUrl || CONFIG.SITE_URL || "http://ape.xiaolvzhilian.com/index.php?mod=mobile&act=shopwap&do=service&beid=70&shareid=U240323092873558953";

    if (openExternal(url)) return;

    if (typeof document !== "undefined") {
      const fb = document.getElementById("paywallFallbackUrl");
      if (fb) {
        fb.textContent = "请复制官网链接至浏览器打开：" + url;
        fb.classList.remove("hidden");
      }
    }
  }

  /**
   * 弹出转化提示弹窗
   */
  function showUpgradeHint(actionName) {
    _lastUpgradeHint = { actionName: actionName || "", tip: getContactTipText() };

    if (typeof document === "undefined") {
      return;
    }

    initUI();
    const modal = document.getElementById("paywallModal");
    if (!modal) return;

    const tipEl = document.getElementById("paywallTipText");
    if (tipEl) {
      tipEl.textContent = getContactTipText();
    }

    const titleEl = document.getElementById("paywallTitle");
    if (titleEl) {
      titleEl.textContent = actionName ? `${actionName} · 提示` : "功能提示";
    }

    const qr = document.getElementById("paywallContactQr");
    if (qr && CONFIG.CONTACT_QR) qr.src = CONFIG.CONTACT_QR;

    const fb = document.getElementById("paywallFallbackUrl");
    if (fb) fb.classList.add("hidden");

    modal.classList.remove("hidden");
  }

  /**
   * 关闭转化提示弹窗
   */
  function closeUpgradeHint() {
    if (typeof document === "undefined") return;
    const modal = document.getElementById("paywallModal");
    if (modal) modal.classList.add("hidden");
  }

  /**
   * 核心付费钩子守卫：
   * 已配置 → 直接 proceedFn()（原行为 100% 不变）；未配置 → 弹提示，不调用 proceedFn。
   */
  function guard(actionName, proceedFn) {
    if (!CONFIG.ENABLED || isConfigured()) {
      if (typeof proceedFn === "function") {
        return proceedFn();
      }
      return;
    }
    showUpgradeHint(actionName);
  }

  /**
   * 初始化弹窗 DOM
   */
  function initUI() {
    if (typeof document === "undefined") return;
    if (document.getElementById("paywallModal")) return;

    const overlay = document.createElement("div");
    overlay.id = "paywallModal";
    overlay.className = "modal-overlay hidden paywall-modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-labelledby", "paywallTitle");

    overlay.innerHTML = `
      <div class="modal-card paywall-modal-card">
        <div class="modal-header">
          <div>
            <h3 id="paywallTitle">功能提示</h3>
            <p id="paywallSubtitle" class="modal-subtitle">当前功能需配置可用模型凭据</p>
          </div>
          <button class="modal-close" id="paywallCloseBtn" type="button" title="关闭" aria-label="关闭">×</button>
        </div>
        <div class="modal-body paywall-modal-body">
          <div class="paywall-tip-box">
            <svg class="paywall-tip-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
            </svg>
            <p id="paywallTipText" class="paywall-tip-text">${escapeHtml(getContactTipText())}</p>
          </div>
          <div class="paywall-contact-qr-wrap">
            <img id="paywallContactQr" class="paywall-contact-qr" src="./img/qrcode.jpg" width="150" alt="扫码添加客服" />
            <p class="paywall-contact-qr-tip">扫码添加客服</p>
          </div>
          <p id="paywallFallbackUrl" class="paywall-fallback-url hidden"></p>
        </div>
        <div class="modal-footer paywall-modal-footer">
          <button id="paywallSiteBtn" class="ghost-btn" type="button">进入公文素材库官网</button>
          <button id="paywallSettingsBtn" class="primary-btn" type="button">我已有 API Key，去填</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 事件绑定
    const closeBtn = document.getElementById("paywallCloseBtn");
    closeBtn?.addEventListener("click", closeUpgradeHint);

    overlay.addEventListener("click", function onOverlayClick(ev) {
      if (ev.target === overlay) {
        closeUpgradeHint();
      }
    });

    const settingsBtn = document.getElementById("paywallSettingsBtn");
    settingsBtn?.addEventListener("click", function onGoSettingsClick() {
      closeUpgradeHint();
      openExistingSettings();
    });

    const siteBtn = document.getElementById("paywallSiteBtn");
    siteBtn?.addEventListener("click", function onGoSiteClick(ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      openSiteUrl(CONFIG.SITE_URL);
    });
  }

  // 页面加载就绪时尝试初始化 DOM 节点
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initUI);
    } else {
      initUI();
    }
  }

  // 导出到全局命名空间
  const PaywallApi = {
    CONFIG,
    isConfigured,
    showUpgradeHint,
    closeUpgradeHint,
    guard,
    initUI,
    openExistingSettings,
    getLastUpgradeHint: () => _lastUpgradeHint
  };

  global.WpsAiPaywall = PaywallApi;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = PaywallApi;
  }
})(typeof window !== "undefined" ? window : global);
