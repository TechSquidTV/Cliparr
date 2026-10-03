import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { closeDatabase, getDatabase, initializeDatabase } from "@/db/database";
import { upsertProviderAccountByAccessToken } from "@/db/providerAccountsRepository";
import {
  createRememberedProviderSession,
  getRememberedProviderSession,
  purgeExpiredRememberedProviderSessions,
  REMEMBERED_PROVIDER_SESSION_TTL_MS,
  revokeRememberedProviderSession,
  rotateRememberedProviderSession,
} from "@/db/rememberedProviderSessionsRepository";
import { rememberedProviderSessions, providerSessions } from "@/db/schema";
import {
  createProviderSession,
  getProviderSession,
  purgeExpiredProviderSessions,
} from "@/session/store";
import {
  purgeExpiredSessions,
  startExpiredSessionSweep,
} from "@/session/sweep";
import { subscribePlaybackStateChanges } from "@/playback/stateChanges";
import { createProviderMediaHandle } from "@/providers/shared/mediaProxy";

const TEST_APP_KEY = "remembered-session-test-key-with-32-characters";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}

async function withDatabase<T>(callback: () => T | Promise<T>) {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "cliparr-remembered-session-"),
  );
  const previousAppKey = process.env.APP_KEY;
  const previousDataDir = process.env.CLIPARR_DATA_DIR;

  process.env.APP_KEY = TEST_APP_KEY;
  process.env.CLIPARR_DATA_DIR = dataDir;

  try {
    initializeDatabase();
    return await callback();
  } finally {
    closeDatabase();
    restoreEnv("APP_KEY", previousAppKey);
    restoreEnv("CLIPARR_DATA_DIR", previousDataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

void test("remembered sessions expire after 30 days, not a year", async () => {
  assert.equal(REMEMBERED_PROVIDER_SESSION_TTL_MS, 1000 * 60 * 60 * 24 * 30);
});

function createTestAccount() {
  const account = upsertProviderAccountByAccessToken({
    providerId: "plex",
    label: "Rotation test account",
    accessToken: "account-token",
  });
  assert.ok(account);
  return account.id;
}

void test("rotation issues a fresh token and revokes the presented one", async () => {
  await withDatabase(() => {
    const accountId = createTestAccount();
    const created = createRememberedProviderSession(accountId);
    const rotated = rotateRememberedProviderSession(created.token);

    assert.ok(rotated);
    assert.notEqual(rotated.token, created.token);
    assert.equal(rotated.providerAccountId, accountId);
    assert.ok(
      rotated.expiresAt > Date.now() + 1000 * 60 * 60 * 24 * 29,
      "rotated token gets a fresh lifetime",
    );

    // The old token is dead.
    assert.equal(getRememberedProviderSession(created.token), undefined);
    assert.equal(rotateRememberedProviderSession(created.token), undefined);

    // The new token works.
    const lookedUp = getRememberedProviderSession(rotated.token);
    assert.ok(lookedUp);
    assert.equal(lookedUp.providerAccountId, accountId);

    // The old row is marked revoked, not deleted.
    const oldRow = getDatabase()
      .select()
      .from(rememberedProviderSessions)
      .where(eq(rememberedProviderSessions.id, created.id))
      .get();
    assert.ok(oldRow?.revokedAt);
  });
});

void test("rotation rejects missing, revoked, and expired tokens", async () => {
  await withDatabase(() => {
    const accountId = createTestAccount();
    assert.equal(rotateRememberedProviderSession(undefined), undefined);
    assert.equal(rotateRememberedProviderSession("nope"), undefined);

    const created = createRememberedProviderSession(accountId);
    revokeRememberedProviderSession(created.token);
    assert.equal(rotateRememberedProviderSession(created.token), undefined);

    const expiring = createRememberedProviderSession(accountId);
    getDatabase()
      .update(rememberedProviderSessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(rememberedProviderSessions.id, expiring.id))
      .run();
    assert.equal(rotateRememberedProviderSession(expiring.token), undefined);
  });
});

void test("purge removes expired and revoked remembered sessions only", async () => {
  await withDatabase(() => {
    const accountId = createTestAccount();
    const live = createRememberedProviderSession(accountId);
    const expired = createRememberedProviderSession(accountId);
    getDatabase()
      .update(rememberedProviderSessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(rememberedProviderSessions.id, expired.id))
      .run();
    const revoked = createRememberedProviderSession(accountId);
    revokeRememberedProviderSession(revoked.token);

    assert.equal(purgeExpiredRememberedProviderSessions(), 2);
    assert.ok(getRememberedProviderSession(live.token));
    assert.equal(purgeExpiredRememberedProviderSessions(), 0);
  });
});

void test("purge removes expired provider sessions and their cached state", async () => {
  await withDatabase(() => {
    const accountId = createTestAccount();
    const live = createProviderSession({
      providerId: "plex",
      providerAccountId: accountId,
      userToken: "token",
    });
    const expired = createProviderSession({
      providerId: "plex",
      providerAccountId: accountId,
      userToken: "token",
    });
    // Populate the caches before purging.
    assert.ok(getProviderSession(expired.id));

    const db = getDatabase();
    db.update(providerSessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(providerSessions.id, expired.id))
      .run();

    assert.equal(purgeExpiredProviderSessions(), 1);
    assert.equal(getProviderSession(expired.id), undefined);
    assert.ok(getProviderSession(live.id));
    assert.equal(purgeExpiredProviderSessions(), 0);
  });
});

void test("combined sweep purges both session tables", async () => {
  await withDatabase(() => {
    const accountId = createTestAccount();
    const remembered = createRememberedProviderSession(accountId);
    getDatabase()
      .update(rememberedProviderSessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(rememberedProviderSessions.id, remembered.id))
      .run();

    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: accountId,
      userToken: "token",
    });
    getDatabase()
      .update(providerSessions)
      .set({ expiresAt: Date.now() - 1 })
      .where(eq(providerSessions.id, session.id))
      .run();

    const result = purgeExpiredSessions();
    assert.deepEqual(result, {
      purgedProviderSessions: 1,
      purgedRememberedSessions: 1,
    });
  });
});

