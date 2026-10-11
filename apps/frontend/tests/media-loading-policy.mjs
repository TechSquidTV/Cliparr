import assert from "node:assert/strict";

const implementationFeatures = {
  gif: "/node_modules/@techsquidtv/gifenc/",
  audioPlan: "/src/lib/export/exportAudio.ts",
  export: "/src/lib/export/exportClip.ts",
};

export function discoverCodecPackages(dependencies) {
  return Object.keys(dependencies).filter((name) =>
    name.startsWith("@mediabunny/"),
  );
}

export function classifyModules(moduleIds, codecPackages) {
  const modules = moduleIds.map((id) => id.replaceAll("\\", "/"));
  const codecs = new Set();
  for (const id of modules) {
    const codec = id.match(/\/node_modules\/(@mediabunny\/[^/]+)/)?.[1];
    if (codec) {
      assert.ok(
        codecPackages.includes(codec),
        `Unclassified codec ${codec}: ${id}`,
      );
      codecs.add(codec);
    }
  }
  return [
    ...codecs,
    ...Object.entries(implementationFeatures)
      .filter(([, fragment]) => modules.some((id) => id.includes(fragment)))
      .map(([feature]) => feature),
  ];
}

export function assertCapabilityCoverage(
  chunks,
  codecPackages,
  positiveFeatures,
) {
  const emitted = new Set(
    Object.values(chunks).flatMap((chunk) => chunk.features),
  );
  const required = [...codecPackages, ...Object.keys(implementationFeatures)];
  for (const feature of required) {
    assert.ok(emitted.has(feature), `Missing ${feature} in build report`);
    assert.ok(
      positiveFeatures.includes(feature),
      `Missing positive loading scenario for ${feature}`,
    );
  }
}

export function assertLoadedFeatures(files, chunks, expected, label) {
  for (const file of files) {
    assert.ok(chunks[file], `${label}: unmapped JavaScript request ${file}`);
  }
  const loaded = [
    ...new Set(files.flatMap((file) => chunks[file].features)),
  ].toSorted();
  assert.deepEqual(
    loaded,
    [...expected].toSorted(),
    `${label}: unexpected feature downloads; contributing modules: ${JSON.stringify(files.map((file) => ({ file, modules: chunks[file].modules })))}`,
  );
  return loaded;
}
