import { describe, it, expect } from "vitest";
import {
  makeKeys,
  DEFAULT_LAYOUT,
  hitKey,
  mapPoint,
  NoteOwners,
  HoverEngine,
  HandTracker,
  readSettings,
  type NoteEvent,
} from "../src/core";
const keys = makeKeys(1000, 750, DEFAULT_LAYOUT);
const c = keys.find((k) => k.midi === 60)!;
const d = keys.find((k) => k.midi === 62)!;
const center = (k: typeof c) => ({ x: k.x + k.w / 2, y: k.y + k.h * 0.85 });
function harness() {
  const events: NoteEvent[] = [];
  const notes = new NoteOwners((e) => events.push(e));
  return { events, notes, engine: new HoverEngine(notes, 100, 200) };
}
describe("琴键几何和映射", () => {
  it("13个音高唯一且包含C5，黑键优先，白键下半部可命中", () => {
    expect(new Set(keys.map((k) => k.midi)).size).toBe(13);
    expect(hitKey(keys, center(keys.find((k) => k.midi === 72)!))?.midi).toBe(
      72,
    );
    const sharp = keys.find((k) => k.midi === 61)!;
    expect(hitKey(keys, { x: sharp.x + 2, y: sharp.y + 10 })?.midi).toBe(61);
    expect(hitKey(keys, center(c))?.midi).toBe(60);
    expect(hitKey(keys, { x: 0, y: 0 })).toBeUndefined();
  });
  it("保持比例与镜像，正确补偿横向和纵向留白", () => {
    expect(mapPoint({ x: 0, y: 0 }, 640, 480, 1000, 750)).toEqual({
      x: 1000,
      y: 0,
    });
    expect(mapPoint({ x: 0.25, y: 0.5 }, 640, 480, 1000, 1000)).toEqual({
      x: 750,
      y: 500,
    });
    const letterbox = mapPoint({ x: 0.25, y: 0 }, 640, 480, 1000, 500);
    expect(letterbox.x).toBeCloseTo(666.6666667);
    expect(letterbox.y).toBeCloseTo(0);
    expect(mapPoint({ x: 0.25, y: 0.5 }, 640, 480, 1000, 750, false)).toEqual({
      x: 250,
      y: 375,
    });
  });
});
describe("悬停与占用", () => {
  const id = "hand:1:8";
  it("悬停达到阈值才发音，停留3秒不重复，移出可重弹", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    engine.update([{ id, point: center(c) }], keys, 99);
    expect(events).toEqual([]);
    for (let t = 100; t <= 3100; t += 50)
      engine.update([{ id, point: center(c) }], keys, t);
    expect(events).toEqual([{ type: "on", midi: 60 }]);
    engine.update([{ id, point: { x: 0, y: 0 } }], keys, 3150);
    engine.update([{ id, point: center(c) }], keys, 3200);
    engine.update([{ id, point: center(c) }], keys, 3300);
    expect(events.map((e) => e.type)).toEqual(["on", "off", "on"]);
  });
  it("切换琴键重新确认，未完成悬停的离开不产生声音", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    engine.update([{ id, point: center(d) }], keys, 50);
    engine.update([{ id, point: center(d) }], keys, 100);
    expect(events).toEqual([]);
    engine.update([{ id, point: center(d) }], keys, 150);
    expect(events).toEqual([{ type: "on", midi: 62 }]);
  });
  it("同一琴键两指只起音一次，最后一指离开才释放", () => {
    const { notes, events } = harness();
    notes.set("a", 60);
    notes.set("b", 60);
    notes.set("a");
    expect(events).toEqual([{ type: "on", midi: 60 }]);
    notes.set("b");
    expect(events).toEqual([
      { type: "on", midi: 60 },
      { type: "off", midi: 60 },
    ]);
  });
  it("四音独立占用且reset清理全部活动音符", () => {
    const { notes, events } = harness();
    [60, 64, 67, 71].forEach((m, i) => notes.set(String(i), m));
    expect(notes.active.size).toBe(4);
    notes.reset();
    expect(notes.active.size).toBe(0);
    expect(events.filter((e) => e.type === "off").length).toBe(4);
  });
  it("丢手200ms释放，返回后需要重新悬停", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    engine.update([{ id, point: center(c) }], keys, 100);
    engine.update([], keys, 130);
    engine.expire(299);
    expect(events.length).toBe(1);
    engine.expire(300);
    expect(events.length).toBe(2);
    engine.update([{ id, point: center(c) }], keys, 310);
    expect(events.length).toBe(2);
    engine.update([{ id, point: center(c) }], keys, 410);
    expect(events.length).toBe(3);
  });
  it("短暂丢失候选帧冻结进度，返回时不会借用丢失时间发声", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    engine.update([], keys, 60);
    engine.update([{ id, point: center(c) }], keys, 110);
    expect(events).toEqual([]);
  });
  it("150ms识别间隔仍可确认，进度只在有效观察时增加", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    expect(engine.progress(id, 140)).toBe(0);
    engine.update([{ id, point: center(c) }], keys, 150);
    expect(events).toEqual([{ type: "on", midi: 60 }]);
    for (const now of [300, 450, 600])
      engine.update([{ id, point: center(c) }], keys, now);
    expect(events.length).toBe(1);
    expect(engine.diagnostics.triggers).toBe(1);
    expect(engine.graceMs).toBeLessThanOrEqual(320);
  });
  it("漏检保留已有进度，但必须再次稳定观察才能触发；长时间丢失清空", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    engine.update([{ id, point: center(c) }], keys, 70);
    engine.update([], keys, 100);
    engine.update([{ id, point: center(c) }], keys, 140);
    expect(engine.progress(id, 140)).toBe(0.7);
    expect(events).toEqual([]);
    engine.update([{ id, point: center(c) }], keys, 175);
    expect(events.length).toBe(1);
    engine.expire(500);
    expect(events[1]).toEqual({ type: "off", midi: 60 });
    engine.update([{ id, point: center(c) }], keys, 510);
    expect(events.length).toBe(2);
  });
  it("一次检测不能靠时钟自动发声，黑键边缘不会误落到下面的白键", () => {
    const { engine, events } = harness();
    const sharp = keys.find((k) => k.midi === 61)!;
    const edge = { x: sharp.x + 0.1, y: sharp.y + 10 };
    for (const now of [0, 50, 100, 150])
      engine.update([{ id, point: edge }], keys, now);
    expect(events).toEqual([]);
    engine.update([{ id, point: center(c) }], keys, 200);
    engine.expire(1000);
    expect(events).toEqual([]);
  });
  it("键盘和鼠标释放不干扰手指的同音占用", () => {
    const { notes, events, engine } = harness();
    notes.set("pointer:1", 60);
    notes.set(id, 60);
    engine.reset();
    expect(events.length).toBe(1);
    notes.set("pointer:1");
    expect(events[1]).toEqual({ type: "off", midi: 60 });
  });
});
describe("追踪关联和设置", () => {
  const hand = (x: number, label: string) => ({
    label,
    landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.5 })),
  });
  it("识别数组换序不会更换手部身份", () => {
    const tracker = new HandTracker();
    const first = tracker.update([hand(0.2, "Left"), hand(0.8, "Right")], 0);
    const next = tracker.update([hand(0.79, "Right"), hand(0.21, "Left")], 33);
    expect(next[0].id).toBe(first[1].id);
    expect(next[1].id).toBe(first[0].id);
  });
  it("关联不明确时创建新身份，过期手部不复用", () => {
    const tracker = new HandTracker();
    const first = tracker.update(
      [hand(0.45, "Unknown"), hand(0.55, "Unknown")],
      0,
    );
    const second = tracker.update([hand(0.5, "Unknown")], 33);
    expect(first.map((t) => t.id)).not.toContain(second[0].id);
    expect(tracker.update([hand(0.5, "Unknown")], 500)[0].id).not.toBe(
      second[0].id,
    );
  });
  it("无效设置和损坏存储有安全默认值与边界约束", () => {
    expect(readSettings("not-json").volume).toBe(65);
    const s = readSettings(
      JSON.stringify({
        volume: 999,
        dwell: -1,
        layout: { width: 900 },
        skeleton: "no",
        fingers: "other",
      }),
    );
    expect(s.volume).toBe(100);
    expect(s.dwell).toBe(50);
    expect(s.layout.width).toBe(96);
    expect(s.skeleton).toBe(true);
    expect(s.fingers).toBe("index");
  });
});
