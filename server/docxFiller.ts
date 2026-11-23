import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';
import { RFONTS_XML, FONT_EN, FONT_BN } from './fonts';

const TEMPLATE_PATH = path.resolve(process.cwd(), 'template', 'EDC Form.docx');

function escapeXml(unsafe: string): string {
  return String(unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function unescapeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'');
}

function getParaText(pXml: string): string {
  const matches = pXml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
  return unescapeXml(matches.map((m) => m.replace(/<w:t[^>]*>|<\/w:t>/g, '')).join('')).normalize('NFC');
}

export function toBanglaDigits(num: string | number): string {
  const banglaDigits: Record<string, string> = {
    '0': '০', '1': '১', '2': '২', '3': '৩', '4': '৪',
    '5': '৫', '6': '৬', '7': '৭', '8': '৮', '9': '৯',
  };
  return String(num).split('').map((ch) => banglaDigits[ch] || ch).join('');
}

export function getBanglaDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    return `${toBanglaDigits(day)}/${toBanglaDigits(month)}/${toBanglaDigits(year)}`;
  }
  return dateStr;
}

export function normalizeMac(raw: string): string {
  if (!raw) return '';
  const match = raw.match(/(?<![0-9A-Fa-f:\-])([0-9A-Fa-f](?:[:\-]?[0-9A-Fa-f]){11})(?![0-9A-Fa-f])/);
  if (match) {
    const hexOnly = match[1].replace(/[^0-9A-Fa-f]/g, '');
    if (hexOnly.length === 12) {
      const pairs = [];
      for (let i = 0; i < 12; i += 2) {
        pairs.push(hexOnly.slice(i, i + 2));
      }
      return pairs.join(':').toUpperCase();
    }
  }
  return raw.trim();
}

