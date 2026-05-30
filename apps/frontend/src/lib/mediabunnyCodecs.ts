let codecRegistration: Promise<void> | undefined;

export function ensureMediabunnyCodecs() {
  codecRegistration ??= (async () => {
    const [{ canEncodeAudio }, { registerAc3Decoder, registerAc3Encoder }] =
      await Promise.all([import("mediabunny"), import("@mediabunny/ac3")]);

    registerAc3Decoder();
    registerAc3Encoder();

    const canEncodeAac = await canEncodeAudio("aac").catch(() => false);
    if (!canEncodeAac) {
      const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
      registerAacEncoder();
    }
  })();

  return codecRegistration;
}
