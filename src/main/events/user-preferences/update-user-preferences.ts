import { registerEvent } from "../register-event";

import type { UserPreferences } from "@types";
import i18next from "i18next";
import { db, levelKeys } from "@main/level";
import { patchUserProfile } from "../profile/update-profile";
import { DownloadManager, HydraApi, WSClient } from "@main/services";
import { SelfHostConfig } from "@main/self-host-config";

const updateUserPreferences = async (
  _event: Electron.IpcMainInvokeEvent,
  preferences: Partial<UserPreferences>
) => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (preferences.language) {
    await db.put<string, string>(levelKeys.language, preferences.language, {
      valueEncoding: "utf8",
    });

    i18next.changeLanguage(preferences.language);
    patchUserProfile({ language: preferences.language }).catch(() => {});
  }

  const nextUserPreferences = {
    ...userPreferences,
    ...preferences,
  };

  await db.put<string, UserPreferences>(
    levelKeys.userPreferences,
    nextUserPreferences,
    {
      valueEncoding: "json",
    }
  );

  if (Object.hasOwn(preferences, "maxDownloadSpeedBytesPerSecond")) {
    await DownloadManager.applyDownloadSpeedLimit(
      preferences.maxDownloadSpeedBytesPerSecond ?? null
    );
  }

  if (Object.hasOwn(preferences, "cloudServerUrl")) {
    SelfHostConfig.applyPreferences(nextUserPreferences);
    HydraApi.reconfigure();
    WSClient.close();
    HydraApi.resetSession();
  }
};

registerEvent("updateUserPreferences", updateUserPreferences);
