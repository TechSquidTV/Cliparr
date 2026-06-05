import { Router } from "express";
import { versionInfoService } from "@/config/versionInfo";
import { asyncHandler } from "@/http/errors";
import { setNoStore } from "@/session/request";

export const versionRouter = Router();

versionRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    setNoStore(res);
    res.json(await versionInfoService.getVersionInfo());
  }),
);
