import { useState } from "react";
import { createRoot } from "react-dom/client";

import { useHlsExportEstimate } from "#/components/editor/useHlsExportEstimate";
import { getFrontendLogger } from "#/logging";

const logger = getFrontendLogger(["editor", "export"]);
function Fixture() {
  const [url, setUrl] = useState<string | null>("/first.m3u8");
  const [sessionId, setSessionId] = useState("first");
  const [height, setHeight] = useState(480);
  const estimate = useHlsExportEstimate({
    url,
    sessionId,
    role: "test",
    outputDimensions: { width: 1920, height },
    logger,
  });
  return (
    <>
      <output>{estimate?.bitrateKbps ?? "none"}</output>
      <button onClick={() => setHeight(1080)}>resolution</button>
      <button onClick={() => setUrl("/second.m3u8")}>source</button>
      <button onClick={() => setSessionId("second")}>session</button>
      <button onClick={() => setUrl("/first.m3u8")}>open</button>
      <button onClick={() => setUrl("/slow.m3u8")}>slow</button>
      <button onClick={() => setUrl(null)}>close</button>
    </>
  );
}
const root = document.querySelector("#root");
if (!root) {
  throw new Error("Missing fixture root");
}
createRoot(root).render(<Fixture />);
