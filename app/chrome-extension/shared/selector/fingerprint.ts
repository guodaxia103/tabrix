/**
 * Element Fingerprint - 元素指纹生成和验证
 *
 * 指纹用于元素的模糊匹配和验证，特别是在以下场景：
 * - 选择器匹配到元素后，验证是否是期望的元素
 * - HMR 后元素恢复
 * - 防止"相同选择器不同元素"的误匹配
 */

// =============================================================================
// Constants
// =============================================================================

const FINGERPRINT_TEXT_MAX_LENGTH = 32;
const FINGERPRINT_MAX_CLASSES = 8;
const FINGERPRINT_SEPARATOR = '|';

// =============================================================================
// Types
// =============================================================================

export interface ElementFingerprint {
  tag: string;
  id?: string;
  classes?: string[];
  text?: string;
  raw: string;
}

export interface FingerprintOptions {
  textMaxLength?: number;
  maxClasses?: number;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * 标准化文本内容：合并空白字符并截取
 */
function normalizeText(text: string, maxLength: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * 为 DOM 元素计算结构化指纹
 *
 * 指纹格式: `tag|id=xxx|class=a.b.c|text=xxx`
 *
 * @example
 * ```ts
 * const fp = computeFingerprint(buttonElement);
 * // => "button|id=submit-btn|class=btn.primary|text=Submit"
 * ```
 */
export function computeFingerprint(element: Element, options?: FingerprintOptions): string {
  const textMaxLength = options?.textMaxLength ?? FINGERPRINT_TEXT_MAX_LENGTH;
  const maxClasses = options?.maxClasses ?? FINGERPRINT_MAX_CLASSES;

  const parts: string[] = [];

  // 1. Tag name (必须)
  const tag = element.tagName?.toLowerCase() ?? 'unknown';
  parts.push(tag);

  // 2. ID (如果存在)
  const id = element.id?.trim();
  if (id) {
    parts.push(`id=${id}`);
  }

  // 3. Class names (最多 maxClasses 个)
  const classes = Array.from(element.classList).slice(0, maxClasses);
  if (classes.length > 0) {
    parts.push(`class=${classes.join('.')}`);
  }

  // 4. Text content hint (标准化后截取)
  const text = normalizeText(element.textContent ?? '', textMaxLength);
  if (text) {
    parts.push(`text=${text}`);
  }

  return parts.join(FINGERPRINT_SEPARATOR);
}

/**
 * 解析指纹字符串为结构化对象
 *
 * @example
 * ```ts
 * const fp = parseFingerprint("button|id=submit|class=btn.primary|text=Submit");
 * // => { tag: "button", id: "submit", classes: ["btn", "primary"], text: "Submit", raw: "..." }
 * ```
 */
export function parseFingerprint(fingerprint: string): ElementFingerprint {
  const parts = fingerprint.split(FINGERPRINT_SEPARATOR);
  const result: ElementFingerprint = {
    tag: parts[0] ?? 'unknown',
    raw: fingerprint,
  };

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith('id=')) {
      result.id = part.slice(3);
    } else if (part.startsWith('class=')) {
      result.classes = part.slice(6).split('.');
    } else if (part.startsWith('text=')) {
      result.text = part.slice(5);
    }
  }

  return result;
}

/**
 * 验证元素是否匹配给定的指纹
 *
 * 验证规则：
 * - tag 必须完全匹配
 * - 如果存储的指纹有 id，当前元素的 id 必须匹配
 * - class 和 text 不强制匹配（用于计算相似度）
 *
 * @example
 * ```ts
 * const stored = computeFingerprint(element);
 * // ... 页面变化后
 * const stillMatches = verifyFingerprint(element, stored);
 * ```
 */
export function verifyFingerprint(element: Element, fingerprint: string): boolean {
  const stored = parseFingerprint(fingerprint);
  const currentTag = element.tagName?.toLowerCase() ?? 'unknown';

  // Tag 必须匹配
  if (stored.tag !== currentTag) {
    return false;
  }

  // 如果存储的指纹有 id，当前元素必须有相同的 id
  if (stored.id) {
    const currentId = element.id?.trim();
    if (stored.id !== currentId) {
      return false;
    }
  }

  return true;
}

/**
 * 计算两个指纹之间的相似度
 *
 * @returns 相似度分数 0-1，1 表示完全匹配
 *
 * @example
 * ```ts
 * const score = fingerprintSimilarity(fpA, fpB);
 * if (score > 0.8) {
 *   // 高度相似，可能是同一个元素
 * }
 * ```
 */
export function fingerprintSimilarity(a: string, b: string): number {
  const fpA = parseFingerprint(a);
  const fpB = parseFingerprint(b);

  let score = 0;
  let weights = 0;

  // Tag 匹配 (权重 0.4)
  const tagWeight = 0.4;
  weights += tagWeight;
  if (fpA.tag === fpB.tag) {
    score += tagWeight;
  } else {
    // Tag 不匹配，直接返回 0
    return 0;
  }

  // ID 匹配 (权重 0.3)
  const idWeight = 0.3;
  if (fpA.id || fpB.id) {
    weights += idWeight;
    if (fpA.id === fpB.id) {
      score += idWeight;
    }
  }

  // Class 匹配 (权重 0.2) - 使用 Jaccard 相似度
  const classWeight = 0.2;
  if ((fpA.classes?.length ?? 0) > 0 || (fpB.classes?.length ?? 0) > 0) {
    weights += classWeight;
    const setA = new Set(fpA.classes ?? []);
    const setB = new Set(fpB.classes ?? []);
    const intersection = [...setA].filter((c) => setB.has(c)).length;
    const union = new Set([...(fpA.classes ?? []), ...(fpB.classes ?? [])]).size;
    if (union > 0) {
      score += classWeight * (intersection / union);
    }
  }

  // Text 匹配 (权重 0.1) - 简单包含检查
  const textWeight = 0.1;
  if (fpA.text || fpB.text) {
    weights += textWeight;
    if (fpA.text && fpB.text) {
      // 检查是否有重叠
      const textA = fpA.text.toLowerCase();
      const textB = fpB.text.toLowerCase();
      if (textA === textB) {
        score += textWeight;
      } else if (textA.includes(textB) || textB.includes(textA)) {
        score += textWeight * 0.5;
      }
    }
  }

  return weights > 0 ? score / weights : 0;
}

/**
 * 检查两个指纹是否表示同一个元素
 *
 * 基于相似度阈值判断，默认阈值 0.7
 */
export function fingerprintMatches(
  a: string,
  b: string,
  threshold = 0.7,
): { match: boolean; score: number } {
  const score = fingerprintSimilarity(a, b);
  return {
    match: score >= threshold,
    score,
  };
}
