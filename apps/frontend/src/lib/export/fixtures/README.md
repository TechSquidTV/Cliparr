# Audio integration fixture

`precision-32.wav` is a 76-byte, mono, 48 kHz, signed 32-bit PCM WAV with eight
samples: `0, 1, -1, 1073741825, -1073741825, 2147483647, -2147483648, 0`.

This fixed input was constructed directly as a standard RIFF/WAVE file. It is
independent of the MediaBunny encoder used by the tests. The values expose any
accidental float32 conversion in Cliparr's lossless sample preparation.
Other test inputs are generated with MediaBunny's public APIs.
