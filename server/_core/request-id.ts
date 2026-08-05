import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

export const REQUEST_ID_HEADER = "x-request-id";

export function requestIdMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function getRequestId(res: Response): string | undefined {
  return typeof res.locals.requestId === "string"
    ? res.locals.requestId
    : undefined;
}
