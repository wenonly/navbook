import { describe, it, expect } from 'vitest';
import { parseSseStream } from './sse';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (i < chunks.length) ctrl.enqueue(enc.encode(chunks[i++]));
      else ctrl.close();
    },
  });
}

describe('parseSseStream', () => {
  it('解析 event/data 对,容忍心跳注释行', async () => {
    const out = [];
    for await (const ev of parseSseStream(streamOf([
      ': hb\n\n',
      'event: delta\n',
      'data: {"text":"你好"}\n\n',
      'event: done\ndata: {"messageIds":[]}\n\n',
    ]))) out.push(ev);
    expect(out).toEqual([
      { event: 'delta', data: '{"text":"你好"}' },
      { event: 'done', data: '{"messageIds":[]}' },
    ]);
  });

  it('跨 chunk 边界的事件不丢', async () => {
    const out = [];
    for await (const ev of parseSseStream(streamOf([
      'event: delta\nda', 'ta: {"text":"A"}', '\n\nevent: delta\ndata: {"text":"B"}\n\n',
    ]))) out.push(ev);
    expect(out.map(e => e.event)).toEqual(['delta', 'delta']);
    expect(JSON.parse(out[1].data).text).toBe('B');
  });

  it('多行 data 拼接', async () => {
    const out = [];
    for await (const ev of parseSseStream(streamOf(['event: x\ndata: l1\ndata: l2\n\n']))) out.push(ev);
    expect(out[0].data).toBe('l1\nl2');
  });
});
