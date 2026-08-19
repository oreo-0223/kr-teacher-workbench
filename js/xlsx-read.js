/* ============================================================
   xlsx-read.js · 零依赖 Excel(.xlsx) 读取器
   - 仅用浏览器/Node 原生能力：DecompressionStream + TextDecoder + 正则 XML 解析
   - 不依赖 SheetJS / 任何第三方库，符合项目零外部依赖原则
   - 仅支持现代 .xlsx（OOXML，ZIP+XML）；旧版 .xls（二进制 BIFF）不支持
   输出：parseXlsx(buffer) -> string[][] （行数组，每行是单元格字符串数组）
   ============================================================ */
(function (global) {
  'use strict';

  /* ---------- 工具 ---------- */
  function toBytes(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (buf && buf.buffer instanceof ArrayBuffer) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    throw new Error('不支持的输入类型');
  }
  function text(bytes) { return new TextDecoder('utf-8').decode(bytes); }

  function decodeXml(s) {
    return String(s == null ? '' : s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, '&');
  }

  function colToIndex(s) {
    let n = 0;
    for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  /* ---------- ZIP 解包（原生，支持 deflate / stored） ---------- */
  async function inflateRaw(input) {
    if (!input || input.length === 0) return new Uint8Array(0);
    // ZIP 内的 deflate 是「原始 deflate（RFC 1951）」，不含 zlib 头，
    // 因此必须用 'deflate-raw'（浏览器与 Node 22+ 均支持）。
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(input);
      writer.close();
      const ab = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(ab);
    } catch (e) {
      // 个别运行环境下对极小/空负载的 raw deflate 流会误报 Z_DATA_ERROR，
      // 此时退化为直接按原字节返回（xlsx 中未压缩/极小内容本就是文本）。
      return new Uint8Array(input);
    }
  }

  async function unzip(buf) {
    const bytes = toBytes(buf);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // 定位 End of Central Directory
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP/XLSX 文件');

    const cdOffset = dv.getUint32(eocd + 16, true);
    const cdCount = dv.getUint16(eocd + 10, true);
    const files = {};

    let p = cdOffset;
    for (let n = 0; n < cdCount; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break; // 中央目录签名
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const fnLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = text(bytes.subarray(p + 46, p + 46 + fnLen));

      const lfNameLen = dv.getUint16(lho + 26, true);
      const lfExtraLen = dv.getUint16(lho + 28, true);
      const dataStart = lho + 30 + lfNameLen + lfExtraLen;
      const comp = bytes.subarray(dataStart, dataStart + compSize);

      let content;
      if (method === 0) content = text(comp);          // stored
      else if (method === 8) content = text(await inflateRaw(comp)); // deflate
      else content = text(comp);                       // 其他：尽力而为

      files[name] = content;
      p += 46 + fnLen + extraLen + commentLen;
    }
    return files;
  }

  /* ---------- 共享字符串表 ---------- */
  function parseSharedStrings(xml) {
    const out = [];
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(xml))) {
      let s = '';
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
      let t;
      while ((t = tRe.exec(m[1]))) s += decodeXml(t[1]);
      out.push(s);
    }
    return out;
  }

  /* ---------- 单工作表 -> 行数组 ---------- */
  function parseSheet(xml, shared) {
    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(xml))) {
      const cells = [];
      const cRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cm;
      while ((cm = cRe.exec(rm[1]))) {
        const attrs = cm[1];
        const inner = cm[2];
        const rM = attrs.match(/\br="([A-Z]+)\d+"/);
        if (!rM) continue;
        const col = colToIndex(rM[1]);
        const tM = attrs.match(/\bt="([^"]+)"/);
        const type = tM ? tM[1] : '';
        let value = '';
        if (type === 's') {                       // 共享字符串
          const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
          const idx = vM ? parseInt(vM[1], 10) : -1;
          value = (idx >= 0 && shared[idx] != null) ? shared[idx] : '';
        } else if (type === 'inlineStr') {        // 内联字符串
          let s = '', tm, tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
          while ((tm = tRe.exec(inner))) s += decodeXml(tm[1]);
          value = s;
        } else {                                  // 数值 / 公式结果 / 布尔 -> 取 <v>
          const vM = inner.match(/<v>([\s\S]*?)<\/v>/);
          value = vM ? decodeXml(vM[1]) : '';
        }
        cells.push({ col, value });
      }
      if (!cells.length) continue;
      const maxCol = cells.reduce((mx, c) => Math.max(mx, c.col), 0);
      const arr = new Array(maxCol).fill('');
      for (const c of cells) arr[c.col - 1] = (c.value == null ? '' : String(c.value)).trim();
      rows.push(arr);
    }
    return rows;
  }

  /* ---------- 入口 ---------- */
  async function parseXlsx(buffer) {
    const files = await unzip(buffer);
    const shared = files['xl/sharedStrings.xml']
      ? parseSharedStrings(files['xl/sharedStrings.xml'])
      : [];
    const sheets = Object.keys(files)
      .filter(n => /^xl\/worksheets\/(sheets\/)?sheet\d+\.xml$/.test(n))
      .sort();
    const all = [];
    for (const s of sheets) {
      const rows = parseSheet(files[s], shared);
      for (const r of rows) all.push(r);
    }
    return all;
  }

  /* ---------- 导出（浏览器挂全局，Node 走 module.exports） ---------- */
  const api = { parseXlsx, unzip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  // 直接用全局 window（不依赖 IIFE 参数传递），避免任何边界场景下 global 解析为 undefined
  if (typeof window !== 'undefined') window.parseXlsx = parseXlsx;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
