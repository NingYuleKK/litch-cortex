/**
 * 话题导出工具 —— 支持 Markdown 和 PDF（浏览器打印）
 */

interface ExportChunk {
  content: string;
  filename: string;
}

interface ExportData {
  title: string;
  summary: string;
  chunks: ExportChunk[];
}

function formatDate(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_").slice(0, 60);
}

function buildMarkdown(data: ExportData): string {
  const lines: string[] = [];

  lines.push(`# ${data.title}`);
  lines.push("");
  lines.push(`> 导出时间：${new Date().toLocaleString("zh-CN")}  `);
  lines.push(`> 关联片段：${data.chunks.length} 个`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## 总结");
  lines.push("");
  lines.push(data.summary || "*暂无总结*");
  lines.push("");

  if (data.chunks.length > 0) {
    lines.push("---");
    lines.push("");
    lines.push("## 原文引用");
    lines.push("");

    data.chunks.forEach((chunk, idx) => {
      lines.push(`### 片段 ${idx + 1}　｜　来源：${chunk.filename}`);
      lines.push("");
      lines.push(chunk.content);
      lines.push("");
    });
  }

  lines.push("---");
  lines.push("");
  lines.push("*Exported by Litch\\'s Cortex*");
  lines.push("");

  return lines.join("\n");
}

function buildPrintHtml(data: ExportData): string {
  const escapedTitle = escapeHtml(data.title);
  const escapedSummary = escapeHtml(data.summary || "暂无总结");

  const chunksHtml = data.chunks
    .map(
      (chunk, idx) => `
    <div class="chunk">
      <div class="chunk-header">片段 ${idx + 1}　｜　来源：${escapeHtml(chunk.filename)}</div>
      <div class="chunk-content">${escapeHtml(chunk.content)}</div>
    </div>`
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${escapedTitle}</title>
  <style>
    @page {
      margin: 2cm;
      size: A4;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", "Helvetica Neue", Arial, sans-serif;
      font-size: 12pt;
      line-height: 1.8;
      color: #1a1a1a;
      background: #fff;
      padding: 0;
    }
    h1 {
      font-size: 20pt;
      font-weight: 700;
      margin-bottom: 8pt;
      color: #0a0a0a;
      border-bottom: 2px solid #0891b2;
      padding-bottom: 8pt;
    }
    .meta {
      font-size: 9pt;
      color: #666;
      margin-bottom: 16pt;
    }
    h2 {
      font-size: 14pt;
      font-weight: 600;
      margin: 20pt 0 10pt;
      color: #0891b2;
    }
    .summary {
      background: #f8fafb;
      border-left: 3px solid #0891b2;
      padding: 12pt 16pt;
      margin-bottom: 16pt;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .chunk {
      margin-bottom: 14pt;
      page-break-inside: avoid;
    }
    .chunk-header {
      font-size: 10pt;
      font-weight: 600;
      color: #0891b2;
      margin-bottom: 4pt;
      padding: 4pt 8pt;
      background: #f0f9ff;
      border-radius: 3pt;
    }
    .chunk-content {
      font-size: 10.5pt;
      line-height: 1.7;
      color: #333;
      padding: 8pt 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    hr {
      border: none;
      border-top: 1px solid #e5e7eb;
      margin: 16pt 0;
    }
    .footer {
      font-size: 8pt;
      color: #999;
      text-align: center;
      margin-top: 24pt;
      padding-top: 8pt;
      border-top: 1px solid #e5e7eb;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <h1>${escapedTitle}</h1>
  <div class="meta">
    导出时间：${new Date().toLocaleString("zh-CN")}　｜　关联片段：${data.chunks.length} 个
  </div>

  <h2>总结</h2>
  <div class="summary">${escapedSummary}</div>

  ${data.chunks.length > 0 ? `<hr><h2>原文引用</h2>${chunksHtml}` : ""}

  <div class="footer">Exported by Litch's Cortex</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * 导出为 Markdown 文件并触发下载
 */
export function exportAsMarkdown(data: ExportData): void {
  const md = buildMarkdown(data);
  const filename = `topic-${sanitizeFilename(data.title)}-${formatDate()}.md`;

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出为 PDF —— 使用浏览器原生打印方案（支持中文）
 */
export function exportAsPdf(data: ExportData): void {
  const html = buildPrintHtml(data);
  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    alert("无法打开打印窗口，请允许弹出窗口后重试。");
    return;
  }
  printWindow.document.write(html);
  printWindow.document.close();

  // 等待内容渲染完成后触发打印
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
    }, 300);
  };
  // fallback: 如果 onload 不触发
  setTimeout(() => {
    try {
      printWindow.print();
    } catch {
      // ignore
    }
  }, 1000);
}
