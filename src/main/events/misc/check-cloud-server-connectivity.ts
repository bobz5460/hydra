import axios from "axios";
import { registerEvent } from "../register-event";
import { SelfHostConfig } from "@main/self-host-config";

interface CloudServerConnectivityCheck {
  key: "api" | "auth" | "checkout";
  ok: boolean;
  url: string;
  detail: string;
}

interface CloudServerConnectivityResult {
  ok: boolean;
  baseUrl: string;
  checks: CloudServerConnectivityCheck[];
}

const createFailedCheck = (
  key: CloudServerConnectivityCheck["key"],
  url: string,
  detail: string
): CloudServerConnectivityCheck => ({
  key,
  ok: false,
  url,
  detail,
});

const requestCheck = async (
  key: CloudServerConnectivityCheck["key"],
  url: string
): Promise<CloudServerConnectivityCheck> => {
  if (!url) {
    return createFailedCheck(key, url, "Not configured");
  }

  try {
    const response = await axios.get(url, {
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    return {
      key,
      ok: true,
      url,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    const detail =
      error instanceof Error && error.message
        ? error.message
        : "Request failed";

    return createFailedCheck(key, url, detail);
  }
};

const requestApiCheck = async (apiUrl: string) => {
  const healthUrl = apiUrl ? `${apiUrl}/health` : "";
  const healthCheck = await requestCheck("api", healthUrl);

  if (healthCheck.ok || !apiUrl) {
    return healthCheck;
  }

  const rootCheck = await requestCheck("api", apiUrl);
  if (rootCheck.ok) {
    return {
      ...rootCheck,
      detail: `${rootCheck.detail} (root endpoint)`,
    };
  }

  return healthCheck;
};

const checkCloudServerConnectivity = async (
  _event: Electron.IpcMainInvokeEvent,
  baseUrl?: string | null
): Promise<CloudServerConnectivityResult> => {
  const config = SelfHostConfig.resolve(baseUrl);
  const checks = await Promise.all([
    requestApiCheck(config.apiUrl),
    requestCheck("auth", config.authUrl),
    requestCheck("checkout", config.checkoutUrl),
  ]);

  return {
    ok: checks.every((check) => check.ok),
    baseUrl: config.baseUrl,
    checks,
  };
};

registerEvent("checkCloudServerConnectivity", checkCloudServerConnectivity);
