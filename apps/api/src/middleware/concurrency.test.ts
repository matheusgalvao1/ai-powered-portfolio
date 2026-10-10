import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";
import { createConcurrencyMiddleware } from "./concurrency.js";

function fakeReq(ip: string): Request {
  return { ip } as unknown as Request;
}

type FakeConn = { res: Response; codes: number[]; emit: (event: string) => void };

function fakeRes(): FakeConn {
  const emitter = new EventEmitter();
  const codes: number[] = [];
  const res = emitter as unknown as Response;
  (res as unknown as {
    status: (code: number) => { json: (body: unknown) => void };
  }).status = (code) => {
    codes.push(code);
    return { json: () => {} };
  };
  return { res, codes, emit: (event) => emitter.emit(event) };
}

function handshake(middleware: ReturnType<typeof createConcurrencyMiddleware>, ip: string): FakeConn {
  const conn = fakeRes();
  middleware(fakeReq(ip), conn.res, () => {});
  return conn;
}

describe("createConcurrencyMiddleware", () => {
  it("allows streams up to the per-ip cap, then rejects", () => {
    const middleware = createConcurrencyMiddleware({ maxPerIp: 2, maxGlobal: 10 });

    handshake(middleware, "1.1.1.1");
    handshake(middleware, "1.1.1.1");
    const third = handshake(middleware, "1.1.1.1");

    expect(third.codes).toEqual([429]);
  });

  it("enforces the global cap across ips", () => {
    const middleware = createConcurrencyMiddleware({ maxPerIp: 10, maxGlobal: 2 });

    handshake(middleware, "1.1.1.1");
    handshake(middleware, "2.2.2.2");
    const third = handshake(middleware, "3.3.3.3");

    expect(third.codes).toEqual([429]);
  });

  it("frees the slot when the stream closes", () => {
    const middleware = createConcurrencyMiddleware({ maxPerIp: 1, maxGlobal: 10 });

    const first = handshake(middleware, "1.1.1.1");
    const second = handshake(middleware, "1.1.1.1");
    expect(second.codes).toEqual([429]);

    first.emit("close");

    const retry = handshake(middleware, "1.1.1.1");
    expect(retry.codes).toEqual([]);
  });

  it("frees the slot on normal completion", () => {
    const middleware = createConcurrencyMiddleware({ maxPerIp: 1, maxGlobal: 10 });

    const first = handshake(middleware, "1.1.1.1");
    first.emit("finish");

    const retry = handshake(middleware, "1.1.1.1");
    expect(retry.codes).toEqual([]);
  });

  it("does not leak slots when close and finish both fire", () => {
    const middleware = createConcurrencyMiddleware({ maxPerIp: 1, maxGlobal: 1 });

    const first = handshake(middleware, "1.1.1.1");
    first.emit("close");
    first.emit("finish");

    const second = handshake(middleware, "2.2.2.2");
    expect(second.codes).toEqual([]);

    const third = handshake(middleware, "3.3.3.3");
    expect(third.codes).toEqual([429]);
  });

  it("tracks ips independently", () => {
    const middleware = createConcurrencyMiddleware({ maxPerIp: 1, maxGlobal: 10 });

    const first = handshake(middleware, "1.1.1.1");
    const second = handshake(middleware, "2.2.2.2");
    expect(first.codes).toEqual([]);
    expect(second.codes).toEqual([]);
  });
});
