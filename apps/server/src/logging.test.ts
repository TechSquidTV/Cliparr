import assert from "node:assert/strict";
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
  assert.equal(resolveServerLogFormat(undefined), "pretty");
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
  assert.equal(resolveLogFileMaxBytes(undefined), 10 * 1024 * 1024);
  assert.equal(resolveLogFileMaxBytes("128kb"), 128 * 1024);
  assert.equal(resolveLogFileMaxBytes("2 MiB"), 2 * 1024 * 1024);
  assert.equal(resolveLogFileMaxBytes("nope"), 10 * 1024 * 1024);
});

void test("resolves rotating log file count limits", () => {
  assert.equal(resolveLogFileMaxFiles(undefined), 5);
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
