import type { Response } from "express";

export function setNoStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}
