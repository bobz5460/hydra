import type { UserPreferences } from "@types";

const DEFAULT_SELF_HOST_API_PORT = "4000";
const DEFAULT_SELF_HOST_WS_PORT = "4001";

export interface SelfHostConfigState {
  baseUrl: string;
  apiUrl: string;
  authUrl: string;
  checkoutUrl: string;
  nimbusApiUrl: string;
  wsUrl: string;
}

const normalizeBaseUrl = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const deriveWsUrlFromBaseUrl = (baseUrl: string) => {
  try {
    const parsed = new URL(baseUrl);
    const protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    const explicitWsPort = import.meta.env.MAIN_VITE_SELF_HOST_WS_PORT?.trim();
    const fallbackPort =
      parsed.port === DEFAULT_SELF_HOST_API_PORT
        ? DEFAULT_SELF_HOST_WS_PORT
        : parsed.port || (protocol === "wss:" ? "443" : "80");
    const wsPort = explicitWsPort || fallbackPort;
    const hostWithPort = wsPort
      ? `${parsed.hostname}:${wsPort}`
      : parsed.hostname;
    return `${protocol}//${hostWithPort}`;
  } catch {
    return "";
  }
};

const envSelfHostBaseUrl = normalizeBaseUrl(
  import.meta.env.MAIN_VITE_SELF_HOST_BASE_URL
);

const buildEnvConfig = (): SelfHostConfigState => {
  const apiUrl =
    normalizeBaseUrl(import.meta.env.MAIN_VITE_API_URL) || envSelfHostBaseUrl;

  const authUrl =
    normalizeBaseUrl(import.meta.env.MAIN_VITE_AUTH_URL) ||
    (envSelfHostBaseUrl ? `${envSelfHostBaseUrl}/auth` : "");

  const checkoutUrl =
    normalizeBaseUrl(import.meta.env.MAIN_VITE_CHECKOUT_URL) ||
    (envSelfHostBaseUrl ? `${envSelfHostBaseUrl}/checkout` : "");

  const nimbusApiUrl =
    normalizeBaseUrl(import.meta.env.MAIN_VITE_NIMBUS_API_URL) ||
    envSelfHostBaseUrl;

  const wsUrl =
    normalizeBaseUrl(import.meta.env.MAIN_VITE_WS_URL) ||
    normalizeBaseUrl(import.meta.env.MAIN_VITE_SELF_HOST_WS_URL) ||
    (envSelfHostBaseUrl ? deriveWsUrlFromBaseUrl(envSelfHostBaseUrl) : "");

  return {
    baseUrl: envSelfHostBaseUrl || apiUrl,
    apiUrl,
    authUrl,
    checkoutUrl,
    nimbusApiUrl,
    wsUrl,
  };
};

const buildOverrideConfig = (baseUrl: string): SelfHostConfigState => ({
  baseUrl,
  apiUrl: baseUrl,
  authUrl: `${baseUrl}/auth`,
  checkoutUrl: `${baseUrl}/checkout`,
  nimbusApiUrl: baseUrl,
  wsUrl: deriveWsUrlFromBaseUrl(baseUrl),
});

export class SelfHostConfig {
  private static config: SelfHostConfigState = buildEnvConfig();

  public static get baseUrl() {
    return this.config.baseUrl;
  }

  public static get apiUrl() {
    return this.config.apiUrl;
  }

  public static get authUrl() {
    return this.config.authUrl;
  }

  public static get checkoutUrl() {
    return this.config.checkoutUrl;
  }

  public static get nimbusApiUrl() {
    return this.config.nimbusApiUrl;
  }

  public static get wsUrl() {
    return this.config.wsUrl;
  }

  public static getConfig(): SelfHostConfigState {
    return { ...this.config };
  }

  public static resolve(baseUrl?: string | null): SelfHostConfigState {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    return normalizedBaseUrl
      ? buildOverrideConfig(normalizedBaseUrl)
      : buildEnvConfig();
  }

  public static applyPreferences(preferences?: UserPreferences | null) {
    this.config = this.resolve(preferences?.cloudServerUrl);
    return this.getConfig();
  }
}
