// fetcher 测试:fetch 注入(同 mcp/provider 套路);HTMLRewriter 在 workerd 原生可用。
import { describe, it, expect } from 'vitest';
import { fetchAndExtract, FetchUrlError } from '../../src/ai/fetcher';

const enc = new TextEncoder();
function htmlRes(html: string, headers: Record<string, string> = {}, status = 200): Response {
  return new Response(enc.encode(html), { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

describe('fetchAndExtract', () => {
  it('提取 title/meta description/正文,剥离 script 与 nav 等非正文元素', async () => {
    const html = `<html><head><title>示例页面</title>
      <meta name="description" content="这是页面描述">
      <script>var evil = '不应出现';</script>
      <style>.a{color:red}</style></head>
      <body><nav>导航 不应出现</nav><header>页头 不应出现</header>
      <main><h1>标题一</h1><p>正文段落 甲乙丙。</p><p>第二段。</p></main>
      <footer>页脚 不应出现</footer></body></html>`;
    const r = await fetchAndExtract('https://x.example.com/page', async () => htmlRes(html));
    expect(r.status).toBe(200);
    expect(r.title).toBe('示例页面');
    expect(r.description).toBe('这是页面描述');
    expect(r.text).toContain('正文段落 甲乙丙。');
    expect(r.text).toContain('第二段。');
    expect(r.text).not.toContain('不应出现');
    expect(r.text).not.toContain('evil');
  });

  it('og 兜底:无 meta description 时用 og:description', async () => {
    const html = `<html><head><title>T</title>
      <meta property="og:description" content="og描述"><meta property="og:title" content="og标题"></head>
      <body><p>正文</p></body></html>`;
    const r = await fetchAndExtract('https://x.example.com', async () => htmlRes(html));
    expect(r.description).toBe('og描述');
  });

  it('重定向后 finalUrl 取最终地址', async () => {
    const r = await fetchAndExtract('https://x.example.com/old', async () => {
      const res = htmlRes('<html><body><p>hi</p></body></html>');
      // Response 构造器不支持 url 选项,实例上影子覆盖只读 getter
      Object.defineProperty(res, 'url', { value: 'https://x.example.com/new-final' });
      return res;
    });
    expect(r.finalUrl).toBe('https://x.example.com/new-final');
  });

  it('404 不算错误:状态码喂回模型', async () => {
    const r = await fetchAndExtract('https://x.example.com/gone', async () =>
      new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } }));
    expect(r.status).toBe(404);
  });

  it('text/plain 直读', async () => {
    const r = await fetchAndExtract('https://x.example.com/robots.txt', async () =>
      new Response('User-agent: *\nDisallow:', { status: 200, headers: { 'content-type': 'text/plain' } }));
    expect(r.text).toContain('User-agent');
    expect(r.title).toBe('');
  });

  it('application/json 直读', async () => {
    const r = await fetchAndExtract('https://x.example.com/api', async () =>
      new Response('{"a":1}', { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(r.text).toBe('{"a":1}');
  });

  it('二进制:只报类型不读体', async () => {
    const r = await fetchAndExtract('https://x.example.com/img.png', async () =>
      new Response(enc.encode('binary!'), {
        status: 200, headers: { 'content-type': 'image/png', 'content-length': '8' },
      }));
    expect(r.text).toBe('');
    expect(r.note).toContain('image/png');
  });

  it('正文超 512KB 驱动流截断标记 + 16K 字符上限', async () => {
    const big = `<html><head><title>大页</title></head><body><p>${'很长的正文'.repeat(60000)}</p></body></html>`;
    const r = await fetchAndExtract('https://x.example.com/big', async () =>
      new Response(enc.encode(big), { status: 200, headers: { 'content-type': 'text/html' } }));
    expect(r.text.length).toBeLessThanOrEqual(16 * 1024);
  });

  it('网络错误 → FetchUrlError 中文文案', async () => {
    await expect(fetchAndExtract('https://x.example.com', async () => { throw new TypeError('fetch failed'); }))
      .rejects.toThrow('网络错误');
  });

  it('超时 → 含「超时」', async () => {
    const never = (async (_u: any, init?: RequestInit) => {
      await new Promise((_r, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
      return new Response();
    }) as unknown as typeof fetch;
    await expect(fetchAndExtract('https://x.example.com', never, 50)).rejects.toSatisfy((e: unknown) =>
      e instanceof FetchUrlError && e.message.includes('超时'));
  });
});
