import { Router } from "express";

import { setNoStore } from "@/http/cacheControl";
import { asyncHandler } from "@/http/errors";
import { versionInfoService } from "@/version/versionInfo";

export const versionRouter = Router();

versionRouter.get(
  "/",
  asyncHandler(async (_request, res) => {
    setNoStore(res);
    res.json(await versionInfoService.getVersionInfo());
  }),
);
