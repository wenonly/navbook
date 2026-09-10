/**
 * D1/drizzle 的 UNIQUE 约束错误藏在 cause 链里：
 * 顶层是 DrizzleQueryError（"Failed query: insert ..."，不含 UNIQUE 字样），
 * cause[0]/cause[1] 才是 "UNIQUE constraint failed: <table>.<col>: SQLITE_CONSTRAINT..."。
 * 沿 cause 链最多查 5 层，匹配完整规范文案 'UNIQUE constraint failed'。
 */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur instanceof Error; i++) {
    if (cur.message.includes('UNIQUE constraint failed')) return true;
    cur = (cur as Error & { cause?: unknown }).cause;
  }
  return false;
}
