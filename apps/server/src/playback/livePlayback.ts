import {
  applyPlaybackProgress,
  type PlaybackProgress,
  type PlaybackSourceStatus,
  type PlaybackStreamEvent,
} from "@cliparr/shared/providers";
import {
  listMediaSources,
  type MediaSource,
} from "@/db/mediaSourcesRepository";
import { getProvider } from "@/providers/registry";
import type {
  CurrentlyPlayingEntry,
  PlaybackResolver,
  ProviderImplementation,
} from "@/providers/types";
import type { ProviderSessionRecord } from "@/session/store";
import { startSourceConnection } from "@/playback/sourceConnection";
import { createPlaybackMaterialization } from "@/playback/materialization";
import { getServerLogger } from "@/logging";
import { logEventFields } from "@cliparr/shared/logging";
import { groupCurrentPlayback } from "@/playback/groupPlayback";
import { subscribePlaybackStateChanges } from "@/playback/stateChanges";

const logger = getServerLogger(["media", "discovery"]);

interface SourceSubscription {
  source: MediaSource;
  key: string;
  controller: AbortController;
  status: PlaybackSourceStatus;
  resolve?: PlaybackResolver;
  revision: number;
  progress: Map<string, PlaybackProgress>;
}

interface DashboardSubscription {
  session: ProviderSessionRecord;
  listeners: Set<(event: PlaybackStreamEvent) => void>;
  entries: Map<string, CurrentlyPlayingEntry[]>;
  errors: Map<string, string>;
  jobs: Map<
    string,
    {
      source: SourceSubscription;
      work: ReturnType<typeof createPlaybackMaterialization>;
    }
  >;
  expiry: ReturnType<typeof setTimeout>;
}

function sourceKey(source: MediaSource) {
  return JSON.stringify([
    source.providerId,
    source.providerAccountId,
    source.name,
    source.baseUrl,
    source.credentials,
    source.connection,
  ]);
}

