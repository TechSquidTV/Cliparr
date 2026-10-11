import { Router } from "express";
import { versionInfoService } from "@/config/versionInfo";
import { asyncHandler } from "@/http/errors";
import { setNoStore } from "@/http/cacheControl";

export const versionRouter = Router();

versionRouter.get(
  "/",
  asyncHandler(async (_request, res) => {
    setNoStore(res);
    res.json(await versionInfoService.getVersionInfo());
  }),
);
