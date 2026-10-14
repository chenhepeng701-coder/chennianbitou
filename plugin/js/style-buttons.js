/**
 * 五个样式小按钮：大标题 / 一级 / 二级 / 三级 / 正文
 * 纯 WPS JSAPI + 原生 JS，离线本地运行，零 AI、零联网、零 npm 依赖。
 *
 * 功能说明：
 * 用户选中段落（或光标停在段落中）后点击对应按钮，即套用 GB/T 9704 公文标准样式。
 * 格式配置直接复用 window.WpsAiGovFormat.FORMAT_CONFIG，并提供内置兜底。
 */

(function attachStyleButtons(global) {
  "use strict";

  // 内置兜底副本（仅当 window.WpsAiGovFormat.FORMAT_CONFIG 取不到时使用）
  const FALLBACK_CONFIG = Object.freeze({
    TITLE: Object.freeze({
      name: "大标题",
      fontName: "方正小标宋简体",
      size: 22, // 二号
      bold: false,
      align: "center",
      indentChars: 0,
      lineSpacingPt: 28
    }),
    HEADING_1: Object.freeze({
      name: "一级标题",
      fontName: "黑体",
      size: 16, // 三号
      bold: false,
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    }),
    HEADING_2: Object.freeze({
      name: "二级标题",
      fontName: "楷体_GB2312",
      size: 16, // 三号
      bold: false,
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    }),
    HEADING_3: Object.freeze({
      name: "三级标题",
      fontName: "仿宋_GB2312",
      size: 16, // 三号
      bold: true, // 加粗
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    }),
    BODY: Object.freeze({
      name: "正文",
      fontName: "仿宋_GB2312",
      size: 16, // 三号
      bold: false,
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    })
  });

  // 安全设置属性，避免某属性在特定 WPS 版本不受支持时抛出异常卡死
  function safeSet(obj, prop, value) {
    if (!obj) return false;
    try {
      obj[prop] = value;
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * 解析格式配置：优先读取 window.WpsAiGovFormat.FORMAT_CONFIG
   */
  function resolveConfig() {
    const govConfig = global.WpsAiGovFormat?.FORMAT_CONFIG;
    if (govConfig && typeof govConfig === "object" && govConfig.TITLE) {
      return govConfig;
    }
    console.warn(
      "[style-buttons] 未检测到 window.WpsAiGovFormat.FORMAT_CONFIG，已使用内置兜底配置。"
    );
    return FALLBACK_CONFIG;
  }

  // 预计算各样式目标配置缓存，避免每次点击重复遍历或重新构建
  let cachedStyles = null;

  function getTargetStyleMap() {
    if (cachedStyles) {
      return cachedStyles;
    }
    const sourceConfig = resolveConfig();
    const map = {};
    const keys = ["TITLE", "HEADING_1", "HEADING_2", "HEADING_3", "BODY"];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const item = sourceConfig[k] || FALLBACK_CONFIG[k];
      map[k] = Object.freeze({
        key: k,
        name: item.name,
        fontName: item.fontName,
        size: item.size,
        bold: Boolean(item.bold),
        align: item.align || "justify",
        indentChars: typeof item.indentChars === "number" ? item.indentChars : 2,
        lineSpacingPt: typeof item.lineSpacingPt === "number" ? item.lineSpacingPt : 28
      });
    }
    cachedStyles = Object.freeze(map);
    return cachedStyles;
  }

  // 获取 WPS Application 实例
  async function getWpsApplication() {
    if (global.WpsAiAddon?.getApplication) {
      try {
        const app = await global.WpsAiAddon.getApplication();
        if (app) return app;
      } catch (e) {}
    }
    return (
      global.Application ||
      global.wps?.WpsApplication?.() ||
      global.wps?.Application ||
      null
    );
  }

  // 获取当前活动文档
  async function getActiveDocument(app) {
    if (!app) return null;
    try {
      if (app.ActiveDocument) return app.ActiveDocument;
    } catch (e) {}
    try {
      if (app.Documents && app.Documents.Count > 0) return app.Documents.Item(1);
    } catch (e) {}
    return null;
  }

  /**
   * 应用字体格式
   * 必须同时设置 Name 与 NameFarEast，防止中文字体被退回为宋体/Calibri
   */
  function applyFontStyle(range, styleConfig) {
    if (!range) return;
    let font = null;
    try {
      font = range.Font;
    } catch (e) {}
    if (!font) return;

    const fontName = (global.WpsAiFontCompat?.resolveFont ? global.WpsAiFontCompat.resolveFont(styleConfig.fontName) : styleConfig.fontName);
    if (fontName) {
      safeSet(font, "Name", fontName);
      safeSet(font, "NameFarEast", fontName);
      safeSet(font, "NameAscii", fontName);
      safeSet(font, "NameOther", fontName);
    }

    if (typeof styleConfig.size === "number") {
      safeSet(font, "Size", styleConfig.size);
    }

    if (typeof styleConfig.bold === "boolean") {
      if (!safeSet(font, "Bold", styleConfig.bold)) {
        safeSet(font, "Bold", styleConfig.bold ? 1 : 0);
      }
    }

    safeSet(font, "Italic", false);
    safeSet(font, "Underline", 0);
  }

  /**
   * 应用段落格式
   * 行距固定值 28 磅（wdLineSpaceExactly = 4），段前段后 0，首行缩进优先字符单位
   */
  function applyParagraphStyle(p, styleConfig) {
    if (!p) return;
    let pf = null;
    try {
      pf = p.Format || p.Range?.ParagraphFormat || p.ParagraphFormat;
    } catch (e) {}
    if (!pf) return;

    // 1. 对齐方式：wdAlignParagraphCenter = 1, wdAlignParagraphJustify = 3
    if (styleConfig.align === "center") {
      if (!safeSet(pf, "Alignment", 1)) {
        safeSet(pf, "Alignment", 1);
      }
    } else {
      if (!safeSet(pf, "Alignment", 3)) {
        safeSet(pf, "Alignment", 0); // 回退居左
      }
    }

    // 2. 行距：固定值 28 磅 (wdLineSpaceExactly = 4)
    safeSet(pf, "LineSpacingRule", 4);
    safeSet(pf, "LineSpacing", styleConfig.lineSpacingPt || 28);

    // 3. 段前段后 0 磅
    safeSet(pf, "SpaceBefore", 0);
    safeSet(pf, "SpaceAfter", 0);
    safeSet(pf, "SpaceBeforeAuto", 0);
    safeSet(pf, "SpaceAfterAuto", 0);

    // 4. 首行缩进：优先 CharacterUnitFirstLineIndent，不支持时回退到磅值
    const indentChars =
      typeof styleConfig.indentChars === "number" ? styleConfig.indentChars : 0;
    if (indentChars === 0) {
      safeSet(pf, "CharacterUnitFirstLineIndent", 0);
      safeSet(pf, "FirstLineIndent", 0);
    } else {
      let setByUnit = false;
      try {
        pf.CharacterUnitFirstLineIndent = indentChars;
        setByUnit = pf.CharacterUnitFirstLineIndent === indentChars;
      } catch (e) {
        setByUnit = false;
      }
      if (!setByUnit) {
        // 回退到磅值：indentChars * 字号 (默认 16pt)
        const pt = indentChars * (styleConfig.size || 16);
        safeSet(pf, "FirstLineIndent", pt);
      }
    }

    // 清零左右缩进
    safeSet(pf, "CharacterUnitLeftIndent", 0);
    safeSet(pf, "LeftIndent", 0);
    safeSet(pf, "CharacterUnitRightIndent", 0);
    safeSet(pf, "RightIndent", 0);
  }

  /**
   * 获取目标段落列表
   * 优先 Application.Selection；若选区为空，则处理光标所在的那个段落
   * 选区跨多个段落时逐段返回，并在表格等边缘场景下稳健防护
   */
  async function getSelectionParagraphs(app, doc) {
    if (!app) return [];

    let sel = null;
    try {
      sel = app.Selection;
    } catch (e) {}

    const paragraphs = [];

    if (sel) {
      // 1. 优先尝试直接从 Selection.Paragraphs 读取
      let paras = null;
      try {
        paras = sel.Paragraphs;
      } catch (e) {}

      if (paras) {
        let count = 0;
        try {
          count = Number(paras.Count) || 0;
        } catch (e) {}

        if (count > 0) {
          for (let i = 1; i <= count; i++) {
            try {
              const p = paras.Item(i);
              if (p) {
                paragraphs.push(p);
              }
            } catch (e) {}
          }
        }
      }

      // 2. 若未取得段落，尝试通过 Selection.Range.Paragraphs 获取
      if (paragraphs.length === 0) {
        let rangeParas = null;
        try {
          rangeParas = sel.Range?.Paragraphs;
        } catch (e) {}
        if (rangeParas) {
          let count = 0;
          try {
            count = Number(rangeParas.Count) || 0;
          } catch (e) {}
          if (count > 0) {
            for (let i = 1; i <= count; i++) {
              try {
                const p = rangeParas.Item(i);
                if (p) paragraphs.push(p);
              } catch (e) {}
            }
          }
        }
      }

      // 3. 若仍为 0（如光标在段内但未选中文本），尝试对 Range 进行段落扩充
      if (paragraphs.length === 0 && sel.Range) {
        try {
          const rng = sel.Range.Duplicate || sel.Range;
          if (typeof rng.Expand === "function") {
            rng.Expand(4); // 4 = wdParagraph
            const expParas = rng.Paragraphs;
            const expCount = Number(expParas?.Count) || 0;
            for (let i = 1; i <= expCount; i++) {
              try {
                const p = expParas.Item(i);
                if (p) paragraphs.push(p);
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    // 4. 兜底保护：若光标处于单一段落文档中
    if (paragraphs.length === 0 && doc) {
      try {
        const docParas = doc.Paragraphs || doc.Content?.Paragraphs;
        const total = Number(docParas?.Count) || 0;
        if (total === 1) {
          const singleP = docParas.Item(1);
          if (singleP) paragraphs.push(singleP);
        }
      } catch (e) {}
    }

    return paragraphs;
  }

  /**
   * 状态提示输出（复用一键公文排版卡片的状态提示区 id=govFormatStatus）
   */
  function showStatus(message, type) {
    if (typeof document === "undefined") return;
    const statusBox = document.getElementById("govFormatStatus");
    if (!statusBox) return;
    statusBox.className = "gov-format-status " + (type || "info");
    statusBox.textContent = message;
    statusBox.classList.remove("hidden");
  }

  /**
   * 核心方法：将指定样式套用到当前选中的段落（支持选区与光标单段）
   * @param {"TITLE"|"HEADING_1"|"HEADING_2"|"HEADING_3"|"BODY"} styleType 样式类型标识
   */
  async function applyStyleToParagraphs(styleType) {
    const styleMap = getTargetStyleMap();
    const styleConfig = styleMap[styleType];
    if (!styleConfig) {
      const err = new Error("未知的样式类型: " + styleType);
      showStatus("套用失败：" + err.message, "error");
      return { success: false, count: 0 };
    }

    const app = await getWpsApplication();
    if (!app) {
      showStatus("未检测到 WPS 运行环境，请确保在 WPS 文字中运行插件。", "error");
      return { success: false, count: 0, style: styleConfig };
    }

    const doc = await getActiveDocument(app);
    if (!doc) {
      showStatus("未检测到打开的文档，请先打开公文文档。", "error");
      return { success: false, count: 0, style: styleConfig };
    }

    // 获取选区涉及的段落
    const paragraphs = await getSelectionParagraphs(app, doc);
    if (!paragraphs || paragraphs.length === 0) {
      showStatus("未检测到可套用样式的段落，请选中段落或将光标置于段落内。", "info");
      return { success: false, count: 0, style: styleConfig };
    }

    // 开启 UndoRecord 方便用户单步撤销
    let undoRecord = null;
    try {
      undoRecord = app.UndoRecord;
      if (undoRecord) {
        undoRecord.BeginCustomRecord("套用公文样式: " + styleConfig.name);
      }
    } catch (e) {}

    // 关闭屏幕刷新提升速度
    try {
      app.ScreenUpdating = false;
    } catch (e) {}

    let appliedCount = 0;
    try {
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        if (!p) continue;

        try {
          // 逐段套用字体属性
          let range = null;
          try {
            range = p.Range;
          } catch (e) {}
          if (range) {
            applyFontStyle(range, styleConfig);
          }

          // 逐段套用段落格式
          applyParagraphStyle(p, styleConfig);

          appliedCount++;
        } catch (errPara) {
          // 单段若有异常（如只读区域），跳过继续处理下一段，绝不中断抛错
        }
      }
    } finally {
      // 恢复屏幕刷新
      try {
        app.ScreenUpdating = true;
      } catch (e) {}

      // 结束撤销批处理
      try {
        if (undoRecord) {
          undoRecord.EndCustomRecord();
        }
      } catch (e) {}
    }

    // 更新状态轻提示
    if (appliedCount > 0) {
      showStatus(`已套用：${styleConfig.name} × ${appliedCount} 段`, "success");
    } else {
      showStatus("未处理任何段落，请检查段落是否处于受保护区域。", "info");
    }

    return {
      success: appliedCount > 0,
      count: appliedCount,
      style: styleConfig
    };
  }

  /**
   * 初始化按钮 UI 与事件监听
   */
  function initUI() {
    if (typeof document === "undefined") return;

    const buttonConfigs = [
      { id: "btnStyleTitle", type: "TITLE" },
      { id: "btnStyleH1", type: "HEADING_1" },
      { id: "btnStyleH2", type: "HEADING_2" },
      { id: "btnStyleH3", type: "HEADING_3" },
      { id: "btnStyleBody", type: "BODY" }
    ];

    const buttons = buttonConfigs
      .map(cfg => document.getElementById(cfg.id))
      .filter(Boolean);

    function setAllDisabled(disabled) {
      buttons.forEach(btn => {
        try {
          btn.disabled = disabled;
        } catch (e) {}
      });
    }

    buttonConfigs.forEach(cfg => {
      const btn = document.getElementById(cfg.id);
      if (!btn) return;

      btn.addEventListener("click", async () => {
        // 点击期间禁用自身及兄弟按钮，防止连点重复执行
        setAllDisabled(true);
        try {
          await applyStyleToParagraphs(cfg.type);
        } catch (err) {
          showStatus("套用失败：" + (err?.message || String(err)), "error");
        } finally {
          setAllDisabled(false);
        }
      });
    });
  }

  // 对外导出公共接口
  const WpsAiStyleButtons = {
    // 五个独立套用函数
    applyTitleStyle: function () {
      return applyStyleToParagraphs("TITLE");
    },
    applyHeading1Style: function () {
      return applyStyleToParagraphs("HEADING_1");
    },
    applyHeading2Style: function () {
      return applyStyleToParagraphs("HEADING_2");
    },
    applyHeading3Style: function () {
      return applyStyleToParagraphs("HEADING_3");
    },
    applyBodyStyle: function () {
      return applyStyleToParagraphs("BODY");
    },

    // 通用套用接口
    applyStyle: applyStyleToParagraphs,

    // 配置与方法
    resolveConfig,
    getTargetStyleMap,
    safeSet,
    applyFontStyle,
    applyParagraphStyle,
    getSelectionParagraphs,
    showStatus,
    initUI,
    FALLBACK_CONFIG
  };

  global.WpsAiStyleButtons = WpsAiStyleButtons;

  // 绑定初始化事件
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initUI);
    } else {
      initUI();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
