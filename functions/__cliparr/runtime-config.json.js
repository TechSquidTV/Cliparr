function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function onRequestGet({ env }) {
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
