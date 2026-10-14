/**
 * 一键清洗格式
 * 纯 WPS JSAPI + 原生 JS，离线本地运行，零 AI、零联网。
 *
 * 功能说明：
 * 1. 清除 Markdown 符号（标题、强调、列表、引用、围栏、代码、链接、分割线、HTML标签）
 * 2. 清除多余空行（连续 2 个以上空段压缩为 1 个，首尾空段删除，保留原有段落分段节奏）
 * 3. 半角标点转全角（严格按中文语境判断，保护数字小数、千分位、URL、邮箱与英文缩写）
 */

(function attachCleanFormat(global) {
  "use strict";

  const CHINESE_CHAR_REGEX = /[\u4e00-\u9fa5\u3400-\u4dbf\uf900-\ufaff]/;

  /**
   * 判定字符是否为中文字符
   */
  function isChinese(ch) {
    return ch ? CHINESE_CHAR_REGEX.test(ch) : false;
  }

  /**
   * 清除单段文本的 Markdown 记号
   * @param {string} rawText 原始文本
   * @returns {{ text: string, isDeleted: boolean, changesCount: number }}
   */
  function cleanMarkdownText(rawText) {
    let text = String(rawText || "").replace(/[\r\n\x07\f\v]/g, "");
    let changesCount = 0;

    // 1. 分隔线：单独成段的 ---、***、___ (整段删除)
    if (/^[ \t]*([-_*])(?:\s*\1){2,}[ \t]*$/.test(text)) {
      return { text: "", isDeleted: true, changesCount: 1 };
    }

    // 2. 代码块围栏：``` 或 ~~~ (整行删除)
    if (/^[ \t]*(?:```|~~~)[a-zA-Z0-9_-]*[ \t]*$/.test(text)) {
      return { text: "", isDeleted: true, changesCount: 1 };
    }

    // 3. Markdown 图片整段删除：![alt](url)
    if (/^[ \t]*!\[.*?\]\(.*?\)[ \t]*$/.test(text)) {
      return { text: "", isDeleted: true, changesCount: 1 };
    }

    // 清除行内图片记号
    const imgMatches = text.match(/!\[.*?\]\(.*?\)/g);
    if (imgMatches) {
      changesCount += imgMatches.length;
      text = text.replace(/!\[.*?\]\(.*?\)/g, "");
    }

    // 4. 行首标题记号：#、##、###... 及后续空格
    const headingMatch = text.match(/^[ \t]*#{1,6}[ \t]+/);
    if (headingMatch) {
      changesCount += 1;
      text = text.slice(headingMatch[0].length);
    }

    // 5. 行首引用记号：> 及紧随空格
    const quoteMatch = text.match(/^[ \t]*>+[ \t]?/);
    if (quoteMatch) {
      changesCount += 1;
      text = text.slice(quoteMatch[0].length);
    }

    // 6. 列表记号：行首 -、*、+ 以及数字加点「1. 」「2) 」的序号记号
    const listMatch = text.match(/^[ \t]*(?:[-*+]|\d+[\.\)）])[ \t]+/);
    if (listMatch) {
      changesCount += 1;
      text = text.slice(listMatch[0].length);
    }

    // 7. 任务列表记号：[ ] 或 [x]
    const taskMatch = text.match(/^\[[ xX]\][ \t]+/);
    if (taskMatch) {
      changesCount += 1;
      text = text.slice(taskMatch[0].length);
    }

    // 8. 行内 HTML 标签：<br>、<b>、<span ...> 等标签去掉只留内容
    const htmlTagRegex = /<\/?(?:[a-zA-Z][a-zA-Z0-9]*|!--[\s\S]*?--)(?:\s+[^>]*)?\/?>/g;
    const htmlMatches = text.match(htmlTagRegex);
    if (htmlMatches) {
      changesCount += htmlMatches.length;
      text = text.replace(htmlTagRegex, "");
    }

    // 9. Markdown 链接：[文字](url) → 只留文字
    const linkRegex = /\[([^\]\r\n]+)\]\([^\)\r\n]+\)/g;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(text)) !== null) {
      changesCount += 1;
    }
    text = text.replace(linkRegex, "$1");

    // 10. 粗斜体、加粗、删除线、斜体与行内代码
    // 粗斜体 ***text*** 或 ___text___
    text = text.replace(/\*\*\*([^\*\r\n]+?)\*\*\*/g, function (_, m) {
      changesCount++;
      return m;
    });
    text = text.replace(/___([^_\r\n]+?)___/g, function (_, m) {
      changesCount++;
      return m;
    });

    // 加粗 **text** 或 __text__
    text = text.replace(/\*\*([^\*\r\n]+?)\*\*/g, function (_, m) {
      changesCount++;
      return m;
    });
    text = text.replace(/__([^_\r\n]+?)__/g, function (_, m) {
      changesCount++;
      return m;
    });

    // 删除线 ~~text~~
    text = text.replace(/~~([^~\r\n]+?)~~/g, function (_, m) {
      changesCount++;
      return m;
    });

    // 斜体 *text*
    text = text.replace(/(?:^|[^\*])\*([^\*\s\r\n](?:[^\*\r\n]*?[^\*\s\r\n])?)\*(?!\*)/g, function (full, m) {
      changesCount++;
      const prefix = full.startsWith("*") ? "" : full[0];
      return prefix + m;
    });

    // 斜体 _text_ (避免下划线变量名如 my_var_name)
    text = text.replace(/(?:^|[^\w])_([^\s_\r\n](?:[^_\r\n]*?[^\s_\r\n])?)_(?=[^\w]|$)/g, function (full, m) {
      changesCount++;
      const prefix = full.startsWith("_") ? "" : full[0];
      return prefix + m;
    });

    // 行内代码 `code`
    text = text.replace(/`([^`\r\n]+)`/g, function (_, m) {
      changesCount++;
      return m;
    });

    return { text, isDeleted: false, changesCount };
  }

  /**
   * 半角标点转全角（严格按中文语境判断）
   * @param {string} rawText 原始文本
   * @returns {{ text: string, changesCount: number }}
   */
  function cleanPunctuationText(rawText) {
    let text = String(rawText || "");
    let changesCount = 0;

    // 1. 保护区：把不需要转换的特殊格式用占位符保护起来
    const placeholders = [];
    function protect(pattern) {
      text = text.replace(pattern, function (match) {
        const id = placeholders.length;
        placeholders.push(match);
        return `\uFFF0${id}\uFFF1`;
      });
    }

    // (1) URL 与协议
    protect(/https?:\/\/[^\s\u4e00-\u9fa5]+/gi);
    protect(/ftp:\/\/[^\s\u4e00-\u9fa5]+/gi);
    protect(/www\.[a-zA-Z0-9_\-\.]+\.[a-zA-Z]{2,}(?:\/[^\s\u4e00-\u9fa5]*)?/gi);

    // (2) 邮箱
    protect(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g);

    // (3) 英文专有名词/缩写（如 U.S.、e.g.、i.e.、Node.js 等）
    protect(/\b[A-Za-z](?:\.[A-Za-z])+\.?/g); // U.S. / e.g. / i.e.
    protect(/\b(?:etc|vs|vol|dept|fig|prof|dr|mr|mrs|ms)\./gi);
    protect(/\b[a-zA-Z0-9_-]+\.[a-zA-Z0-9]{1,4}\b/g); // 文件扩展名如 clean-format.js

    // (4) 数字中的小数、千分位、时间、版本号 (3.14, 1,000, 2026.10, 12:30:00)
    protect(/\b\d+(?:[.,:]\d+)+\b/g);

    // 2. 引号处理：半角双引号 "..." 成对转全角 “...”
    // 仅当引号内容包含中文，或引号外部紧邻中文字符时转换
    text = text.replace(/"([^"\r\n]*)"/g, function (full, inner, offset, orig) {
      const prevChar = offset > 0 ? orig[offset - 1] : "";
      const nextChar = offset + full.length < orig.length ? orig[offset + full.length] : "";
      const hasChinese = isChinese(inner) || isChinese(prevChar) || isChinese(nextChar);
      if (hasChinese) {
        changesCount += 2;
        return `“${inner}”`;
      }
      return full;
    });

    // 处理孤立的双引号（若有紧邻中文）
    text = text.replace(/"/g, function (match, offset, orig) {
      const prevChar = offset > 0 ? orig[offset - 1] : "";
      const nextChar = offset + 1 < orig.length ? orig[offset + 1] : "";
      if (isChinese(nextChar)) {
        changesCount += 1;
        return "“";
      }
      if (isChinese(prevChar)) {
        changesCount += 1;
        return "”";
      }
      return match;
    });

    // 3. 括号处理：( ) 转 （ ）
    // 括号内含中文，或括号前/后紧邻中文
    text = text.replace(/\(([^()\r\n]*)\)/g, function (full, inner, offset, orig) {
      const prevChar = offset > 0 ? orig[offset - 1] : "";
      const nextChar = offset + full.length < orig.length ? orig[offset + full.length] : "";
      if (isChinese(inner) || isChinese(prevChar) || isChinese(nextChar)) {
        changesCount += 2;
        return `（${inner}）`;
      }
      return full;
    });

    // 孤立括号
    text = text.replace(/\(/g, function (m, offset, orig) {
      const prevChar = offset > 0 ? orig[offset - 1] : "";
      const nextChar = offset + 1 < orig.length ? orig[offset + 1] : "";
      if (isChinese(prevChar) || isChinese(nextChar)) {
        changesCount++;
        return "（";
      }
      return m;
    });
    text = text.replace(/\)/g, function (m, offset, orig) {
      const prevChar = offset > 0 ? orig[offset - 1] : "";
      const nextChar = offset + 1 < orig.length ? orig[offset + 1] : "";
      if (isChinese(prevChar) || isChinese(nextChar)) {
        changesCount++;
        return "）";
      }
      return m;
    });

    // 4. 去除中文/全角闭合符号后多余的半角空格，再紧跟半角标点的情况（如 "批复） ." 或 "文本 , "）
    text = text.replace(/([\u4e00-\u9fa5\uFF09\u201D\u2019\u300B\u3001-\u3003])\s+([,\.\?!:;])/g, "$1$2");

    // 5. 其他半角标点转全角：, . ? ! : ;
    const PUNC_MAP = {
      ",": "，",
      ".": "。",
      "?": "？",
      "!": "！",
      ":": "：",
      ";": "；"
    };

    let result = "";
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (PUNC_MAP[ch]) {
        const prev = i > 0 ? text[i - 1] : "";
        const next = i + 1 < text.length ? text[i + 1] : "";

        const isPrevChinese = isChinese(prev);
        const isNextChinese = isChinese(next) || (next === " " && isChinese(text[i + 2]));
        const isPrevChinesePunc = /[”’）》\uFF09\u201D\u2019\u300B]/.test(prev);

        if (isPrevChinese || isNextChinese || isPrevChinesePunc) {
          result += PUNC_MAP[ch];
          changesCount++;
          // 中文全角标点后吸收紧跟的一个半角空格（AI 输出常见 "， "）
          if (next === " ") {
            i++;
          }
          continue;
        }
      }
      result += ch;
    }
    text = result;

    // 6. 还原受保护内容
    text = text.replace(/\uFFF0(\d+)\uFFF1/g, function (_, id) {
      return placeholders[Number(id)] || "";
    });

    return { text, changesCount };
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
   * 清洗当前文档全文
   * @param {{ cleanMarkdown?: boolean, cleanBlankLines?: boolean, cleanPunctuation?: boolean }} options
   */
  async function cleanCurrentDocument(options) {
    const opts = {
      cleanMarkdown: options?.cleanMarkdown !== false,
      cleanBlankLines: options?.cleanBlankLines !== false,
      cleanPunctuation: options?.cleanPunctuation !== false
    };

    const app = await getWpsApplication();
    if (!app) {
      throw new Error("未检测到 WPS 运行环境，请确保插件在 WPS 文字中运行。");
    }

    const doc = await getActiveDocument(app);
    if (!doc) {
      throw new Error("未检测到打开的文档，请先打开需要清洗格式的文档。");
    }

    const paras = doc.Paragraphs || doc.Content?.Paragraphs;
    if (!paras) {
      throw new Error("无法读取文档段落，请确认当前文档为 WPS 文字文档。");
    }

    const totalParas = Number(paras.Count) || 0;
    if (totalParas === 0) {
      throw new Error("当前文档没有可处理的段落。");
    }

    // 开启 UndoRecord（如宿主支持）
    let undoRecord = null;
    try {
      undoRecord = app.UndoRecord;
      if (undoRecord) undoRecord.BeginCustomRecord("一键清洗格式");
    } catch (e) {}

    // 关闭屏幕刷新以提升速度
    try {
      app.ScreenUpdating = false;
    } catch (e) {}

    const stats = {
      totalProcessed: 0,
      updatedParas: 0,
      blankLinesCount: 0,
      markdownCount: 0,
      punctuationCount: 0
    };

    try {
      // 1. 读取所有段落信息到内存
      const paraMeta = [];
      for (let i = 1; i <= totalParas; i++) {
        let p = null;
        try {
          p = paras.Item(i);
        } catch (e) {
          continue;
        }
        if (!p) continue;

        let inTable = false;
        try {
          inTable = Boolean(p.Range?.Information?.(12) || (p.Range?.Tables && p.Range.Tables.Count > 0));
        } catch (e) {}

        const rawWithBreak = String(p.Range?.Text || "");
        const origText = rawWithBreak.replace(/[\r\n\x07\f\v]/g, "");

        paraMeta.push({
          index: i,
          inTable,
          origText,
          cleanText: origText,
          isDeleted: false,
          toDelete: false
        });
      }

      stats.totalProcessed = paraMeta.length;

      // 2. 内存清洗：Markdown 记号
      if (opts.cleanMarkdown) {
        for (let i = 0; i < paraMeta.length; i++) {
          const item = paraMeta[i];
          const mdRes = cleanMarkdownText(item.cleanText);
          stats.markdownCount += mdRes.changesCount;
          if (mdRes.isDeleted && !item.inTable) {
            item.isDeleted = true;
            item.cleanText = "";
          } else {
            item.cleanText = mdRes.text;
          }
        }
      }

      // 3. 内存清洗：半角标点转全角
      if (opts.cleanPunctuation) {
        for (let i = 0; i < paraMeta.length; i++) {
          const item = paraMeta[i];
          if (item.isDeleted) continue;
          const puncRes = cleanPunctuationText(item.cleanText);
          stats.punctuationCount += puncRes.changesCount;
          item.cleanText = puncRes.text;
        }
      }

      // 4. 多余空行计算（根据 cleanText 是否为空判定）
      if (opts.cleanBlankLines) {
        let firstNonEmpty = -1;
        let lastNonEmpty = -1;
        for (let i = 0; i < paraMeta.length; i++) {
          const item = paraMeta[i];
          const isItemEmpty = item.isDeleted || (item.cleanText.trim() === "");
          if (!isItemEmpty) {
            if (firstNonEmpty === -1) firstNonEmpty = i;
            lastNonEmpty = i;
          }
        }

        if (firstNonEmpty === -1) {
          // 全文皆空：保留第一个，其余删除
          for (let i = 1; i < paraMeta.length; i++) {
            if (!paraMeta[i].inTable) paraMeta[i].toDelete = true;
          }
        } else {
          // 开头空段落直接删除
          for (let i = 0; i < firstNonEmpty; i++) {
            if (!paraMeta[i].inTable) paraMeta[i].toDelete = true;
          }
          // 结尾空段落直接删除
          for (let i = lastNonEmpty + 1; i < paraMeta.length; i++) {
            if (!paraMeta[i].inTable) paraMeta[i].toDelete = true;
          }
          // 中间连续 2 个及以上空段落压缩为 1 个
          let inBlankRun = false;
          for (let i = firstNonEmpty; i <= lastNonEmpty; i++) {
            const item = paraMeta[i];
            const isItemEmpty = item.isDeleted || (item.cleanText.trim() === "");
            if (isItemEmpty) {
              if (!inBlankRun) {
                inBlankRun = true;
                item.cleanText = "";
              } else {
                if (!item.inTable) {
                  item.toDelete = true;
                }
              }
            } else {
              inBlankRun = false;
            }
          }
        }
      } else {
        // 未开启空行清洗时，仅删除 Markdown 清理中被要求整段删除的段落
        for (let i = 0; i < paraMeta.length; i++) {
          if (paraMeta[i].isDeleted && !paraMeta[i].inTable) {
            paraMeta[i].toDelete = true;
          }
        }
      }

      // 5. 倒序写回 WPS 文档（从后往前执行，确保段落索引与字符位置稳定）
      for (let i = paraMeta.length - 1; i >= 0; i--) {
        const item = paraMeta[i];
        const paraIndex = i + 1;
        let p = null;
        try {
          p = paras.Item(paraIndex);
        } catch (e) {
          continue;
        }
        if (!p) continue;

        if (item.toDelete) {
          try {
            p.Range.Delete();
            stats.blankLinesCount++;
          } catch (e) {
            console.warn("Delete paragraph failed:", paraIndex, e);
          }
        } else if (item.cleanText !== item.origText) {
          try {
            const start = p.Range.Start;
            const end = p.Range.End;
            const targetEnd = Math.max(start, end - 1);
            if (typeof doc.Range === "function") {
              const textRange = doc.Range(start, targetEnd);
              textRange.Text = item.cleanText;
            } else {
              p.Range.Text = item.cleanText + "\r";
            }
            stats.updatedParas++;
          } catch (e) {
            try {
              p.Range.Text = item.cleanText + "\r";
              stats.updatedParas++;
            } catch (e2) {
              console.warn("Update paragraph text failed:", paraIndex, e2);
            }
          }
        }
      }
    } finally {
      try {
        app.ScreenUpdating = true;
      } catch (e) {}

      try {
        if (undoRecord) undoRecord.EndCustomRecord();
      } catch (e) {}
    }

    return stats;
  }

  // 初始化 UI 交互
  function initUI() {
    const card = document.getElementById("cleanFormatCard");
    const toggleBtn = document.getElementById("cleanFormatCardToggle");
    const actionBtn = document.getElementById("btnCleanFormat");
    const statusBox = document.getElementById("cleanFormatStatus");
    const chkMarkdown = document.getElementById("chkCleanMarkdown");
    const chkBlankLines = document.getElementById("chkCleanBlankLines");
    const chkPunctuation = document.getElementById("chkCleanPunctuation");

    function setStatus(msg, type) {
      if (!statusBox) return;
      statusBox.className = "gov-format-status " + (type || "info");
      statusBox.textContent = msg;
      statusBox.classList.remove("hidden");
    }

    // 折叠/展开控制
    if (toggleBtn && card) {
      toggleBtn.addEventListener("click", function () {
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

    // 一键清洗点击事件
    if (actionBtn) {
      actionBtn.addEventListener("click", async function () {
        const cleanMarkdown = chkMarkdown ? chkMarkdown.checked : true;
        const cleanBlankLines = chkBlankLines ? chkBlankLines.checked : true;
        const cleanPunctuation = chkPunctuation ? chkPunctuation.checked : true;

        if (!cleanMarkdown && !cleanBlankLines && !cleanPunctuation) {
          setStatus("请至少勾选一项清洗规则。", "error");
          return;
        }

        actionBtn.disabled = true;
        setStatus("正在清洗当前文档格式，请稍候...", "info");

        try {
          const stats = await cleanCurrentDocument({
            cleanMarkdown,
            cleanBlankLines,
            cleanPunctuation
          });

          const details = [];
          if (cleanMarkdown) details.push(`清除 Markdown 记号 ${stats.markdownCount} 处`);
          if (cleanBlankLines) details.push(`压缩空行 ${stats.blankLinesCount} 个`);
          if (cleanPunctuation) details.push(`转换标点 ${stats.punctuationCount} 个`);

          const totalCleaned = stats.updatedParas + stats.blankLinesCount;
          setStatus(
            `清洗完成！已清洗 ${totalCleaned} 个段落（${details.join("、")}）。`,
            "success"
          );
        } catch (err) {
          setStatus("清洗失败：" + (err?.message || String(err)), "error");
        } finally {
          actionBtn.disabled = false;
        }
      });
    }
  }

  // 暴露公共接口
  global.WpsAiCleanFormat = {
    cleanMarkdownText,
    cleanPunctuationText,
    cleanCurrentDocument,
    isChinese,
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
