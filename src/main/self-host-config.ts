const normalizeBaseUrl = (value?: string) => {
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
      parsed.port === "4000"
        ? "4001"
        : parsed.port || (protocol === "wss:" ? "443" : "80");
    const wsPort = explicitWsPort || fallbackPort;
    const hostWithPort = wsPort ? `${parsed.hostname}:${wsPort}` : parsed.hostname;
    return `${protocol}//${hostWithPort}`;
  } catch {
    return "";
  }
};

const selfHostBaseUrl = normalizeBaseUrl(
  import.meta.env.MAIN_VITE_SELF_HOST_BASE_URL
);

const apiUrl =
  normalizeBaseUrl(import.meta.env.MAIN_VITE_API_URL) || selfHostBaseUrl;

const authUrl =
  normalizeBaseUrl(import.meta.env.MAIN_VITE_AUTH_URL) ||
  (selfHostBaseUrl ? `${selfHostBaseUrl}/auth` : "");

const checkoutUrl =
  normalizeBaseUrl(import.meta.env.MAIN_VITE_CHECKOUT_URL) ||
  (selfHostBaseUrl ? `${selfHostBaseUrl}/checkout` : "");

const nimbusApiUrl =
  normalizeBaseUrl(import.meta.env.MAIN_VITE_NIMBUS_API_URL) || selfHostBaseUrl;

const wsUrl =
  normalizeBaseUrl(import.meta.env.MAIN_VITE_WS_URL) ||
  normalizeBaseUrl(import.meta.env.MAIN_VITE_SELF_HOST_WS_URL) ||
  (selfHostBaseUrl ? deriveWsUrlFromBaseUrl(selfHostBaseUrl) : "");

export const SelfHostConfig = {
  apiUrl,
  authUrl,
  checkoutUrl,
  nimbusApiUrl,
  wsUrl,
};
