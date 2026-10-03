import type { AudioCodec } from "mediabunny";

let decoderRegistration: Promise<void> | undefined;

export function ensureAudioDecoder(codec: AudioCodec | null): Promise<void> {
  if (codec !== "ac3" && codec !== "eac3") {
    return Promise.resolve();
  }

  decoderRegistration ??= (async () => {
    const { registerAc3Decoder } = await import("@mediabunny/ac3");
    registerAc3Decoder();
  })().catch((error: Error) => {
    decoderRegistration = undefined;
    throw error;
  });

  return decoderRegistration;
}

const encoderRegistrations = new Map<AudioCodec, Promise<void>>();

export function ensureAudioEncoder(codec: AudioCodec): Promise<void> {
  const existing = encoderRegistrations.get(codec);
  if (existing) {
    return existing;
  }
  const registration = (async () => {
    const load = encoderLoaders[codec];
    await load?.();
  })().catch((error: Error) => {
    encoderRegistrations.delete(codec);
    throw error;
  });
  encoderRegistrations.set(codec, registration);
  return registration;
}

const encoderLoaders: Partial<Record<AudioCodec, () => Promise<void>>> = {
  mp3: async () => {
    const { registerMp3Encoder } = await import("@mediabunny/mp3-encoder");
    registerMp3Encoder();
  },
  flac: async () => {
    const { registerFlacEncoder } = await import("@mediabunny/flac-encoder");
    registerFlacEncoder();
  },
  aac: async () => {
    const { registerAacEncoder } = await import("@mediabunny/aac-encoder");
    registerAacEncoder();
  },
};
