import type { AudioCodec } from "mediabunny";

/** Internal registration state; injectable work keeps failure recovery testable. */
export function createCodecRegistration(load: () => Promise<void>) {
  let registration: Promise<void> | undefined;
  return () => {
    registration ??= (async () => {
      await load();
    })().catch((error: Error) => {
      registration = undefined;
      throw error;
    });
    return registration;
  };
}

const registerDecoder = createCodecRegistration(async () => {
  const { registerAc3Decoder } = await import("@mediabunny/ac3");
  registerAc3Decoder();
});

export function ensureAudioDecoder(codec: AudioCodec | null): Promise<void> {
  return codec === "ac3" || codec === "eac3"
    ? registerDecoder()
    : Promise.resolve();
}

export function ensureAudioEncoder(codec: AudioCodec): Promise<void> {
  return encoderLoaders[codec]?.() ?? Promise.resolve();
}

const encoderLoaders: Partial<Record<AudioCodec, () => Promise<void>>> = {
  mp3: createCodecRegistration(async () => {
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
  }),
  flac: createCodecRegistration(async () => {
    const { registerFlacEncoder } = await import("@mediabunny/flac-encoder");
    registerFlacEncoder();
  }),
  aac: createCodecRegistration(async () => {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  }),
};
