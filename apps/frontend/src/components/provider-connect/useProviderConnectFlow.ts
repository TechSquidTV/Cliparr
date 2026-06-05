import { useCallback, useEffect, useMemo, useState } from "react";
import { cliparrClient } from "@/api/cliparrClient";
import type { ProviderDefinition, ProviderSession } from "@/providers/types";

interface UseProviderConnectFlowOptions {
  onConnected: (session: ProviderSession) => Promise<void> | void;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useProviderConnectFlow({
  onConnected,
}: UseProviderConnectFlowOptions) {
  const [providers, setProviders] = useState<ProviderDefinition[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [authId, setAuthId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [loading, setLoading] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [error, setError] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProviders() {
      try {
        const data = await cliparrClient.listProviders();
        if (!cancelled) {
          setProviders(data);
        }
      } catch (error_: unknown) {
        if (!cancelled) {
          setError(errorMessage(error_, "Could not load providers."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedProvider = useMemo(
    () =>
      providers.find((provider) => provider.id === selectedProviderId) ??
      providers[0],
    [providers, selectedProviderId],
  );

  const providerLabel = useCallback(
    (id: string) => {
      return (
        providers.find((provider) => provider.id === id)?.name ?? "provider"
      );
    },
    [providers],
  );

  const resetProviderState = useCallback(() => {
    setAuthenticating(false);
    setAuthId("");
    setProviderId("");
    setPassword("");
  }, []);

  useEffect(() => {
    if (!authId || !providerId) {
      return;
    }

    const pollAuthStatus = async () => {
      try {
        const status = await cliparrClient.pollAuth(providerId, authId);
        if (status.status === "complete") {
          globalThis.clearInterval(intervalId);
          const session = await cliparrClient.getSession();
          await onConnected(session);
          resetProviderState();
          return;
        }

        if (status.status === "expired") {
          globalThis.clearInterval(intervalId);
          resetProviderState();
          setError(`${providerLabel(providerId)} sign-in expired.`);
        }
      } catch (error_: unknown) {
        globalThis.clearInterval(intervalId);
        resetProviderState();
        setError(
          errorMessage(
            error_,
            `Could not finish ${providerLabel(providerId)} sign-in.`,
          ),
        );
      }
    };
    const intervalId = globalThis.setInterval(() => {
      void pollAuthStatus();
    }, 1500);

    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [authId, onConnected, providerId, providerLabel, resetProviderState]);

  const startAuth = useCallback(
    async (provider: ProviderDefinition) => {
      setError("");
      setAuthId("");
      setProviderId(provider.id);
      setAuthenticating(true);

      try {
        const auth = await cliparrClient.startAuth(provider.id);
        setAuthId(auth.authId);
        window.open(auth.authUrl, "_blank", "noopener,noreferrer");
      } catch (error_: unknown) {
        resetProviderState();
        setError(
          errorMessage(error_, `Could not start ${provider.name} sign-in.`),
        );
      }
    },
    [resetProviderState],
  );

  const loginWithCredentials = useCallback(
    async (provider: ProviderDefinition) => {
      setError("");
      setAuthId("");
      setProviderId(provider.id);
      setAuthenticating(true);

      try {
        const session = await cliparrClient.loginWithCredentials(provider.id, {
          serverUrl,
          username,
          password,
        });
        await onConnected(session);
        resetProviderState();
        setServerUrl("");
        setUsername("");
      } catch (error_: unknown) {
        resetProviderState();
        setError(errorMessage(error_, `Could not connect ${provider.name}.`));
      }
    },
    [onConnected, password, resetProviderState, serverUrl, username],
  );

  return {
    providers,
    selectedProvider,
    selectedProviderId,
    setSelectedProviderId,
    authId,
    providerId,
    loading,
    authenticating,
    error,
    setError,
    serverUrl,
    setServerUrl,
    username,
    setUsername,
    password,
    setPassword,
    providerLabel,
    startAuth,
    loginWithCredentials,
  };
}
