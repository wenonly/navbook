// 网页抓取与内容提取(Workers 原生 fetch + HTMLRewriter,零外部依赖)。
// 纯函数模块:不知道 tool/agent 的存在;fetch 可注入(测试)。
// 限额:请求超时 15s;HTMLRewriter 驱动流最多读 512KB 即 cancel;正文截 16K 字符。

const TIMEOUT_MS = 15_000;
const DRIVE_MAX_BYTES = 512 * 1024;
const TEXT_MAX_CHARS = 16 * 1024;

export interface FetchResult {
  status: number;        // HTTP 状态码(网络错误时由调用方走错误分支,不产出本结构)
  finalUrl: string;      // 重定向后的最终地址
  contentType: string;
  title: string;         // <title> 优先,og:title 兜底
  description: string;   // meta description 优先,og:description 兜底
  text: string;          // 正文(空白归一,截 16K;二进制为空)
  truncated: boolean;    // 驱动流 512KB 截断标记
  note?: string;         // 二进制等说明
}

export class FetchUrlError extends Error {}

/** 直读文本流,字节封顶 512KB */
async function readTextStream(body: ReadableStream<Uint8Array>): Promise<{ text: string; truncated: boolean }> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let bytes = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value!.byteLength;
    buf += dec.decode(value!, { stream: true });
    if (bytes >= DRIVE_MAX_BYTES) { truncated = true; await reader.cancel().catch(() => {}); break; }
  }
  return { text: buf, truncated };
}

/** HTML → {title, description, 正文};skip 栈排除非正文元素 */
async function extractHtml(body: ReadableStream<Uint8Array>): Promise<{
  title: string; description: string; text: string; truncated: boolean;
}> {
  let title = '';
  let metaDesc = '';
  let ogTitle = '';
  let ogDesc = '';
  let rawText = '';
  let skip = 0;

  const rewriter = new HTMLRewriter()
    .on('title', {
      text(t) { if (title.length < 300) title += t.text; },
    })
    .on('meta', {
      element(el) {
        const content = el.getAttribute('content');
        if (!content) return;
        const name = el.getAttribute('name')?.toLowerCase() ?? '';
        const prop = el.getAttribute('property')?.toLowerCase() ?? '';
        if (name === 'description') metaDesc ||= content;
        if (prop === 'og:description') ogDesc ||= content;
        if (prop === 'og:title') ogTitle ||= content;
      },
    })
    .on('script, style, noscript, svg, template, head, header, nav, footer, aside, iframe', {
      element(el) {
        skip++;
        el.onEndTag(() => { skip--; });
      },
    })
    .on('*', {
      text(t) {
        if (skip === 0 && rawText.length < TEXT_MAX_CHARS * 2) rawText += t.text + ' ';
      },
    });

  const transformed = rewriter.transform(new Response(body));
  const { truncated } = await readTextStream(transformed.body!);
  const text = rawText.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX_CHARS);
  return { title: title.trim(), description: (metaDesc || ogDesc).trim(), text, truncated };
}

export async function fetchAndExtract(
  url: string,
  fetchFn: typeof fetch = fetch.bind(globalThis),
  timeoutMs: number = TIMEOUT_MS,
): Promise<FetchResult> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      redirect: 'follow',
      headers: {
        'user-agent': 'NavBookAIBot/1.0',
        accept: 'text/html,application/xhtml+xml,text/plain,application/json,application/xml;q=0.9,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new FetchUrlError(`抓取超时(${TIMEOUT_MS / 1000}s)`);
    }
    throw new FetchUrlError('网络错误,无法访问该地址');
  }

  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const base = { status: res.status, finalUrl: res.url, contentType };

  if (contentType.includes('html') || contentType.includes('xml')) {
    const { title, description, text, truncated } = await extractHtml(res.body!);
    return { ...base, title, description, text, truncated };
  }
  if (contentType.startsWith('text/') || contentType.includes('json') || contentType.includes('xml')) {
    const { text: raw, truncated } = await readTextStream(res.body!);
    return { ...base, title: '', description: '', text: raw.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX_CHARS), truncated };
  }
  // 二进制:不读体,报类型与大小
  const len = res.headers.get('content-length');
  await res.body?.cancel().catch(() => {});
  return {
    ...base, title: '', description: '', text: '', truncated: false,
    note: `二进制内容(${contentType}${len ? `,${Math.round(Number(len) / 1024)}KB` : ''})未读取`,
  };
}
