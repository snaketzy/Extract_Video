/** ISO 639-1 / 639-2 语言码 → 可读名称（导出文件名中会用到） */
const LANGUAGE_NAMES = {
  zh: '中文',
  chi: '中文',
  zho: '中文',
  cmn: '中文',
  yue: '粤语',
  zhcn: '中文',
  zhtw: '繁体中文',
  en: 'English',
  eng: 'English',
  ja: '日本語',
  jpn: '日本語',
  ko: '한국어',
  kor: '한국어',
  fr: 'Français',
  fra: 'Français',
  fre: 'Français',
  de: 'Deutsch',
  deu: 'Deutsch',
  ger: 'Deutsch',
  es: 'Español',
  spa: 'Español',
  ru: 'Русский',
  rus: 'Русский',
  pt: 'Português',
  por: 'Português',
  it: 'Italiano',
  ita: 'Italiano',
  ar: 'العربية',
  ara: 'العربية',
  th: 'ไทย',
  tha: 'ไทย',
  vi: 'Tiếng Việt',
  vie: 'Tiếng Việt',
  hi: 'हिन्दी',
  hin: 'हिन्दी',
  nl: 'Nederlands',
  nld: 'Nederlands',
  dut: 'Nederlands',
  pl: 'Polski',
  pol: 'Polski',
  tr: 'Türkçe',
  tur: 'Türkçe',
  uk: 'Українська',
  ukr: 'Українська',
  id: 'Bahasa Indonesia',
  ind: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu',
  msa: 'Bahasa Melayu',
  und: '未定义',
};

const KIND_LABELS = {
  video: '视频轨道',
  audio: '音频轨道',
  subtitle: '字幕轨道',
};

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

export function languageName(code) {
  if (!code) return null;
  const normalized = String(code).trim().toLowerCase().split('-')[0];
  return LANGUAGE_NAMES[normalized] || String(code).trim();
}

/** 去掉文件名中的非法字符，并限制长度 */
export function sanitizeName(input, fallback = 'track') {
  const cleaned = String(input ?? '')
    .replace(ILLEGAL_FILENAME_CHARS, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  const value = cleaned || fallback;
  return value.length > 80 ? value.slice(0, 80).trim() : value;
}

/** 去掉扩展名的原始文件名 */
export function baseNameOf(fileName) {
  const name = String(fileName || '');
  const lastDot = name.lastIndexOf('.');
  const base = lastDot > 0 ? name.slice(0, lastDot) : name;
  return sanitizeName(base, 'output');
}

/**
 * 轨道名：优先取 title，其次把 language 映射成可读名，最后回退到「类型 + 序号」
 */
export function resolveTrackName(track, kind, indexInType) {
  const fromTitle = track.title ? String(track.title).trim() : '';
  if (fromTitle) return sanitizeName(fromTitle, KIND_LABELS[kind] || kind);

  const fromLanguage = languageName(track.language);
  if (fromLanguage && fromLanguage !== '未定义') {
    return sanitizeName(fromLanguage, KIND_LABELS[kind] || kind);
  }

  return `${KIND_LABELS[kind] || kind}${indexInType + 1}`;
}

/** 在同一个导出批次内保证文件名唯一 */
export function uniqueFileName(fileName, usedNames) {
  if (!usedNames.has(fileName)) {
    usedNames.add(fileName);
    return fileName;
  }
  const lastDot = fileName.lastIndexOf('.');
  const stem = lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
  const ext = lastDot > 0 ? fileName.slice(lastDot) : '';
  let counter = 2;
  let candidate = `${stem}-${counter}${ext}`;
  while (usedNames.has(candidate)) {
    counter += 1;
    candidate = `${stem}-${counter}${ext}`;
  }
  usedNames.add(candidate);
  return candidate;
}
