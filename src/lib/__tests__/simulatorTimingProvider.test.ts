import { describe, expect, it, vi } from "vitest";
import { createSimulatorTimingProvider } from "../simulatorTimingProvider";
import type { TimingProvider } from "../timingProvider";

describe("SimulatorTimingProvider — satisfies the TimingProvider contract", () => {
  it("has type 'simulator' and the required start/stop/subscribe methods", () => {
    const provider: TimingProvider = createSimulatorTimingProvider();
    expect(provider.type).toBe("simulator");
    expect(typeof provider.start).toBe("function");
    expect(typeof provider.stop).toBe("function");
    expect(typeof provider.subscribe).toBe("function");
  });

  it("delivers a simulated result to subscribers once started", () => {
    const provider = createSimulatorTimingProvider();
    const received: number[] = [];
    provider.subscribe((result) => received.push(result.measurements[0].value));

    provider.start();
    provider.simulateResult("back-hog", 3.75);

    expect(received).toEqual([3.75]);
  });

  it("does not deliver results before start() or after stop()", () => {
    const provider = createSimulatorTimingProvider();
    const listener = vi.fn();
    provider.subscribe(listener);

    provider.simulateResult("back-hog", 3.75); // before start
    expect(listener).not.toHaveBeenCalled();

    provider.start();
    provider.simulateResult("back-hog", 3.8);
    expect(listener).toHaveBeenCalledTimes(1);

    provider.stop();
    provider.simulateResult("back-hog", 3.9);
    expect(listener).toHaveBeenCalledTimes(1); // unchanged after stop
  });

  it("can be unsubscribed", () => {
    const provider = createSimulatorTimingProvider();
    const listener = vi.fn();
    const unsubscribe = provider.subscribe(listener);
    provider.start();

    provider.simulateResult("back-hog", 3.75);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    provider.simulateResult("back-hog", 3.8);
    expect(listener).toHaveBeenCalledTimes(1); // no further calls
  });

  it("survives a React Strict Mode-style mount → cleanup → remount without ending up with two active listeners", () => {
    // Simulates exactly what React 18/19 Strict Mode does in development: mount the
    // effect, immediately run its cleanup, then mount it again — to catch effects that
    // aren't safely re-runnable. TrackerApp.tsx's subscription effect follows this
    // subscribe-in-effect / unsubscribe-in-cleanup shape specifically so this sequence
    // is safe; this test locks that guarantee in at the provider level.
    const provider = createSimulatorTimingProvider();
    const listenerA = vi.fn();
    const listenerB = vi.fn();

    // First "mount".
    const unsubscribeA = provider.subscribe(listenerA);
    provider.start();

    // Strict Mode's synchronous cleanup + remount.
    unsubscribeA();
    provider.stop();
    provider.subscribe(listenerB);
    provider.start();

    provider.simulateResult("back-hog", 3.75);

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).toHaveBeenCalledTimes(1);
  });

  it("start/stop are idempotent — calling either twice in a row changes nothing further", () => {
    const provider = createSimulatorTimingProvider();
    const listener = vi.fn();
    provider.subscribe(listener);

    provider.start();
    provider.start(); // second call must not un-do or double the first
    provider.simulateResult("back-hog", 3.75);
    expect(listener).toHaveBeenCalledTimes(1);

    provider.stop();
    provider.stop(); // second call must not throw or re-enable delivery
    provider.simulateResult("back-hog", 3.8);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("simulateMultiMeasurementResult produces several measurements in one result", () => {
    const provider = createSimulatorTimingProvider();
    let receivedResult;
    provider.subscribe((result) => { receivedResult = result; });
    provider.start();

    provider.simulateMultiMeasurementResult([
      { measurementMode: "back-hog", value: 3.75 },
      { measurementMode: "hog-hog", value: 10.42 },
    ]);

    expect(receivedResult!.measurements).toHaveLength(2);
    expect(receivedResult!.measurements[0].measurementMode).toBe("back-hog");
    expect(receivedResult!.measurements[1].measurementMode).toBe("hog-hog");
  });

  it("simulateDuplicate re-emits the exact same result id", () => {
    const provider = createSimulatorTimingProvider();
    const ids: string[] = [];
    provider.subscribe((result) => ids.push(result.id));
    provider.start();

    const original = provider.simulateResult("back-hog", 3.75);
    provider.simulateDuplicate(original);

    expect(ids).toEqual([original.id, original.id]);
  });

  it("simulateInvalidResult still produces a syntactically well-formed result", () => {
    const provider = createSimulatorTimingProvider();
    let receivedResult;
    provider.subscribe((result) => { receivedResult = result; });
    provider.start();

    provider.simulateInvalidResult(-1);

    expect(receivedResult!.measurements).toHaveLength(1);
    expect(receivedResult!.measurements[0].value).toBe(-1);
  });

  it("simulateDelayed emits after the given delay, not immediately", async () => {
    vi.useFakeTimers();
    try {
      const provider = createSimulatorTimingProvider();
      const listener = vi.fn();
      provider.subscribe(listener);
      provider.start();

      provider.simulateDelayed("back-hog", 3.75, 500);
      expect(listener).not.toHaveBeenCalled();

      vi.advanceTimersByTime(499);
      expect(listener).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
