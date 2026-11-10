import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveLogFileMaxBytes,
  resolveLogFileMaxFiles,
  resolveServerConsoleLogFormat,
  resolveServerLogFileConfig,
  resolveServerLogFormat,
} from "@/logging";

void test("resolves supported server log formats", () => {
  assert.equal(resolveServerLogFormat("json"), "json");
  assert.equal(resolveServerLogFormat("LOGFMT"), "logfmt");
  assert.equal(resolveServerLogFormat(" pretty "), "pretty");
});

void test("falls back to pretty for invalid server log formats", () => {
  assert.equal(resolveServerLogFormat(), "pretty");
  assert.equal(resolveServerLogFormat("verbose"), "pretty");
});

void test("uses JSON console logs outside production", () => {
  assert.equal(resolveServerConsoleLogFormat({}), "json");
  assert.equal(
    resolveServerConsoleLogFormat({
      NODE_ENV: "development",
      CLIPARR_LOG_FORMAT: "pretty",
    }),
    "json",
  );
  assert.equal(
    resolveServerConsoleLogFormat({
      NODE_ENV: "test",
      CLIPARR_LOG_FORMAT: "logfmt",
    }),
    "json",
  );
});

void test("uses configured console log format in production", () => {
  assert.equal(
    resolveServerConsoleLogFormat({
      NODE_ENV: "production",
      CLIPARR_LOG_FORMAT: "logfmt",
    }),
    "logfmt",
  );
  assert.equal(
    resolveServerConsoleLogFormat({
      NODE_ENV: "production",
      CLIPARR_LOG_FORMAT: "verbose",
    }),
    "pretty",
  );
});

void test("resolves rotating log file size limits", () => {
  assert.equal(resolveLogFileMaxBytes(), 10 * 1024 * 1024);
  assert.equal(resolveLogFileMaxBytes("128kb"), 128 * 1024);
  assert.equal(resolveLogFileMaxBytes("2 MiB"), 2 * 1024 * 1024);
  assert.equal(resolveLogFileMaxBytes("nope"), 10 * 1024 * 1024);
});

void test("resolves rotating log file count limits", () => {
  assert.equal(resolveLogFileMaxFiles(), 5);
  assert.equal(resolveLogFileMaxFiles("1"), 1);
  assert.equal(resolveLogFileMaxFiles("8"), 8);
  assert.equal(resolveLogFileMaxFiles("0"), 5);
});

void test("resolves file logging only when a file path is configured", () => {
  assert.equal(resolveServerLogFileConfig({}), undefined);

  assert.deepEqual(
    resolveServerLogFileConfig({
      CLIPARR_LOG_FILE: "cliparr.log",
      CLIPARR_LOG_FORMAT: "logfmt",
      CLIPARR_LOG_FILE_MAX_SIZE: "1mb",
      CLIPARR_LOG_FILE_MAX_FILES: "3",
    }),
    {
      filePath: `${process.cwd()}/cliparr.log`,
      format: "logfmt",
      maxBytes: 1024 * 1024,
      maxFiles: 3,
    },
  );
});

void test("defaults file logging to JSON when console format is unset", () => {
  assert.equal(
    resolveServerLogFileConfig({ CLIPARR_LOG_FILE: "cliparr.log" })?.format,
    "json",
  );
});

void test("all server console and file formats redact session fields and cookie headers", (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "cliparr-log-redaction-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const format of ["pretty", "json", "logfmt"]) {
    const file = path.join(directory, `${format}.log`);
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        `
      import { dispose, withContext } from "@logtape/logtape";
      import { configureLogging, getServerLogger } from "./src/logging.ts";
      await configureLogging();
      withContext({ "session.id": "login-secret-marker" }, () => {
        getServerLogger("session").info(process.argv[1], {
          Cookie: "cookie-secret-marker",
          headers: { "Set-Cookie": "set-cookie-secret-marker" },
          "http.request.header.cookie": "request-secret-marker",
          "http.response.header.Set-Cookie": "response-secret-marker",
          "http.request.header.authorization": "authorization-secret-marker",
          "http.request.header.proxy-authorization": "proxy-secret-marker",
          "cliparr_remember": "remember-secret-marker",
          "request.id": "safe-request-marker",
          "plex.playback_session.id": "safe-playback-marker",
        });
      });
      await dispose();
    `,
        "Redaction probe {session.id} {Cookie} {http.request.header.cookie} {http.response.header.Set-Cookie} {request.id}",
      ],
      {
        env: {
          ...process.env,
          NODE_ENV: "production",
          CLIPARR_LOG_LEVEL: "info",
          CLIPARR_LOG_FILE: file,
          CLIPARR_LOG_FORMAT: format,
          CLIPARR_LOG_FILE_FORMAT: format,
        },
        encoding: "utf8",
      },
    );
    assert.equal(child.status, 0, child.stderr);
    for (const output of [
      child.stdout + child.stderr,
      readFileSync(file, "utf8"),
    ]) {
      assert.ok(output.includes("safe-request-marker"), format);
      assert.ok(!output.includes("secret-marker"), format);
      if (format !== "pretty") {
        assert.ok(output.includes("safe-playback-marker"), format);
      }
    }
  }
});
