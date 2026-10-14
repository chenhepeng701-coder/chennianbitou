/**
 * 一键公文排版 (GB/T 9704)
 * 纯 WPS JSAPI 实现，零 AI 依赖，离线本地运行。
 *
 * 排版标准：
 * 1. 页边距：上 37mm、下 35mm、左 28mm、右 26mm (A4 纵向)
 * 2. 大标题：二号 (22pt) 方正小标宋简体，居中，首行缩进 0
 * 3. 一级标题（以「一、二、三…」开头）：三号 (16pt) 黑体，两端对齐，首行缩进 2 字符
 * 4. 二级标题（以「（一）（二）…」开头）：三号 (16pt) 楷体_GB2312，两端对齐，首行缩进 2 字符
 * 5. 三级标题（以「1. 2.」开头）：三号 (16pt) 仿宋_GB2312 加粗，两端对齐，首行缩进 2 字符
 * 6. 正文：三号 (16pt) 仿宋_GB2312，两端对齐，首行缩进 2 字符
 * 7. 行距：固定值 28 磅 (wdLineSpaceExactly = 4)
 */

(function attachGovFormat(global) {
  "use strict";

  // GB/T 9704 标准排版配置
  const FORMAT_CONFIG = {
    TITLE: {
      name: "大标题",
      fontName: "方正小标宋简体",
      size: 22, // 二号
      bold: false,
      align: "center",
      indentChars: 0,
      lineSpacingPt: 28
    },
    HEADING_1: {
      name: "一级标题",
      fontName: "黑体",
      size: 16, // 三号
      bold: false,
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    },
    HEADING_2: {
      name: "二级标题",
      fontName: "楷体_GB2312",
      size: 16, // 三号
      bold: false,
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    },
    HEADING_3: {
      name: "三级标题",
      fontName: "仿宋_GB2312",
      size: 16, // 三号
      bold: true, // 加粗
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    },
    BODY: {
      name: "正文",
      fontName: "仿宋_GB2312",
      size: 16, // 三号
      bold: false,
      align: "justify",
      indentChars: 2,
      lineSpacingPt: 28
    }
  };

  /**
   * 段落分类逻辑（按段落文本自动识别）
   * - 第一个非空段落视为大标题
   * - 以「一、二、三…」开头的判一级
   * - 以「（一）（二）…」开头的判二级
   * - 以「1. 2.」开头的判三级
   * - 其余按正文
   */
  function classifyParagraph(rawText, isFirstNonEmpty) {
    const clean = String(rawText || "")
      .replace(/[\r\n\x07\f\v]/g, "")
      .trim();

    if (!clean) {
      return { type: "EMPTY", clean: "" };
    }

    if (isFirstNonEmpty) {
      return { type: "TITLE", clean };
    }

    // 一级标题：以「一、二、三…」开头（兼容顿号、点号与全角点）
    if (/^[一二三四五六七八九十百]+[、.．]/.test(clean)) {
      return { type: "HEADING_1", clean };
    }

    // 二级标题：以「（一）（二）…」开头（兼容全角与半角括号）
    if (/^[（(][一二三四五六七八九十百]+[）)]/.test(clean)) {
      return { type: "HEADING_2", clean };
    }

    // 三级标题：以「1. 2.」开头（兼容全角半角数字、点号和顿号）
    if (/^[0-9０-９]+[、.．]/.test(clean)) {
      return { type: "HEADING_3", clean };
    }

    return { type: "BODY", clean };
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

  // 毫米转磅 (1mm = 72/25.4 pt ≈ 2.83465 pt)
  function mmToPoints(app, mm) {
    try {
      if (app && typeof app.MillimetersToPoints === "function") {
        return app.MillimetersToPoints(mm);
      }
    } catch (e) {}
    return mm * (72 / 25.4);
  }

  // 设置页边距（GB/T 9704：上 37mm、下 35mm、左 28mm、右 26mm）
  function applyPageSetup(doc, app) {
    if (!doc) return;
    const top = mmToPoints(app, 37);
    const bottom = mmToPoints(app, 35);
    const left = mmToPoints(app, 28);
    const right = mmToPoints(app, 26);

    try {
      const ps = doc.PageSetup;
      if (ps) {
        try { ps.TopMargin = top; } catch (e) {}
        try { ps.BottomMargin = bottom; } catch (e) {}
        try { ps.LeftMargin = left; } catch (e) {}
        try { ps.RightMargin = right; } catch (e) {}
        try { ps.PaperSize = 7; } catch (e) {} // wdPaperA4 = 7
        try { ps.Orientation = 0; } catch (e) {} // wdOrientPortrait = 0
      }
    } catch (e) {}

    try {
      const sections = doc.Sections;
      const count = Number(sections?.Count) || 0;
      for (let i = 1; i <= count; i++) {
        try {
          const secPs = sections.Item(i)?.PageSetup;
          if (secPs) {
            try { secPs.TopMargin = top; } catch (e) {}
            try { secPs.BottomMargin = bottom; } catch (e) {}
            try { secPs.LeftMargin = left; } catch (e) {}
            try { secPs.RightMargin = right; } catch (e) {}
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // 应用字体设置
  function applyFont(range, config) {
    if (!range) return;
    let font = null;
    try { font = range.Font; } catch (e) {}
    if (!font) return;

    const fontName = (global.WpsAiFontCompat?.resolveFont ? global.WpsAiFontCompat.resolveFont(config.fontName) : config.fontName);
    if (fontName) {
      try { font.Name = fontName; } catch (e) {}
      try { font.NameFarEast = fontName; } catch (e) {}
      try { font.NameAscii = fontName; } catch (e) {}
      try { font.NameOther = fontName; } catch (e) {}
    }
    if (typeof config.size === "number") {
      try { font.Size = config.size; } catch (e) {}
    }
    if (typeof config.bold === "boolean") {
      try {
        font.Bold = config.bold;
      } catch (e) {
        try { font.Bold = config.bold ? 1 : 0; } catch (e2) {}
      }
    }
    try { font.Italic = false; } catch (e) {}
    try { font.Underline = 0; } catch (e) {}
  }

  // 应用段落格式
  function applyParaFormat(p, config) {
    if (!p) return;
    let pf = null;
    try { pf = p.Format || p.Range?.ParagraphFormat || p.ParagraphFormat; } catch (e) {}
    if (!pf) return;

    // 1. 对齐方式
    try {
      if (config.align === "center") {
        pf.Alignment = 1; // wdAlignParagraphCenter
      } else {
        pf.Alignment = 3; // wdAlignParagraphJustify (两端对齐)
      }
    } catch (e) {
      try { pf.Alignment = (config.align === "center" ? 1 : 0); } catch (e2) {}
    }

    // 2. 行距：固定值 28 磅 (wdLineSpaceExactly = 4)
    try {
      pf.LineSpacingRule = 4;
      pf.LineSpacing = config.lineSpacingPt || 28;
    } catch (e) {}

    // 3. 段前段后 0 磅
    try { pf.SpaceBefore = 0; } catch (e) {}
    try { pf.SpaceAfter = 0; } catch (e) {}
    try { pf.SpaceBeforeAuto = 0; } catch (e) {}
    try { pf.SpaceAfterAuto = 0; } catch (e) {}

    // 4. 首行缩进
    try {
      if (config.indentChars === 0) {
        try { pf.CharacterUnitFirstLineIndent = 0; } catch (e) {}
        try { pf.FirstLineIndent = 0; } catch (e) {}
      } else if (config.indentChars > 0) {
        let setByUnit = false;
        try {
          pf.CharacterUnitFirstLineIndent = config.indentChars;
          setByUnit = true;
        } catch (e) {}
        if (!setByUnit || pf.CharacterUnitFirstLineIndent !== config.indentChars) {
          pf.FirstLineIndent = config.indentChars * (config.size || 16);
        }
      }
      try { pf.CharacterUnitLeftIndent = 0; } catch (e) {}
      try { pf.LeftIndent = 0; } catch (e) {}
      try { pf.CharacterUnitRightIndent = 0; } catch (e) {}
      try { pf.RightIndent = 0; } catch (e) {}
    } catch (e) {}
  }

  // 格式化空段落
  function applyEmptyParaFormat(p) {
    if (!p) return;
    let pf = null;
    try { pf = p.Format || p.Range?.ParagraphFormat || p.ParagraphFormat; } catch (e) {}
    if (!pf) return;
    try {
      pf.LineSpacingRule = 4;
      pf.LineSpacing = 28;
      pf.SpaceBefore = 0;
      pf.SpaceAfter = 0;
      pf.SpaceBeforeAuto = 0;
      pf.SpaceAfterAuto = 0;
    } catch (e) {}
  }

  // 执行全文排版核心方法
  async function formatCurrentDocument() {
    const app = await getWpsApplication();
    if (!app) {
      throw new Error("未检测到 WPS 运行环境，请确保插件在 WPS 文字中运行。");
    }

    const doc = await getActiveDocument(app);
    if (!doc) {
      throw new Error("未检测到打开的文档，请先打开需要排版的公文。");
    }

    const paras = doc.Paragraphs || doc.Content?.Paragraphs;
    if (!paras) {
      throw new Error("无法读取文档段落，请确认当前文档为 WPS 文字文档。");
    }

    const totalParas = Number(paras.Count) || 0;
    if (totalParas === 0) {
      throw new Error("当前文档没有可排版的段落。");
    }

    // 开启 UndoRecord（如宿主支持）
    let undoRecord = null;
    try {
      undoRecord = app.UndoRecord;
      if (undoRecord) undoRecord.BeginCustomRecord("一键公文排版(GB/T 9704)");
    } catch (e) {}

    // 关闭屏幕刷新以提升排版速度
    try {
      app.ScreenUpdating = false;
    } catch (e) {}

    const stats = {
      title: 0,
      heading_1: 0,
      heading_2: 0,
      heading_3: 0,
      body: 0,
      empty: 0,
      tableParas: 0
    };

    try {
      // 1. 设置页边距
      applyPageSetup(doc, app);

      // 2. 逐段识别并应用格式
      let firstNonEmptyFound = false;

      for (let i = 1; i <= totalParas; i++) {
        let p = null;
        try {
          p = paras.Item(i);
        } catch (e) {
          continue;
        }
        if (!p) continue;

        // 检查是否在表格内
        let inTable = false;
        try {
          inTable = Boolean(p.Range?.Information?.(12) || (p.Range?.Tables && p.Range.Tables.Count > 0));
        } catch (e) {}

        const rawText = String(p.Range?.Text || "");
        const clean = rawText.replace(/[\r\n\x07\f\v]/g, "").trim();

        if (!clean) {
          stats.empty++;
          applyEmptyParaFormat(p);
          continue;
        }

        if (inTable) {
          // 表格内段落：三号或小四仿宋，不首行缩进，不计为主标题
          applyFont(p.Range, { fontName: "仿宋_GB2312", size: 14, bold: false });
          applyParaFormat(p, { align: "justify", indentChars: 0, lineSpacingPt: 22 });
          stats.tableParas++;
          continue;
        }

        const isFirstNonEmpty = !firstNonEmptyFound;
        const classification = classifyParagraph(clean, isFirstNonEmpty);

        if (isFirstNonEmpty) {
          firstNonEmptyFound = true;
        }

        const config = FORMAT_CONFIG[classification.type];
        if (config) {
          applyFont(p.Range, config);
          applyParaFormat(p, config);
          const key = classification.type.toLowerCase();
          stats[key] = (stats[key] || 0) + 1;
        }
      }
    } finally {
      // 恢复屏幕刷新
      try {
        app.ScreenUpdating = true;
      } catch (e) {}

      // 结束 UndoRecord
      try {
        if (undoRecord) undoRecord.EndCustomRecord();
      } catch (e) {}
    }

    return stats;
  }

  // 初始化 UI 交互
  function initUI() {
    const card = document.getElementById("govFormatCard");
    const toggleBtn = document.getElementById("govFormatCardToggle");
    const actionBtn = document.getElementById("btnGovFormat");
    const statusBox = document.getElementById("govFormatStatus");

    function setStatus(msg, type) {
      if (!statusBox) return;
      statusBox.className = "gov-format-status " + (type || "info");
      statusBox.textContent = msg;
      statusBox.classList.remove("hidden");
    }

    // 折叠/展开控制
    if (toggleBtn && card) {
      toggleBtn.addEventListener("click", () => {
        const isCollapsed = card.classList.contains("collapsed");
        if (isCollapsed) {
          card.classList.remove("collapsed");
          card.classList.add("expanded");
          toggleBtn.setAttribute("aria-expanded", "true");
        } else {
          card.classList.remove("expanded");
          card.classList.add("collapsed");
          toggleBtn.setAttribute("aria-expanded", "false");
        }
      });
    }

    // 一键排版点击事件
    if (actionBtn) {
      actionBtn.addEventListener("click", async () => {
        actionBtn.disabled = true;
        setStatus("正在排版当前文档，请稍候...", "info");

        try {
          const stats = await formatCurrentDocument();
          const totalFormatted =
            stats.title + stats.heading_1 + stats.heading_2 + stats.heading_3 + stats.body;
          const detail = [
            `大标题 ${stats.title} 个`,
            `一级标题 ${stats.heading_1} 个`,
            `二级标题 ${stats.heading_2} 个`,
            `三级标题 ${stats.heading_3} 个`,
            `正文 ${stats.body} 段`
          ].join("、");

          setStatus(
            `排版完成！已严格按 GB/T 9704 标准规范页边距与各级格式（共处理 ${totalFormatted} 段：${detail}）。`,
            "success"
          );
        } catch (err) {
          setStatus("排版失败：" + (err?.message || String(err)), "error");
        } finally {
          actionBtn.disabled = false;
        }
      });
    }
  }

  // 暴露公共接口
  global.WpsAiGovFormat = {
    FORMAT_CONFIG,
    classifyParagraph,
    formatCurrentDocument,
    applyPageSetup,
    applyFont,
    applyParaFormat,
    initUI
  };

  // 绑定初始化事件
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initUI);
    } else {
      initUI();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
