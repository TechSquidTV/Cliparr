export const DEFAULT_DEVELOPMENT_PORT = 3000;
export const DEFAULT_PRODUCTION_PORT = 7171;

interface ServerPortEnv {
  NODE_ENV?: string;
  PORT?: string;
}

function defaultServerPort(env: ServerPortEnv = process.env) {
  return env.NODE_ENV === "production"
    ? DEFAULT_PRODUCTION_PORT
    : DEFAULT_DEVELOPMENT_PORT;
}

export function resolveServerPort(env: ServerPortEnv = process.env) {
  return Number(env.PORT ?? defaultServerPort(env));
}
