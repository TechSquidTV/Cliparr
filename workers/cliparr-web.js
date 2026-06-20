function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/__cliparr/runtime-config.json") {
      const sentryDsn = stringValue(env.SENTRY_DSN);

      return Response.json(
        {
          sentryDsn: sentryDsn || null,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return env.ASSETS.fetch(request);
  },
};
