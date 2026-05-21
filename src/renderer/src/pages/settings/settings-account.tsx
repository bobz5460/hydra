import { Avatar, Button, SelectField, TextField } from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useDate, useToast, useUserDetails } from "@renderer/hooks";
import { useCallback, useContext, useEffect, useState } from "react";
import {
  CloudIcon,
  KeyIcon,
  MailIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";
import { AuthPage } from "@shared";
import "./settings-account.scss";

interface FormValues {
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
}

const isSelfHostedCloudEnabled = (() => {
  const value = import.meta.env.RENDERER_VITE_SELF_HOST_CLOUD?.toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
})();

const normalizeCloudServerUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const isValidCloudServerUrl = (value: string) => {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
};

export function SettingsAccount() {
  const { t } = useTranslation("settings");

  const [isUnblocking, setIsUnblocking] = useState(false);
  const [cloudServerUrl, setCloudServerUrl] = useState("");
  const [savedCloudServerUrl, setSavedCloudServerUrl] = useState("");
  const [connectionStatus, setConnectionStatus] =
    useState<CloudServerConnectivityResult | null>(null);
  const [isCheckingCloudServer, setIsCheckingCloudServer] = useState(false);
  const [isSavingCloudServer, setIsSavingCloudServer] = useState(false);

  const { showErrorToast, showSuccessToast } = useToast();

  const { blockedUsers, fetchBlockedUsers } = useContext(settingsContext);

  const { formatDate } = useDate();

  const {
    control,
    formState: { isSubmitting },
    setValue,
    handleSubmit,
  } = useForm<FormValues>();

  const {
    userDetails,
    hasActiveSubscription,
    patchUser,
    fetchUserDetails,
    updateUserDetails,
    unblockUser,
  } = useUserDetails();

  useEffect(() => {
    if (userDetails?.profileVisibility) {
      setValue("profileVisibility", userDetails.profileVisibility);
    }
  }, [userDetails, setValue]);

  useEffect(() => {
    const unsubscribe = window.electron.onAccountUpdated(() => {
      fetchUserDetails().then((response) => {
        if (response) {
          updateUserDetails(response);
        }
      });
      showSuccessToast(t("account_data_updated_successfully"));
    });

    return () => {
      unsubscribe();
    };
  }, [fetchUserDetails, updateUserDetails, t, showSuccessToast]);

  const runCloudServerConnectivityCheck = useCallback(
    async (baseUrl?: string | null) => {
      setIsCheckingCloudServer(true);

      try {
        const result =
          await window.electron.checkCloudServerConnectivity(baseUrl);
        setConnectionStatus(result);
        return result;
      } finally {
        setIsCheckingCloudServer(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!isSelfHostedCloudEnabled) return;

    window.electron.getCloudServerConfig().then((config) => {
      setCloudServerUrl(config.baseUrl);
      setSavedCloudServerUrl(config.baseUrl);
      runCloudServerConnectivityCheck(config.baseUrl);
    });
  }, [runCloudServerConnectivityCheck]);

  const visibilityOptions = [
    { value: "PUBLIC", label: t("public") },
    { value: "FRIENDS", label: t("friends_only") },
    { value: "PRIVATE", label: t("private") },
  ];

  const onSubmit = async (values: FormValues) => {
    await patchUser(values);
    showSuccessToast(t("changes_saved"));
  };

  const handleUnblockClick = useCallback(
    (id: string) => {
      setIsUnblocking(true);

      unblockUser(id)
        .then(() => {
          fetchBlockedUsers();
          showSuccessToast(t("user_unblocked"));
        })
        .finally(() => {
          setIsUnblocking(false);
        });
    },
    [unblockUser, fetchBlockedUsers, t, showSuccessToast]
  );

  const handleApplyCloudServer = useCallback(async () => {
    const normalizedCloudServerUrl = normalizeCloudServerUrl(cloudServerUrl);

    if (
      normalizedCloudServerUrl &&
      !isValidCloudServerUrl(normalizedCloudServerUrl)
    ) {
      showErrorToast(
        t("must_be_valid_url"),
        t("cloud_server_url_validation", {
          defaultValue: "Enter a valid cloud server URL before saving.",
        })
      );
      return;
    }

    setIsSavingCloudServer(true);

    try {
      await window.electron.updateUserPreferences({
        cloudServerUrl: normalizedCloudServerUrl || null,
      });
      setSavedCloudServerUrl(normalizedCloudServerUrl);

      const result = await runCloudServerConnectivityCheck(
        normalizedCloudServerUrl || null
      );

      if (result.ok) {
        showSuccessToast(
          t("cloud_server_saved", {
            defaultValue: "Cloud server updated",
          }),
          t("cloud_server_saved_description", {
            defaultValue:
              "Hydra is now using the selected cloud server. Sign in again if needed.",
          })
        );
      } else {
        showErrorToast(
          t("cloud_server_saved_with_issues", {
            defaultValue: "Cloud server saved with connectivity issues",
          }),
          t("cloud_server_saved_with_issues_description", {
            defaultValue:
              "Hydra saved the selected cloud server, but one or more connectivity checks failed.",
          })
        );
      }
    } finally {
      setIsSavingCloudServer(false);
    }
  }, [
    cloudServerUrl,
    runCloudServerConnectivityCheck,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const handleTestCloudServer = useCallback(async () => {
    const normalizedCloudServerUrl = normalizeCloudServerUrl(cloudServerUrl);

    if (
      normalizedCloudServerUrl &&
      !isValidCloudServerUrl(normalizedCloudServerUrl)
    ) {
      showErrorToast(
        t("must_be_valid_url"),
        t("cloud_server_url_validation", {
          defaultValue: "Enter a valid cloud server URL before testing.",
        })
      );
      return;
    }

    const result = await runCloudServerConnectivityCheck(
      normalizedCloudServerUrl || null
    );

    if (result.ok) {
      showSuccessToast(
        t("cloud_server_connection_success", {
          defaultValue: "Cloud server is reachable",
        })
      );
      return;
    }

    showErrorToast(
      t("cloud_server_connection_failed", {
        defaultValue: "Cloud server check failed",
      })
    );
  }, [
    cloudServerUrl,
    runCloudServerConnectivityCheck,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const getHydraCloudSectionContent = () => {
    const hasSubscribedBefore = Boolean(userDetails?.subscription?.expiresAt);
    const isRenewalActive = userDetails?.subscription?.status === "active";

    if (!hasSubscribedBefore) {
      return {
        description: <small>{t("no_subscription")}</small>,
        callToAction: t("become_subscriber"),
      };
    }

    if (hasActiveSubscription) {
      return {
        description: isRenewalActive ? (
          <>
            <small>
              {t("subscription_renews_on", {
                date: formatDate(userDetails.subscription!.expiresAt!),
              })}
            </small>
            <small>{t("bill_sent_until")}</small>
          </>
        ) : (
          <>
            <small>{t("subscription_renew_cancelled")}</small>
            <small>
              {t("subscription_active_until", {
                date: formatDate(userDetails!.subscription!.expiresAt!),
              })}
            </small>
          </>
        ),
        callToAction: t("manage_subscription"),
      };
    }

    return {
      description: (
        <small>
          {t("subscription_expired_at", {
            date: formatDate(userDetails!.subscription!.expiresAt!),
          })}
        </small>
      ),
      callToAction: t("renew_subscription"),
    };
  };

  if (!userDetails) return null;

  return (
    <form className="settings-account__form" onSubmit={handleSubmit(onSubmit)}>
      <Controller
        control={control}
        name="profileVisibility"
        render={({ field }) => {
          const handleChange = (
            event: React.ChangeEvent<HTMLSelectElement>
          ) => {
            field.onChange(event);
            handleSubmit(onSubmit)();
          };

          return (
            <section className="settings-account__section">
              <SelectField
                label={t("profile_visibility")}
                value={field.value}
                onChange={handleChange}
                options={visibilityOptions.map((visiblity) => ({
                  key: visiblity.value,
                  value: visiblity.value,
                  label: visiblity.label,
                }))}
                disabled={isSubmitting}
              />

              <small>{t("profile_visibility_description")}</small>
            </section>
          );
        }}
      />

      <section className="settings-account__section">
        <h4>{t("current_username")}</h4>
        <p>{userDetails?.username}</p>

        <h4>{t("current_email")}</h4>
        <p>{userDetails?.email ?? t("no_email_account")}</p>

        <div className="settings-account__actions">
          <Button
            theme="outline"
            onClick={() => window.electron.openAuthWindow(AuthPage.UpdateEmail)}
          >
            <MailIcon />
            {t("update_email")}
          </Button>

          <Button
            theme="outline"
            onClick={() =>
              window.electron.openAuthWindow(AuthPage.UpdatePassword)
            }
          >
            <KeyIcon />
            {t("update_password")}
          </Button>
        </div>
      </section>

      <section className="settings-account__section">
        <h3>{t("hydra_cloud")}</h3>
        <div className="settings-account__subscription-info">
          {getHydraCloudSectionContent().description}
        </div>

        {isSelfHostedCloudEnabled && (
          <div className="settings-account__cloud-server">
            <TextField
              label={t("cloud_server_url", {
                defaultValue: "Cloud server URL",
              })}
              value={cloudServerUrl}
              onChange={(event) => setCloudServerUrl(event.target.value)}
              placeholder="http://localhost:4000"
              hint={t("cloud_server_url_hint", {
                defaultValue:
                  "Choose which self-hosted cloud server Hydra should use.",
              })}
            />

            <div className="settings-account__cloud-server-actions">
              <Button
                theme="outline"
                disabled={isCheckingCloudServer || isSavingCloudServer}
                onClick={handleTestCloudServer}
              >
                {isCheckingCloudServer
                  ? t("checking_connection", {
                      defaultValue: "Checking...",
                    })
                  : t("validate_download_source")}
              </Button>

              <Button
                theme="outline"
                disabled={
                  isCheckingCloudServer ||
                  isSavingCloudServer ||
                  normalizeCloudServerUrl(cloudServerUrl) ===
                    savedCloudServerUrl
                }
                onClick={handleApplyCloudServer}
              >
                {isSavingCloudServer
                  ? t("saving", { defaultValue: "Saving..." })
                  : t("change")}
              </Button>
            </div>

            {connectionStatus && (
              <div className="settings-account__cloud-server-status">
                <small
                  className={
                    connectionStatus.ok
                      ? "settings-account__cloud-server-status-text settings-account__cloud-server-status-text--success"
                      : "settings-account__cloud-server-status-text settings-account__cloud-server-status-text--error"
                  }
                >
                  {connectionStatus.ok
                    ? t("cloud_server_status_ok", {
                        defaultValue: "Cloud server reachable",
                      })
                    : t("cloud_server_status_error", {
                        defaultValue: "Some cloud server checks failed",
                      })}
                </small>

                <ul className="settings-account__cloud-server-checks">
                  {connectionStatus.checks.map((check) => (
                    <li key={check.key}>
                      <span>{`${check.key.toUpperCase()}: `}</span>
                      <span>
                        {check.ok
                          ? t("connected", { defaultValue: "Connected" })
                          : t("connection_failed", {
                              defaultValue: "Failed",
                            })}
                        {check.detail ? ` (${check.detail})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <Button
          className="settings-account__subscription-button"
          theme="outline"
          onClick={() => window.electron.openCheckout()}
        >
          <CloudIcon />
          {getHydraCloudSectionContent().callToAction}
        </Button>
      </section>

      <section className="settings-account__section">
        <h3>{t("blocked_users")}</h3>

        {blockedUsers.length > 0 ? (
          <ul className="settings-account__blocked-users">
            {blockedUsers.map((user) => {
              return (
                <li key={user.id} className="settings-account__blocked-user">
                  <div className="settings-account__user-info">
                    <Avatar
                      className="settings-account__user-avatar"
                      size={32}
                      src={user.profileImageUrl}
                      alt={user.displayName}
                    />
                    <span>{user.displayName}</span>
                  </div>

                  <button
                    type="button"
                    className="settings-account__unblock-button"
                    onClick={() => handleUnblockClick(user.id)}
                    disabled={isUnblocking}
                  >
                    <XCircleFillIcon />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <small>{t("no_users_blocked")}</small>
        )}
      </section>
    </form>
  );
}
