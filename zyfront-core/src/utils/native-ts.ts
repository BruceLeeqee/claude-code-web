/**
 * 浏览器环境探测与 Base64、sleep 等无依赖小工具。
 */
/** 是否在浏览器窗口上下文 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** 读取 navigator.userAgent，非浏览器返回 unknown */
export function getSafeUserAgent(): string {
  if (!isBrowser()) return 'unknown';
  return navigator.userAgent;
}

/** UTF-8 字符串转 Base64（优先 btoa） */
export function toBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  if (typeof btoa === 'function') return btoa(binary);
  return binary;
}

/** Base64 解码为 UTF-8 字符串 */
export function fromBase64(input: string): string {
  const binary = typeof atob === 'function' ? atob(input) : input;
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** Promise 版延迟 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
