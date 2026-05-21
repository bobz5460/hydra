import type { UserPreferences } from "@types";

const DEFAULT_SELF_HOST_API_PORT = "4000";
const DEFAULT_SELF_HOST_WS_PORT = "4001";

export interface SelfHostConfigState {
  isEnabled: boolean;
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

const parseBoolean = (value?: string | boolean | null) => {
  if (typeof value === "boolean") return value;

  const normalizedValue = value?.toLowerCase();
  return (
    normalizedValue === "true" ||
    normalizedValue === "1" ||
    normalizedValue === "yes" ||
    normalizedValue === "on"
  );
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

const isEnvSelfHostedCloudEnabled = parseBoolean(
  import.meta.env.MAIN_VITE_SELF_HOST_CLOUD
);

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
    isEnabled: isEnvSelfHostedCloudEnabled,
    baseUrl: envSelfHostBaseUrl || apiUrl,
    apiUrl,
    authUrl,
    checkoutUrl,
    nimbusApiUrl,
    wsUrl,
  };
};

const buildPreferenceConfig = (
  preferences?: Partial<UserPreferences> | null
): SelfHostConfigState => {
  const envConfig = buildEnvConfig();

  const baseUrl = normalizeBaseUrl(preferences?.cloudServerUrl);
  const apiUrl =
    normalizeBaseUrl(preferences?.cloudServerApiUrl) ||
    baseUrl ||
    envConfig.apiUrl;
  const authUrl =
    normalizeBaseUrl(preferences?.cloudServerAuthUrl) ||
    (baseUrl ? `${baseUrl}/auth` : "") ||
    envConfig.authUrl;
  const checkoutUrl =
    normalizeBaseUrl(preferences?.cloudServerCheckoutUrl) ||
    (baseUrl ? `${baseUrl}/checkout` : "") ||
    envConfig.checkoutUrl;
  const nimbusApiUrl =
    normalizeBaseUrl(preferences?.cloudServerNimbusApiUrl) ||
    baseUrl ||
    envConfig.nimbusApiUrl;
  const wsUrl =
    normalizeBaseUrl(preferences?.cloudServerWsUrl) ||
    (baseUrl ? deriveWsUrlFromBaseUrl(baseUrl) : "") ||
    envConfig.wsUrl;

  return {
    isEnabled: true,
    baseUrl: baseUrl || apiUrl,
    apiUrl,
    authUrl,
    checkoutUrl,
    nimbusApiUrl,
    wsUrl,
  };
};

export class SelfHostConfig {
  private static config: SelfHostConfigState = buildEnvConfig();

  public static get isEnabled() {
    return this.config.isEnabled;
  }

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

  public static resolve(
    preferences?: Partial<UserPreferences> | null
  ): SelfHostConfigState {
    const isEnabled =
      preferences?.selfHostedCloudEnabled ?? isEnvSelfHostedCloudEnabled;

    if (!isEnabled) {
      return {
        ...buildEnvConfig(),
        isEnabled: false,
      };
    }

    return buildPreferenceConfig(preferences);
  }

  public static applyPreferences(preferences?: UserPreferences | null) {
    this.config = this.resolve(preferences);
    return this.getConfig();
  }
}
