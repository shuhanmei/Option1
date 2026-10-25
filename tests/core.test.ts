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
describe("Key geometry and coordinate mapping", () => {
  it("13 unique pitches include C5; black keys take priority and lower white keys are reachable", () => {
    expect(new Set(keys.map((k) => k.midi)).size).toBe(13);
    expect(hitKey(keys, center(keys.find((k) => k.midi === 72)!))?.midi).toBe(
      72,
    );
    const sharp = keys.find((k) => k.midi === 61)!;
    expect(hitKey(keys, { x: sharp.x + 2, y: sharp.y + 10 })?.midi).toBe(61);
    expect(hitKey(keys, center(c))?.midi).toBe(60);
    expect(hitKey(keys, { x: 0, y: 0 })).toBeUndefined();
  });
  it("Preserve aspect ratio and mirroring with horizontal and vertical margins", () => {
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
describe("Hover and note ownership", () => {
  const id = "hand:1:8";
  it("Trigger after the dwell threshold, never repeat while held, and retrigger after exit", () => {
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
  it("Changing keys restarts confirmation; leaving before the threshold stays silent", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    engine.update([{ id, point: center(d) }], keys, 50);
    engine.update([{ id, point: center(d) }], keys, 100);
    expect(events).toEqual([]);
    engine.update([{ id, point: center(d) }], keys, 150);
    expect(events).toEqual([{ type: "on", midi: 62 }]);
  });
  it("Two fingers share one attack and release only when the final owner leaves", () => {
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
  it("Four notes have independent owners and reset releases every active note", () => {
    const { notes, events } = harness();
    [60, 64, 67, 71].forEach((m, i) => notes.set(String(i), m));
    expect(notes.active.size).toBe(4);
    notes.reset();
    expect(notes.active.size).toBe(0);
    expect(events.filter((e) => e.type === "off").length).toBe(4);
  });
  it("Release after 200 ms of tracking loss and require fresh hover on return", () => {
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
  it("Brief candidate loss freezes progress without counting the missing interval", () => {
    const { engine, events } = harness();
    engine.update([{ id, point: center(c) }], keys, 0);
    engine.update([], keys, 60);
    engine.update([{ id, point: center(c) }], keys, 110);
    expect(events).toEqual([]);
  });
  it("150 ms observation intervals still confirm using only supported time", () => {
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
  it("Missing observations preserve progress but require stable return; long gaps clear state", () => {
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
  it("A single detection cannot trigger from elapsed time; black-key edges do not hit white keys below", () => {
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
  it("Keyboard and mouse releases do not disturb finger ownership of the same pitch", () => {
    const { notes, events, engine } = harness();
    notes.set("pointer:1", 60);
    notes.set(id, 60);
    engine.reset();
    expect(events.length).toBe(1);
    notes.set("pointer:1");
    expect(events[1]).toEqual({ type: "off", midi: 60 });
  });
});
describe("Hand association and settings", () => {
  const hand = (x: number, label: string) => ({
    label,
    landmarks: Array.from({ length: 21 }, () => ({ x, y: 0.5 })),
  });
  it("Detection array reordering preserves hand identity", () => {
    const tracker = new HandTracker();
    const first = tracker.update([hand(0.2, "Left"), hand(0.8, "Right")], 0);
    const next = tracker.update([hand(0.79, "Right"), hand(0.21, "Left")], 33);
    expect(next[0].id).toBe(first[1].id);
    expect(next[1].id).toBe(first[0].id);
  });
  it("Ambiguous matches create new IDs and expired tracks are not reused", () => {
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
  it("Invalid settings and damaged storage fall back to bounded defaults", () => {
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
