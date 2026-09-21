import { useCallback, useEffect, useRef, useState } from 'react';

/** 激活折线:视口顶部往下这条线上,最后一个已越过的标题所属区块即"当前"。
 *  取值必须 ≥ 锚点落点:html scroll-padding-top(96)+ 区块 scroll-mt-27(108)= 204px,
 *  再留 26px 余量防小数/缩放——否则落点标题压在线下,spy 会回算到前一个区块。 */
const ACTIVE_LINE = 230;

/**
 * 分区导航:滚动侦测(spy)+ 点击导航(锁定高亮)。
 *
 * 锁定/释放策略(短页刚需):页面不足 N 屏时,靠后区块的标题永远够不到折线,
 * "落点回算"无解——所以点击后的高亮只由**用户手动滚动意图**(滚轮/触摸/导航键)
 * 解除,程序平滑滚动的 scrollend 不抢高亮;用户一旦手动滚动即交还 spy。
 *
 * spy:滚动/Resize 时(rAF 节流)取「最后一个 top ≤ ACTIVE_LINE 的区块」;
 * 触底特判取末区块(手动滚到底时高亮最后一节,符合阅读直觉)。
 *
 * 已知边缘(接受):父区块极短(标题距其子分类容器 < ACTIVE_LINE)且位于页顶时,
 * 初始高亮会落在子分类——几何上"最后越线者"确实是他;真实数据的区块长度
 * 不会触发,点击导航不受影响(pin 锁定)。不为演示数据加启发式。
 */
export function useSectionNav(ids: string[]) {
  const [spyId, setSpyId] = useState<string | null>(ids[0] ?? null);
  const [pinned, setPinned] = useState<string | null>(null);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const compute = useCallback(() => {
    const els = idsRef.current
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) return;
    const doc = document.documentElement;
    if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
      setSpyId(els[els.length - 1].id);   // 触底:末区块
      return;
    }
    let hit = els[0].id;
    for (const el of els) {
      if (el.getBoundingClientRect().top <= ACTIVE_LINE) hit = el.id;
      else break;
    }
    setSpyId(hit);
  }, []);

  useEffect(() => {
    compute();
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(compute); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [ids.join(','), compute]);

  // 用户滚动意图 → 解除点击锁定,交还 spy
  useEffect(() => {
    const release = () => setPinned(p => (p == null ? p : null));
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) release();
    };
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchstart', release, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchstart', release);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const navigate = useCallback((id: string) => {
    setPinned(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return { activeId: pinned ?? spyId, navigate };
}
