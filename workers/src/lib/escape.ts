/** 等价 PHP htmlspecialchars($s, ENT_QUOTES)，入库前对用户输入统一转义 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * escapeHtml 的逆变换（html_entity_decode ENT_QUOTES 等价）。
 * &amp; 必须最后解码，否则 "&amp;lt;" 会被二次解码成 "<"。
 * 策略：DB 存转义（对齐 PHP），API 读输出解码，前端始终处理明文。
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&');
}