void test("rotation rolls back revocation when replacement insertion fails", async () => {
  await withDatabase(() => {
    const remembered = createRememberedProviderSession(createTestAccount());
    getDatabase().run(
      sql`CREATE TRIGGER reject_rotation BEFORE INSERT ON remembered_provider_sessions BEGIN SELECT RAISE(ABORT, 'replacement rejected'); END`,
    );
    assert.throws(() => rotateRememberedProviderSession(remembered.token));
    assert.ok(getRememberedProviderSession(remembered.token));
    assert.equal(purgeExpiredRememberedProviderSessions(), 0);
  });
});

void test("rotation and sweep agree on exact expiry and preserve the replacement", async (context) => {
  await withDatabase(() => {
    const remembered = createRememberedProviderSession(createTestAccount());
    context.mock.method(Date, "now", () => remembered.expiresAt - 1);
    const rotated = rotateRememberedProviderSession(remembered.token);
    assert.ok(rotated);
    assert.equal(purgeExpiredRememberedProviderSessions(), 1);
    assert.ok(getRememberedProviderSession(rotated.token));
    context.mock.method(Date, "now", () => rotated.expiresAt);
    assert.equal(rotateRememberedProviderSession(rotated.token), undefined);
    assert.equal(purgeExpiredRememberedProviderSessions(), 1);
  });
});