/** Content-Disposition value that also works for Bangla names (a plain header may only hold Latin-1 characters; Node throws otherwise). */
export function contentDisposition(name: string): string {
  const ascii = (name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').replace(/_{2,}/g, '_') || 'download').slice(0, 80);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

export function sanitizeFilename(name: string): string {
  let cleaned = name.replace(/[\\/:*?"<>|]+/g, '');
  cleaned = cleaned.replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned ? cleaned.slice(0, 60) : 'form';
}

function appendValueToPara(pXml: string, value: string): string {
  if (!value) return pXml;

  // Check if paragraph already ends with a space in its text
  const matches = pXml.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
  const lastText = matches.length > 0 ? matches[matches.length - 1].replace(/<[^>]+>/g, '') : '';
  const needsSpace = !lastText.endsWith(' ') && !value.startsWith(' ');
  const prefix = needsSpace ? ' ' : '';

  // Standard font: Times New Roman (English) / Kalpurush (Bangla), sz 22 (11pt), regular weight
  const runXml = `<w:r><w:rPr>${RFONTS_XML}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${prefix}${escapeXml(value)}</w:t></w:r>`;
  return pXml.replace(/<\/w:p>$/, `${runXml}</w:p>`);
}

// ---- Fonts: every English letter/digit in Times New Roman, every Bangla character in Kalpurush ----------------------
const BANGLA_CHAR = /[ঀ-৿‌‍]/;
const LATIN_CHAR = /[A-Za-z0-9]/;
const fontsXml = (font: string) => `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/>`;

/** Replaces (or adds) the <w:rFonts> of a run's properties. */
function withRunFont(rPrInner: string, font: string): string {
  const cleaned = rPrInner.replace(/<w:rFonts\b[^>]*\/>/g, '');
  const style = /^<w:rStyle\b[^>]*\/>/.exec(cleaned);
  return style ? style[0] + fontsXml(font) + cleaned.slice(style[0].length) : fontsXml(font) + cleaned;
}

/** Splits text into consecutive pieces of one script. Spaces and punctuation stay with the piece before them. */
function splitByScript(text: string): { text: string; bangla: boolean }[] {
  const out: { text: string; bangla: boolean }[] = [];
  let pendingNeutral = '';
  for (const ch of text) {
    const strong = BANGLA_CHAR.test(ch) ? true : LATIN_CHAR.test(ch) ? false : null;
    if (strong === null) {
      if (out.length) out[out.length - 1].text += ch; else pendingNeutral += ch;
      continue;
    }
    const last = out[out.length - 1];
    if (last && last.bangla === strong) last.text += ch;
    else { out.push({ text: pendingNeutral + ch, bangla: strong }); pendingNeutral = ''; }
  }
  if (pendingNeutral) out.push({ text: pendingNeutral, bangla: false });
  return out;
}

export function applyFormFonts(xml: string): string {
  return xml.replace(/<w:r(?=[\s>])[^>]*>[\s\S]*?<\/w:r>/g, (run) => {
    const open = /^<w:r(?=[\s>])[^>]*>/.exec(run)![0];
    let rest = run.slice(open.length, run.length - '</w:r>'.length);
    const rPrMatch = /^<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(rest);
    const rPrInner = rPrMatch ? rPrMatch[1] : '';
    if (rPrMatch) rest = rest.slice(rPrMatch[0].length);
    const build = (font: string, body: string) => `${open}<w:rPr>${withRunFont(rPrInner, font)}</w:rPr>${body}</w:r>`;

    const texts = rest.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) || [];
    if (texts.length === 0) return build(FONT_EN, rest); // tabs, breaks, pictures: no text to style
    if (texts.length > 1 || /<w:(?!t[\s>\/]|tab\b|br\b)/.test(rest.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g, ''))) {
      // Unusual run (several texts, or other content): keep it whole, styled by what its text mostly contains.
      const all = unescapeXml(texts.map((t) => t.replace(/<[^>]+>/g, '')).join(''));
      const bn = (all.match(/[ঀ-৿]/g) || []).length;
      const en = (all.match(/[A-Za-z0-9]/g) || []).length;
      return build(bn > en ? FONT_BN : FONT_EN, rest);
    }
    // Normal run: one <w:t>, maybe with tabs around it. Split it where the script changes.
    const m = /^([\s\S]*?)<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>([\s\S]*)$/.exec(rest)!;
    const [, before, rawText, after] = m;
    const pieces = splitByScript(unescapeXml(rawText));
    if (pieces.length <= 1) return build(pieces[0]?.bangla ? FONT_BN : FONT_EN, rest);
    return pieces.map((piece, i) => {
      const t = `<w:t xml:space="preserve">${escapeXml(piece.text)}</w:t>`;
      return build(piece.bangla ? FONT_BN : FONT_EN, `${i === 0 ? before : ''}${t}${i === pieces.length - 1 ? after : ''}`);
    }).join('');
  });
}

// ---- Layout: A4 page, every line at 80% proportional spacing so the form fits on 2 pages ------------------------------
const LINE_SPACING = 192; // 240 = single (100%); 192 = 80%, rule "auto" = proportional
const A4_WIDTH = 11906;
const A4_HEIGHT = 16838;

export function applyLineSpacing(xml: string): string {
  const spacing = (attrs: string) => {
    const kept = attrs.replace(/\sw:(line|lineRule)="[^"]*"/g, '');
    return `<w:spacing${kept} w:line="${LINE_SPACING}" w:lineRule="auto"/>`;
  };
  return xml.replace(/<w:p(?=[\s>])[^>]*>(?!<w:pPr)/g, (open) => `${open}<w:pPr></w:pPr>`)
    .replace(/<w:pPr>([\s\S]*?)<\/w:pPr>/g, (_all, inner: string) => {
      const body = /<w:spacing\b([^>]*)\/>/.test(inner)
        ? inner.replace(/<w:spacing\b([^>]*)\/>/, (_m, attrs: string) => spacing(attrs))
        : inner.replace(/(<w:ind\b|<w:jc\b|<w:rPr>|$)/, `${spacing('')}$1`);
      return `<w:pPr>${body}</w:pPr>`;
    });
}

/** A4 portrait (the template was Letter). The margins stay as they were. */
function applyA4(xml: string): string {
  return xml.replace(/<w:pgSz\b[^>]*\/>/, `<w:pgSz w:w="${A4_WIDTH}" w:h="${A4_HEIGHT}"/>`);
}

/** Default fonts of the document (anything without its own font): English Times New Roman, Bangla Kalpurush. */
function applyDefaultFonts(stylesXml: string): string {
  return stylesXml.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/, (block) =>
    block.replace(/<w:rFonts\b[^>]*\/>/, `<w:rFonts w:ascii="${FONT_EN}" w:hAnsi="${FONT_EN}" w:eastAsia="${FONT_EN}" w:cs="${FONT_BN}"/>`));
}

/** Replaces all the text of a paragraph with one run, keeping the paragraph's properties and the first run's formatting. */
function setParaText(pXml: string, text: string): string {
  const open = /^<w:p(?:\s[^>]*)?>/.exec(pXml)![0];
  const pPr = /<w:pPr>[\s\S]*?<\/w:pPr>/.exec(pXml)?.[0] || '';
  const body = pXml.slice(open.length, pXml.length - '</w:p>'.length).replace(pPr, '');
  const rPr = /<w:r(?:\s[^>]*)?>\s*(<w:rPr>[\s\S]*?<\/w:rPr>)/.exec(body)?.[1] || '';
  return `${open}${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function fillEdcDocx(data: Record<string, string>, dateStr: string): Buffer {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`EDC template not found at ${TEMPLATE_PATH}`);
  }

  const zip = new AdmZip(TEMPLATE_PATH);
  let xml = zip.readAsText('word/document.xml');

  const banglaDate = getBanglaDate(dateStr);
  const normalizedMacAddr = normalizeMac(data.router_mac || '');
  const cableBrand = (data.cable_brand || 'BRB').trim();
  const cableQty = (data.cable_qty || '1500').trim();

  let afterUnit = false;
  const pRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  xml = xml.replace(pRegex, (pXml) => {
    const t = getParaText(pXml);
    // Bangla letters like য় can be stored precomposed (U+09DF) or decomposed (U+09AF U+09BC).
    // getParaText() returns NFC text, so every search string must be NFC too.
    const has = (needle: string) => t.includes(needle.normalize('NFC'));

    // 1. Header line (সুত্র নংঃ ... তারিখঃ ...)
    if (has('সুত্র নং') && has('তারিখ')) {
      // The date sits at the right margin through a right-aligned tab stop. (A row of spaces depends on the font's
      // space width, so it pushed the date onto the next line as soon as the font changed.)
      const left = `সুত্র নংঃ${data.source_no ? ` ${data.source_no}` : ''}`;
      const right = `তারিখঃ${banglaDate ? ` ${banglaDate}` : ''}`;
      const rPr = '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>';
      const run = (inner: string) => `<w:r>${rPr}${inner}</w:r>`;
      const text = (v: string) => `<w:t xml:space="preserve">${escapeXml(v)}</w:t>`;
      const withTab = pXml.replace(/(<w:pStyle\b[^>]*\/>)/, '$1<w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>');
      return withTab.replace(
        /<w:r>(?:(?!<\/w:r>)[\s\S])*?<w:t[^>]*>সুত্র নংঃ[\s\S]*?তারিখঃ<\/w:t><\/w:r>/,
        () => run(text(left)) + run('<w:tab/>') + run(text(right))
      );
    }

    // 2. Table cells
    if (has('EDC Book No.:') && data.source_no) {
      return appendValueToPara(pXml, data.source_no);
    }
    if (has('সংযোগ/NMS আইডিঃ') && data.connection_nms) {
      return appendValueToPara(pXml, data.connection_nms);
    }
    if (has('সংযোগ গ্রহণকারী প্রতিষ্টানের নাম ও ঠিকানাঃ') && data.name) {
      return appendValueToPara(pXml, data.name);
    }
    if (has('Lat & Long:') && data.lat_long) {
      return appendValueToPara(pXml, data.lat_long);
    }
    if (has('ইউনিয়ন') && has('পৌরসভা') && data.union) {
      return appendValueToPara(pXml, data.union);
    }
    if (has('প্রতিষ্টানের কোড') && data.institution_code) {
      return appendValueToPara(pXml, data.institution_code);
    }
    if (has('উপজেলা/সিটি কর্পোরেশনঃ') && data.upazila) {
      return appendValueToPara(pXml, data.upazila);
    }
    if (has('সংযোগ প্রদানের তারিখঃ') && banglaDate) {
      return appendValueToPara(pXml, banglaDate);
    }
    if (has('Wi-Fi Router MAC Address') && normalizedMacAddr) {
      return appendValueToPara(pXml, normalizedMacAddr);
    }
    if (has('Wi-Fi Router Serial No.:') && data.router_serial) {
      return appendValueToPara(pXml, data.router_serial);
    }

    // Router brand & model: the line is rewritten whole, so it works whether or not the template still has a model typed in.
    if (has('Router Brand') && has('Model') && data.router_model) {
      return setParaText(pXml, `Wi-Fi Router Brand & Model: ${data.router_model}`);
    }

    // 3. Optical Fiber Cable Brand
    if (has('Optical Fiber Cable Brand:') && cableBrand) {
      return pXml.replace(
        /<w:t[^>]*>Optical Fiber Cable Brand:.*?<\/w:t>/,
        `<w:t xml:space="preserve">Optical Fiber Cable Brand: ${escapeXml(cableBrand)}</w:t>`
      );
    }

    // 4. Optical Fiber Cable Qty: the number in the cell right after the "mtr." unit cell.
    // (Do not match a fixed number such as 1500/200: the template's sample value has changed before.)
    if (t.trim() === 'mtr.') { afterUnit = true; return pXml; }
    if (afterUnit && /^\d+$/.test(t.trim())) {
      afterUnit = false;
      if (cableQty) return pXml.replace(/(<w:t[^>]*>)\s*\d+\s*(<\/w:t>)/, `<w:t xml:space="preserve">${escapeXml(cableQty)}</w:t>`);
    }

    // 5. Site visit paragraph (সরজমিনে পরিদর্শন)
    if (has('এর উপরোক্ত') && has('সরজমিনে পরিদর্শন') && data.name) {
      return pXml.replace(
        /<w:t[^>]*>এর উপরোক্ত অফিস<\/w:t>/,
        `<w:t xml:space="preserve">এর ${escapeXml(data.name)} উপরোক্ত অফিস</w:t>`
      );
    }

    return pXml;
  });

  xml = applyA4(applyLineSpacing(applyFormFonts(xml)));
  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf-8'));
  const stylesXml = zip.readAsText('word/styles.xml');
  if (stylesXml) zip.updateFile('word/styles.xml', Buffer.from(applyDefaultFonts(stylesXml), 'utf-8'));
  return zip.toBuffer();
}
