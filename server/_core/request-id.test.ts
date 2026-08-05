import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  getRequestId,
  requestIdMiddleware,
  REQUEST_ID_HEADER,
} from "./request-id";

function createResponseMock() {
  return {
    locals: {} as Record<string, unknown>,
    setHeader: vi.fn(),
  } as unknown as Response;
}

describe("request ID middleware", () => {
  it("generates, stores, and returns a request ID", () => {
    const response = createResponseMock();
    const next = vi.fn();

    requestIdMiddleware({} as Request, response, next);

    const requestId = getRequestId(response);
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      REQUEST_ID_HEADER,
      requestId
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it("creates a new ID for every request", () => {
    const firstResponse = createResponseMock();
    const secondResponse = createResponseMock();

    requestIdMiddleware({} as Request, firstResponse, vi.fn());
    requestIdMiddleware({} as Request, secondResponse, vi.fn());

    expect(getRequestId(firstResponse)).not.toBe(getRequestId(secondResponse));
  });
});
