// Representative range boundaries used only to exercise private-address policy.
// These are synthetic classifier inputs, never destinations for real connections.
export const PRIVATE_IPV4_ADDRESSES = [
  "10.0.0.1",
  "172.16.0.1",
  "192.168.0.1",
] as const;
export const PRIVATE_IPV6_ADDRESS = "fd00::1";
export const MAPPED_PRIVATE_IPV4_HOST = "[::ffff:a00:1]";