export function createLivePlaybackHub(dependencies: {
  listSources: () => MediaSource[];
  provider: (id: string) => ProviderImplementation | undefined;
}) {
  const sources = new Map<string, SourceSubscription>();
  const dashboards = new Map<string, DashboardSubscription>();
  let unsubscribeChanges: (() => void) | undefined;

  const emit = (
    dashboard: DashboardSubscription,
    event: PlaybackStreamEvent,
  ) => {
    for (const listener of dashboard.listeners) {
      listener(event);
    }
  };
  const publish = (dashboard: DashboardSubscription) => {
    const statuses = [...sources.values()].map(({ status, source }) => {
      const message = dashboard.errors.get(source.id);
      return message ? { ...status, state: "error" as const, message } : status;
    });
    emit(dashboard, {
      type: "snapshot",
      snapshot: {
        viewers: applyPlaybackProgress(
          groupCurrentPlayback([...dashboard.entries.values()].flat()),
          [...sources.values()].flatMap((source) => [
            ...source.progress.values(),
          ]),
        ),
        sources: statuses,
        sourceErrors: statuses.flatMap((status) =>
          status.message
            ? [
                {
                  sourceId: status.sourceId,
                  sourceName: status.sourceName,
                  providerId: status.providerId,
                  message: status.message,
                },
              ]
            : [],
        ),
        loading: [...sources.values()].some(
          (source) =>
            !dashboard.entries.has(source.source.id) &&
            !dashboard.errors.has(source.source.id) &&
            (source.status.state === "connecting" ||
              source.status.state === "live"),
        ),
      },
    });
  };
  const publishAll = () => {
    for (const dashboard of dashboards.values()) {
      publish(dashboard);
    }
  };
  const stopSource = (subscription: SourceSubscription) => {
    subscription.controller.abort();
    for (const dashboard of dashboards.values()) {
      dashboard.jobs.get(subscription.source.id)?.work.stop();
      dashboard.jobs.delete(subscription.source.id);
    }
  };
  const active = (source: SourceSubscription) =>
    sources.get(source.source.id) === source;

  const materialize = (
    dashboard: DashboardSubscription,
    subscription: SourceSubscription,
  ) => {
    const id = subscription.source.id;
    if (!subscription.resolve) {
      return;
    }
    let job = dashboard.jobs.get(id);
    if (job?.source !== subscription) {
      job?.work.stop();
      job = {
        source: subscription,
        work: createPlaybackMaterialization({
          session: dashboard.session,
          onSuccess(entries) {
            dashboard.entries.set(id, entries);
            dashboard.errors.delete(id);
            publish(dashboard);
          },
          onFailure(error, retrying) {
            if (!dashboard.errors.has(id)) {
              logger.warn("Live playback preparation failed.", {
                ...logEventFields("media.live.prepare", "failure"),
                "source.id": id,
                "provider.id": subscription.source.providerId,
                "error.name": error instanceof Error ? error.name : undefined,
              });
            }
            dashboard.errors.set(
              id,
              retrying
                ? "Could not prepare playback details. Retrying automatically."
                : "Could not prepare playback details. Use Retry connection to try again.",
            );
            publish(dashboard);
          },
        }),
      };
      dashboard.jobs.set(id, job);
    }
    job.work.update(subscription.revision, subscription.resolve);
  };

  const startSource = (source: MediaSource) => {
    const subscription: SourceSubscription = {
      source,
      key: sourceKey(source),
      controller: new AbortController(),
      revision: 0,
      progress: new Map(),
      status: {
        sourceId: source.id,
        sourceName: source.name,
        providerId: source.providerId,
        state: "connecting",
      },
    };
    sources.set(source.id, subscription);
    startSourceConnection({
      source,
      provider: dependencies.provider(source.providerId),
      signal: subscription.controller.signal,
      onStatus(state, message) {
        if (!active(subscription)) {
          return;
        }
        subscription.status = { ...subscription.status, state, message };
        publishAll();
      },
      observer: {
        invalidate() {
          if (!active(subscription)) {
            return;
          }
          subscription.resolve = undefined;
          subscription.revision++;
          subscription.progress.clear();
          for (const dashboard of dashboards.values()) {
            dashboard.jobs.get(source.id)?.work.stop();
            dashboard.jobs.delete(source.id);
            dashboard.entries.delete(source.id);
            dashboard.errors.delete(source.id);
          }
          publishAll();
        },
        snapshot(resolve) {
          if (!active(subscription) || subscription.controller.signal.aborted) {
            return;
          }
          subscription.resolve = resolve;
          subscription.revision++;
          subscription.progress.clear();
          for (const dashboard of dashboards.values()) {
            materialize(dashboard, subscription);
          }
        },
        progress(updates) {
          if (!active(subscription) || subscription.controller.signal.aborted) {
            return;
          }
          for (const update of updates) {
            subscription.progress.set(update.sessionId, update);
          }
          for (const dashboard of dashboards.values()) {
            emit(dashboard, { type: "progress", updates });
          }
        },
      },
    });
  };

  const reconcile = () => {
    const desired = new Map(
      dependencies
        .listSources()
        .filter(
          (source) =>
            source.enabled &&
            (dependencies
              .provider(source.providerId)
              ?.supportsCurrentlyPlayingSource?.(source) ??
              true),
        )
        .map((source) => [source.id, source]),
    );
    for (const [id, subscription] of sources) {
      const source = desired.get(id);
      if (!source || sourceKey(source) !== subscription.key) {
        sources.delete(id);
        stopSource(subscription);
        for (const dashboard of dashboards.values()) {
          dashboard.entries.delete(id);
          dashboard.errors.delete(id);
        }
      }
    }
    for (const [id, source] of desired) {
      if (!sources.has(id)) {
        startSource(source);
      }
    }
    publishAll();
  };

  const removeDashboard = (dashboard: DashboardSubscription) => {
    clearTimeout(dashboard.expiry);
    for (const job of dashboard.jobs.values()) {
      job.work.stop();
    }
    dashboard.jobs.clear();
    dashboards.delete(dashboard.session.id);
    if (dashboards.size === 0) {
      for (const source of sources.values()) {
        stopSource(source);
      }
      sources.clear();
      unsubscribeChanges?.();
      unsubscribeChanges = undefined;
    }
  };
  const expire = (dashboard: DashboardSubscription) => {
    emit(dashboard, { type: "unauthorized" });
    removeDashboard(dashboard);
  };

  return {
    subscribe(
      session: ProviderSessionRecord,
      listener: (event: PlaybackStreamEvent) => void,
    ) {
      let dashboard = dashboards.get(session.id);
      if (!dashboard) {
        dashboard = {
          session,
          listeners: new Set(),
          entries: new Map(),
          errors: new Map(),
          jobs: new Map(),
          expiry: setTimeout(
            () => {
              const current = dashboards.get(session.id);
              if (current) {
                expire(current);
              }
            },
            Math.max(0, session.expiresAt - Date.now()),
          ),
        };
        dashboard.expiry.unref();
        dashboards.set(session.id, dashboard);
      }
      dashboard.listeners.add(listener);
      unsubscribeChanges ??= subscribePlaybackStateChanges((change) => {
        if (change.type === "sources") {
          reconcile();
        } else {
          const current = dashboards.get(change.sessionId);
          if (current) {
            expire(current);
          }
        }
      });
      reconcile();
      for (const subscription of sources.values()) {
        if (!dashboard.entries.has(subscription.source.id)) {
          materialize(dashboard, subscription);
        }
      }
      const current = dashboard;
      return () => {
        current.listeners.delete(listener);
        if (
          current.listeners.size === 0 &&
          dashboards.get(session.id) === current
        ) {
          removeDashboard(current);
        }
      };
    },
    retry() {
      if (dashboards.size === 0) {
        return;
      }
      for (const [id, subscription] of sources) {
        if (subscription.status.state === "live") {
          for (const dashboard of dashboards.values()) {
            if (dashboard.errors.has(id)) {
              dashboard.jobs.get(id)?.work.retry();
            }
          }
          continue;
        }
        sources.delete(id);
        stopSource(subscription);
        for (const dashboard of dashboards.values()) {
          dashboard.errors.delete(id);
        }
      }
      reconcile();
    },
  };
}

export const livePlayback = createLivePlaybackHub({
  listSources: () => listMediaSources({ enabledOnly: true }),
  provider: getProvider,
});