void test(
  "separate processes rotating alongside a sweep issue only one live replacement",
  { timeout: 15_000 },
  async () => {
    await withDatabase(async () => {
      const accountId = createTestAccount();
      const remembered = createRememberedProviderSession(accountId);
      const script = `
      import { initializeDatabase, closeDatabase } from "@/db/database";
      import { rotateRememberedProviderSession, purgeExpiredRememberedProviderSessions } from "@/db/rememberedProviderSessionsRepository";
      initializeDatabase();
      process.send("ready");
      process.once("message", () => {
        if (process.env.TEST_SWEEP === "1") purgeExpiredRememberedProviderSessions();
        else process.stdout.write(rotateRememberedProviderSession(process.env.TEST_REMEMBER_TOKEN)?.token ?? "");
        closeDatabase();
        process.disconnect();
      });
    `;
      const children = [0, 1, 2].map((index) => {
        const child = spawn(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "--eval", script],
          {
            env: {
              ...process.env,
              TEST_SWEEP: index === 2 ? "1" : "0",
              TEST_REMEMBER_TOKEN: remembered.token,
            },
            stdio: ["ignore", "pipe", "pipe", "ipc"],
          },
        );
        assert.ok(child.stdout && child.stderr);
        let output = "";
        let errors = "";
        child.stdout.setEncoding("utf8").on("data", (data: string) => {
          output += data;
        });
        child.stderr.setEncoding("utf8").on("data", (data: string) => {
          errors += data;
        });
        return {
          child,
          ready: once(child, "message"),
          done: once(child, "close"),
          output: () => output,
          errors: () => errors,
        };
      });
      try {
        await Promise.all(children.map(({ ready }) => ready));
        for (const { child } of children) {
          child.send("go");
        }
        const results = await Promise.all(children.map(({ done }) => done));
        for (const [index, result] of results.entries()) {
          assert.equal(result[0], 0, children[index]?.errors());
        }
        const tokens = children.map(({ output }) => output()).filter(Boolean);
        assert.equal(tokens.length, 1);
        assert.equal(
          getRememberedProviderSession(tokens[0])?.providerAccountId,
          accountId,
        );
        purgeExpiredRememberedProviderSessions();
        assert.equal(
          getDatabase().select().from(rememberedProviderSessions).all().length,
          1,
        );
      } finally {
        for (const { child } of children) {
          if (child.exitCode === null) {
            child.kill();
          }
        }
      }
    });
  },
);

void test("provider sweep evicts cached records and handle maps and notifies playback once", async () => {
  await withDatabase(async () => {
    const session = createProviderSession({
      providerId: "plex",
      providerAccountId: createTestAccount(),
      userToken: "token",
    });
    const cached = getProviderSession(session.id);
    assert.ok(cached);
    createProviderMediaHandle(
      cached,
      {
        providerId: "plex",
        sourceId: "source",
        baseUrl: "https://media.example.test",
        token: "token",
      },
      "/segment.ts",
    );
    const row = getDatabase()
      .select()
      .from(providerSessions)
      .where(eq(providerSessions.id, session.id))
      .get();
    assert.ok(row);
    const changes: string[] = [];
    const stop = subscribePlaybackStateChanges((change) => {
      if (change.type === "session") {
        changes.push(change.sessionId);
      }
    });
    try {
      assert.equal(purgeExpiredProviderSessions(session.expiresAt), 1);
      assert.equal(purgeExpiredProviderSessions(session.expiresAt), 0);
      await Promise.resolve();
      assert.deepEqual(changes, [session.id]);
      assert.equal(getProviderSession(session.id), undefined);
      // Reinsert the same ID to expose any lingering cached record or handle map.
      getDatabase().insert(providerSessions).values(row).run();
      const reloaded = getProviderSession(session.id);
      assert.ok(reloaded);
      assert.notEqual(reloaded, cached);
      assert.notEqual(reloaded.mediaHandles, cached.mediaHandles);
      assert.equal(reloaded.mediaHandles.size, 0);
      assert.equal(purgeExpiredProviderSessions(session.expiresAt), 1);
    } finally {
      stop();
    }
  });
});

void test("scheduled sweep runs immediately and hourly and stops on shutdown", async (context) => {
  await withDatabase(() => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const remembered = createRememberedProviderSession(createTestAccount());
    revokeRememberedProviderSession(remembered.token);
    const stop = startExpiredSessionSweep();
    try {
      assert.equal(purgeExpiredRememberedProviderSessions(), 0);
      const revoked = createRememberedProviderSession(
        remembered.providerAccountId,
      );
      revokeRememberedProviderSession(revoked.token);
      context.mock.timers.tick(60 * 60 * 1000);
      assert.equal(purgeExpiredRememberedProviderSessions(), 0);
      stop();
      const retained = createRememberedProviderSession(
        remembered.providerAccountId,
      );
      revokeRememberedProviderSession(retained.token);
      context.mock.timers.tick(60 * 60 * 1000);
      assert.equal(purgeExpiredRememberedProviderSessions(), 1);
    } finally {
      stop();
    }
  });
});
