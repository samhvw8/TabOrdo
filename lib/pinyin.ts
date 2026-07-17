import * as TinyPinyin from "tiny-pinyin";

const CJK_RE = /[㐀-䶿一-鿿]/;

export function hasChinese(s: string): boolean {
  return CJK_RE.test(s);
}

// "知乎 首页" -> "zhi hu shou ye zhihushouye zhssy": spaced syllables (prefix mode),
// joined form (contiguous typing), and initials. Returns null for text without Chinese.
export function pinyinVariants(s: string): string | null {
  if (!hasChinese(s) || !TinyPinyin.isSupported()) return null;
  const full: string[] = [];
  const initials: string[] = [];
  for (const token of TinyPinyin.parse(s)) {
    if (token.type !== 2 || !token.target) continue;
    const p = token.target.toLowerCase();
    full.push(p);
    initials.push(p[0]);
  }
  if (full.length === 0) return null;
  return `${full.join(" ")} ${full.join("")} ${initials.join("")}`;
}
