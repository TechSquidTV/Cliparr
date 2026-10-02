import type { AudioCodec } from "mediabunny";

let codecRegistration: Promise<void> | undefined;

export function ensureMediabunnyCodecs() {
  codecRegistration ??= (async () => {
    const [{ canEncodeAudio }, { registerAc3Decoder, registerAc3Encoder }] =
      await Promise.all([import("mediabunny"), import("@mediabunny/ac3")]);

    registerAc3Decoder();
    registerAc3Encoder();

    const canEncodeAac = await canEncodeAudio("aac").catch(() => false);
    if (!canEncodeAac) {
      await ensureAudioEncoder("aac");
    }
  })().catch((error: Error) => {
    codecRegistration = undefined;
    throw error;
  });

  return codecRegistration;
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
