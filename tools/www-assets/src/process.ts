import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";

export async function run(
  command: string,
  arguments_: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    capture?: boolean;
    timeout?: number;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      timeout: options.timeout ?? 600_000,
      signal: options.signal,
    });
    let output = "";
    let errors = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      errors += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(
          new Error(`${command} failed (${code}): ${errors.slice(-3000)}`),
        );
      }
    });
  });
}

export async function waitUntil<T>(
  description: string,
  read: () => Promise<T | undefined>,
  timeout = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }
    await setTimeout(200);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}
