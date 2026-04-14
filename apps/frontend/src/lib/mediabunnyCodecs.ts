import { canEncodeAudio } from "mediabunny";
import { registerAacEncoder } from "@mediabunny/aac-encoder";
import { registerAc3Decoder, registerAc3Encoder } from "@mediabunny/ac3";

let codecRegistration: Promise<void> | undefined;

export function ensureMediabunnyCodecs() {
  codecRegistration ??= (async () => {
    registerAc3Decoder();
    registerAc3Encoder();

    const canEncodeAac = await canEncodeAudio("aac").catch(() => false);
    if (!canEncodeAac) {
      registerAacEncoder();
    }
  })();

  return codecRegistration;
}
