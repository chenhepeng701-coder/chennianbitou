/**
 * 信创字体兼容检测与自动降级 (§3.4)
 * 纯 WPS JSAPI + 原生 JS，离线本地运行，零 AI、零联网、零 npm 依赖。
 *
 * 核心职责：
 * 1. 字体检测：只读检测，严禁修改文档或选区，优先通过 Application.FontNames 枚举系统已装字体，
 *    WPS 接口不可用时通过面板内 canvas measureText 探针探测。
 * 2. 自动降级：按标准公文字体候选链挑出首个真实存在的系统字体；候选链全军覆没时保留原标准字体名。
 * 3. 真正生效：就地改写 window.WpsAiGovFormat.FORMAT_CONFIG，并提供 resolveFont 钩子确保排版和五个小按钮生效。
 * 4. 黄色提示条：仅在确实有字体缺失时显示在面板顶部，包含一键安装包领取文案与具体降级明细，支持会话内关闭。
 */

(function attachFontCompat(global) {
  "use strict";

  // GB/T 9704 四个标准公文字体与其降级候选链（按优先级排序）
  const FONT_CHAINS = Object.freeze({
    "方正小标宋简体": Object.freeze([
      "方正小标宋简体",
      "方正小标宋_GBK",
      "FZXiaoBiaoSong-B05S",
      "华文中宋",
      "STZhongsong",
      "宋体",
      "SimSun"
    ]),
    "黑体": Object.freeze([
      "黑体",
      "SimHei",
      "思源黑体",
      "Source Han Sans SC",
      "Noto Sans CJK SC",
      "文泉驿微米黑",
      "WenQuanYi Micro Hei"
    ]),
    "楷体_GB2312": Object.freeze([
      "楷体_GB2312",
      "楷体",
      "KaiTi",
      "楷体_GB18030",
      "华文楷体",
      "STKaiti",
      "AR PL UKai CN"
    ]),
    "仿宋_GB2312": Object.freeze([
      "仿宋_GB2312",
      "仿宋",
      "FangSong",
      "FangSong_GB2312",
      "华文仿宋",
      "STFangsong",
      "AR PL UMing CN"
    ])
  });

  // 宪法规定的标准警告文案（一字不差）
  const BANNER_MAIN_TEXT =
    "检测到当前系统缺失标准公文字体，扫码免费领取《Win/统信/麒麟公文字体一键安装包》";

  // 内存状态：会话内是否已被用户点击「×」关闭（不重复弹扰用户）
  let isBannerDismissed = false;

  // 缓存：系统字体集合（Set）与标准字体降级映射表
  let cachedSystemFonts = null;
  let cachedResolvedMap = {};
  let lastDetectionResult = null;

  // 规范化字体名比较（去除首尾空格、忽略大小写）
  function normalizeFontName(name) {
    return String(name || "").trim().toLowerCase();
  }

  /**
   * 只读途径 1：通过 WPS Application.FontNames 集合枚举系统已安装字体
   * 不改动文档，不改动选区，严格 try/catch
   */
  function enumerateWpsFonts(app) {
    if (!app) return null;
    try {
      const fn = app.FontNames;
      if (!fn) return null;
      const count = Number(fn.Count) || 0;
      if (count > 0) {
        const set = new Set();
        for (let i = 1; i <= count; i++) {
          try {
            const item = fn.Item(i);
            if (item && typeof item === "string") {
              set.add(normalizeFontName(item));
            }
          } catch (e) {}
        }
        if (set.size > 0) {
          return set;
        }
      }
    } catch (e) {}
    return null;
  }

  // 同步获取当前宿主环境的 WPS Application
  function getSyncWpsApp() {
    return (
      global.Application ||
      global.wps?.WpsApplication?.() ||
      global.wps?.Application ||
      null
    );
  }

  /**
   * 只读途径 2：面板内 DOM 探针（WPS 拿不到 FontNames 时降级探测）
   * 原理：用 canvas measureText 对比「候选字体名, monospace」与纯「monospace」
   * 探针文字：「公文格式测试」
   * 若宽度相同（或绝对差值 < 0.2px），即判定该候选字体在系统中不存在
   */
  const PROBE_TEXT = "公文格式测试";
  const PROBE_BASE_FONT = "monospace";
  const PROBE_FONT_SIZE = "72px";

  function probeFontWithCanvas(fontName) {
    if (typeof document === "undefined") return false;
    try {
      const canvas = document.createElement("canvas");
      if (!canvas || typeof canvas.getContext !== "function") return false;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof ctx.measureText !== "function") return false;

      // 测算纯 monospace 基础宽度
      ctx.font = `${PROBE_FONT_SIZE} ${PROBE_BASE_FONT}`;
      const baseWidth = ctx.measureText(PROBE_TEXT).width;

      // 测算「候选字体名, monospace」宽度
      ctx.font = `${PROBE_FONT_SIZE} "${fontName}", ${PROBE_BASE_FONT}`;
      const testWidth = ctx.measureText(PROBE_TEXT).width;

      // 宽度差值小于 0.2px 时说明系统未装该字体，回退成了 monospace
      return Math.abs(testWidth - baseWidth) >= 0.2;
    } catch (e) {
      return false;
    }
  }

  /**
   * 检测单个字体是否在当前系统存在（只读，零网络，不污染文档）
   * @param {string} fontName 待检测字体名
   * @param {Set<string>|null} systemFontSet 可选的 WPS 枚举字体集合
   */
  function isFontAvailable(fontName, systemFontSet) {
    if (!fontName) return false;
    const norm = normalizeFontName(fontName);

    // 优先使用 WPS 宿主枚举的字体集合
    const fontSet = systemFontSet || cachedSystemFonts;
    if (fontSet && fontSet.size > 0) {
      return fontSet.has(norm);
    }

    // 备用：Canvas measureText 探针探测
    return probeFontWithCanvas(fontName);
  }

  /**
   * 解析字体降级结果：挑出候选链中第一个真实存在的字体
   * 若候选链全军覆没，保留原标准字体名不硬改
   * @param {string} standardFontName 标准字体名
   * @returns {string} 实际写入文档的字体名
   */
  function resolveFont(standardFontName) {
    if (!standardFontName) return standardFontName;

    // 若当前已在缓存映射中，直接返回
    if (cachedResolvedMap[standardFontName]) {
      return cachedResolvedMap[standardFontName];
    }

    const chain = FONT_CHAINS[standardFontName];
    if (!chain || chain.length === 0) {
      return standardFontName;
    }

    for (let i = 0; i < chain.length; i++) {
      const candidate = chain[i];
      if (isFontAvailable(candidate, cachedSystemFonts)) {
        cachedResolvedMap[standardFontName] = candidate;
        return candidate;
      }
    }

    // 全军覆没时返回原标准名
    cachedResolvedMap[standardFontName] = standardFontName;
    return standardFontName;
  }

  /**
   * 就地改写 window.WpsAiGovFormat.FORMAT_CONFIG
   * 直接更新对象的属性值，不重建对象，确保外部引用立刻感知
   */
  function applyFallbackToConfigs(resolvedMap) {
    if (!resolvedMap) return;
    const govConfig = global.WpsAiGovFormat?.FORMAT_CONFIG;
    if (govConfig) {
      if (govConfig.TITLE && resolvedMap["方正小标宋简体"]) {
        govConfig.TITLE.fontName = resolvedMap["方正小标宋简体"];
      }
      if (govConfig.HEADING_1 && resolvedMap["黑体"]) {
        govConfig.HEADING_1.fontName = resolvedMap["黑体"];
      }
      if (govConfig.HEADING_2 && resolvedMap["楷体_GB2312"]) {
        govConfig.HEADING_2.fontName = resolvedMap["楷体_GB2312"];
      }
      if (govConfig.HEADING_3 && resolvedMap["仿宋_GB2312"]) {
        govConfig.HEADING_3.fontName = resolvedMap["仿宋_GB2312"];
      }
      if (govConfig.BODY && resolvedMap["仿宋_GB2312"]) {
        govConfig.BODY.fontName = resolvedMap["仿宋_GB2312"];
      }
    }
  }

  /**
   * 刷新面板顶部黄色警告提示条
   * - 仅在确实有字体缺失时显示
   * - 四个字体齐全时绝对不显示
   * - 用户点击关闭后本会话不再弹出
   */
  function updateBannerUI(result) {
    if (typeof document === "undefined") return;
    const banner = document.getElementById("fontWarningBanner");
    const detail = document.getElementById("fontWarningDetail");
    if (!banner) return;

    if (!result || !result.hasMissing || isBannerDismissed) {
      banner.classList.add("hidden");
      return;
    }

    if (detail) {
      if (result.missingDetails && result.missingDetails.length > 0) {
        const detailText =
          "缺失：" +
          result.missingDetails
            .map(item => `${item.standard}→${item.fallback}`)
            .join("；");
        detail.textContent = detailText;
        detail.classList.remove("hidden");
      } else {
        detail.textContent = "";
        detail.classList.add("hidden");
      }
    }

    banner.classList.remove("hidden");
  }

  /**
   * 核心检测入口：检测四个公文字体并计算降级
   * @param {object} [appInstance] 可选的 WPS Application 实例
   * @returns {object} 检测与降级详情
   */
  function detectFonts(appInstance) {
    const app = appInstance || getSyncWpsApp();
    const wpsFonts = enumerateWpsFonts(app);
    if (wpsFonts && wpsFonts.size > 0) {
      cachedSystemFonts = wpsFonts;
    }

    const standardKeys = ["方正小标宋简体", "黑体", "楷体_GB2312", "仿宋_GB2312"];
    const resolved = {};
    const available = {};
    const missing = [];
    const missingDetails = [];

    for (let i = 0; i < standardKeys.length; i++) {
      const std = standardKeys[i];
      const isStdAvail = isFontAvailable(std, cachedSystemFonts);
      available[std] = isStdAvail;

      const chain = FONT_CHAINS[std] || [std];
      let chosen = std;
      let found = false;

      for (let j = 0; j < chain.length; j++) {
        const cand = chain[j];
        if (isFontAvailable(cand, cachedSystemFonts)) {
          chosen = cand;
          found = true;
          break;
        }
      }

      if (!found) {
        // 候选链全军覆没，保留原标准名
        chosen = std;
      }

      resolved[std] = chosen;

      if (!isStdAvail) {
        missing.push(std);
        missingDetails.push({
          standard: std,
          fallback: chosen
        });
      }
    }

    cachedResolvedMap = { ...resolved };

    const result = {
      available,
      resolved,
      missing,
      missingDetails,
      hasMissing: missing.length > 0,
      detectedAt: Date.now()
    };

    lastDetectionResult = result;

    // 1. 就地改写排版配置中的 fontName
    applyFallbackToConfigs(resolved);

    // 2. 更新面板 UI 提示条
    updateBannerUI(result);

    return result;
  }

  // 显式显示提示条（如果当前存在缺失）
  function showBanner() {
    if (lastDetectionResult) {
      isBannerDismissed = false;
      updateBannerUI(lastDetectionResult);
    } else {
      detectFonts();
    }
  }

  // 关闭提示条（本次会话保持隐藏）
  function hideBanner() {
    isBannerDismissed = true;
    if (typeof document !== "undefined") {
      const banner = document.getElementById("fontWarningBanner");
      if (banner) banner.classList.add("hidden");
    }
  }

  /**
   * 初始化 UI 交互与按钮点击前复检机制
   */
  function initUI() {
    if (typeof document === "undefined") return;

    // 1. 绑定提示条关闭按钮
    const closeBtn = document.getElementById("fontWarningCloseBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        hideBanner();
      });
    }

    // 2. 按钮点击前复检机制（采用捕获阶段 capture: true 优先执行）
    // 覆盖排版卡片主按钮与五个样式小按钮
    const targetButtonIds = [
      "btnGovFormat",
      "btnStyleTitle",
      "btnStyleH1",
      "btnStyleH2",
      "btnStyleH3",
      "btnStyleBody"
    ];

    targetButtonIds.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.addEventListener(
          "click",
          () => {
            try {
              detectFonts();
            } catch (e) {}
          },
          true // 捕获阶段，确保排版逻辑取到最新降级结果
        );
      }
    });

    // 3. 面板初始化时执行首次检测
    detectFonts();
  }

  // 导出全局对象 window.WpsAiFontCompat
  const WpsAiFontCompat = {
    FONT_CHAINS,
    BANNER_MAIN_TEXT,
    detectFonts,
    resolveFont,
    isFontAvailable,
    showBanner,
    hideBanner,
    initUI,
    getLastDetectionResult: () => lastDetectionResult,
    isDismissed: () => isBannerDismissed,
    setDismissed: val => {
      isBannerDismissed = Boolean(val);
    },
    resetDismissed: () => {
      isBannerDismissed = false;
    }
  };

  global.WpsAiFontCompat = WpsAiFontCompat;

  // 页面加载完成后自动初始化
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initUI);
    } else {
      initUI();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
