import {
  Avatar,
  Button,
  CheckboxField,
  SelectField,
  TextField,
} from "@renderer/components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  useAppSelector,
  useDate,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useCallback, useContext, useEffect, useState } from "react";
import {
  CloudIcon,
  KeyIcon,
  MailIcon,
  XCircleFillIcon,
} from "@primer/octicons-react";
import { settingsContext } from "@renderer/context";
import { AuthPage } from "@shared";
import type { UserPreferences } from "@types";
import "./settings-account.scss";

interface FormValues {
  profileVisibility: "PUBLIC" | "FRIENDS" | "PRIVATE";
}

interface CloudServerFormValues {
  enabled: boolean;
  baseUrl: string;
  apiUrl: string;
  authUrl: string;
  checkoutUrl: string;
  nimbusApiUrl: string;
  wsUrl: string;
}

const isSelfHostedCloudEnabledByDefault = (() => {
  const value = import.meta.env.RENDERER_VITE_SELF_HOST_CLOUD?.toLowerCase();
  return value === "true" || value === "1" || value === "yes" || value === "on";
})();

const emptyCloudServerFormValues: CloudServerFormValues = {
  enabled: false,
  baseUrl: "",
  apiUrl: "",
  authUrl: "",
  checkoutUrl: "",
  nimbusApiUrl: "",
  wsUrl: "",
};

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

const normalizeCloudServerFormValues = (
  value: CloudServerFormValues
): CloudServerFormValues => ({
  enabled: value.enabled,
  baseUrl: normalizeCloudServerUrl(value.baseUrl),
  apiUrl: normalizeCloudServerUrl(value.apiUrl),
  authUrl: normalizeCloudServerUrl(value.authUrl),
  checkoutUrl: normalizeCloudServerUrl(value.checkoutUrl),
  nimbusApiUrl: normalizeCloudServerUrl(value.nimbusApiUrl),
  wsUrl: normalizeCloudServerUrl(value.wsUrl),
});

const hasCloudServerConfiguration = (value: CloudServerFormValues) => {
  return [
    value.baseUrl,
    value.apiUrl,
    value.authUrl,
    value.checkoutUrl,
    value.nimbusApiUrl,
    value.wsUrl,
  ].some(Boolean);
};

const toCloudServerPreferences = (
  value: CloudServerFormValues
): Partial<UserPreferences> => ({
  selfHostedCloudEnabled: value.enabled,
  cloudServerUrl: value.baseUrl || null,
  cloudServerApiUrl: value.apiUrl || null,
  cloudServerAuthUrl: value.authUrl || null,
  cloudServerCheckoutUrl: value.checkoutUrl || null,
  cloudServerNimbusApiUrl: value.nimbusApiUrl || null,
  cloudServerWsUrl: value.wsUrl || null,
});

export function SettingsAccount() {
  const { t } = useTranslation("settings");

  const [isUnblocking, setIsUnblocking] = useState(false);
  const [cloudServerForm, setCloudServerForm] = useState<CloudServerFormValues>(
    emptyCloudServerFormValues
  );
  const [savedCloudServerForm, setSavedCloudServerForm] =
    useState<CloudServerFormValues>(emptyCloudServerFormValues);
  const [connectionStatus, setConnectionStatus] =
    useState<CloudServerConnectivityResult | null>(null);
  const [isCheckingCloudServer, setIsCheckingCloudServer] = useState(false);
  const [isSavingCloudServer, setIsSavingCloudServer] = useState(false);

  const { showErrorToast, showSuccessToast } = useToast();

  const { blockedUsers, fetchBlockedUsers, updateUserPreferences } =
    useContext(settingsContext);

  const { formatDate } = useDate();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

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
    async (value: CloudServerFormValues) => {
      setIsCheckingCloudServer(true);

      try {
        const normalizedValue = normalizeCloudServerFormValues({
          ...value,
          enabled: true,
        });
        const result = await window.electron.checkCloudServerConnectivity(
          toCloudServerPreferences(normalizedValue)
        );
        setConnectionStatus(result);
        return result;
      } finally {
        setIsCheckingCloudServer(false);
      }
    },
    []
  );

  useEffect(() => {
    let isSubscribed = true;

    window.electron.getCloudServerConfig().then((config) => {
      if (!isSubscribed) return;

      const nextCloudServerForm = normalizeCloudServerFormValues({
        enabled:
          userPreferences?.selfHostedCloudEnabled ??
          config.isEnabled ??
          isSelfHostedCloudEnabledByDefault,
        baseUrl:
          userPreferences?.cloudServerUrl ??
          (config.isEnabled ? config.baseUrl : ""),
        apiUrl: userPreferences?.cloudServerApiUrl ?? "",
        authUrl: userPreferences?.cloudServerAuthUrl ?? "",
        checkoutUrl: userPreferences?.cloudServerCheckoutUrl ?? "",
        nimbusApiUrl: userPreferences?.cloudServerNimbusApiUrl ?? "",
        wsUrl: userPreferences?.cloudServerWsUrl ?? "",
      });

      setCloudServerForm(nextCloudServerForm);
      setSavedCloudServerForm(nextCloudServerForm);

      if (
        nextCloudServerForm.enabled &&
        hasCloudServerConfiguration(nextCloudServerForm)
      ) {
        runCloudServerConnectivityCheck(nextCloudServerForm);
      } else {
        setConnectionStatus(null);
      }
    });

    return () => {
      isSubscribed = false;
    };
  }, [runCloudServerConnectivityCheck, userPreferences]);

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
    const normalizedCloudServerForm =
      normalizeCloudServerFormValues(cloudServerForm);
    const cloudServerEntries = [
      {
        label: t("cloud_server_url", {
          defaultValue: "Cloud server URL",
        }),
        value: normalizedCloudServerForm.baseUrl,
      },
      {
        label: t("cloud_server_api_url", {
          defaultValue: "API URL",
        }),
        value: normalizedCloudServerForm.apiUrl,
      },
      {
        label: t("cloud_server_auth_url", {
          defaultValue: "Auth URL",
        }),
        value: normalizedCloudServerForm.authUrl,
      },
      {
        label: t("cloud_server_checkout_url", {
          defaultValue: "Checkout URL",
        }),
        value: normalizedCloudServerForm.checkoutUrl,
      },
      {
        label: t("cloud_server_nimbus_api_url", {
          defaultValue: "Nimbus API URL",
        }),
        value: normalizedCloudServerForm.nimbusApiUrl,
      },
      {
        label: t("cloud_server_ws_url", {
          defaultValue: "WebSocket URL",
        }),
        value: normalizedCloudServerForm.wsUrl,
      },
    ];

    const invalidCloudServerEntry = cloudServerEntries.find(
      (entry) => entry.value && !isValidCloudServerUrl(entry.value)
    );

    if (invalidCloudServerEntry) {
      showErrorToast(
        t("must_be_valid_url"),
        t("cloud_server_url_validation_field", {
          defaultValue: "{{field}} must be a valid URL.",
          field: invalidCloudServerEntry.label,
        })
      );
      return;
    }

    if (
      normalizedCloudServerForm.enabled &&
      !hasCloudServerConfiguration(normalizedCloudServerForm)
    ) {
      showErrorToast(
        t("must_be_valid_url"),
        t("cloud_server_url_required", {
          defaultValue:
            "Enable self-hosted mode only after configuring a base URL or one of the advanced server URLs.",
        })
      );
      return;
    }

    setIsSavingCloudServer(true);

    try {
      await updateUserPreferences(
        toCloudServerPreferences(normalizedCloudServerForm)
      );
      setCloudServerForm(normalizedCloudServerForm);
      setSavedCloudServerForm(normalizedCloudServerForm);

      if (
        normalizedCloudServerForm.enabled &&
        hasCloudServerConfiguration(normalizedCloudServerForm)
      ) {
        const result = await runCloudServerConnectivityCheck(
          normalizedCloudServerForm
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
      } else {
        setConnectionStatus(null);
        showSuccessToast(
          t("cloud_server_saved", {
            defaultValue: "Cloud settings saved",
          }),
          t("cloud_server_saved_description", {
            defaultValue: "Hydra is now using its bundled cloud configuration.",
          })
        );
      }
    } finally {
      setIsSavingCloudServer(false);
    }
  }, [
    cloudServerForm,
    runCloudServerConnectivityCheck,
    showErrorToast,
    showSuccessToast,
    t,
    updateUserPreferences,
  ]);

  const handleTestCloudServer = useCallback(async () => {
    const normalizedCloudServerForm =
      normalizeCloudServerFormValues(cloudServerForm);
    const invalidCloudServerUrl = [
      normalizedCloudServerForm.baseUrl,
      normalizedCloudServerForm.apiUrl,
      normalizedCloudServerForm.authUrl,
      normalizedCloudServerForm.checkoutUrl,
      normalizedCloudServerForm.nimbusApiUrl,
      normalizedCloudServerForm.wsUrl,
    ].find((value) => value && !isValidCloudServerUrl(value));

    if (invalidCloudServerUrl) {
      showErrorToast(
        t("must_be_valid_url"),
        t("cloud_server_url_validation", {
          defaultValue: "Enter valid cloud server URLs before testing.",
        })
      );
      return;
    }

    if (!hasCloudServerConfiguration(normalizedCloudServerForm)) {
      showErrorToast(
        t("must_be_valid_url"),
        t("cloud_server_url_required_test", {
          defaultValue:
            "Enter a base URL or one of the advanced server URLs before testing.",
        })
      );
      return;
    }

    const result = await runCloudServerConnectivityCheck(
      normalizedCloudServerForm
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
    cloudServerForm,
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

        <div className="settings-account__cloud-server">
          <CheckboxField
            label={t("self_hosted_mode", {
              defaultValue: "Use a self-hosted Hydra Cloud server",
            })}
            checked={cloudServerForm.enabled}
            onChange={() =>
              setCloudServerForm((prev) => ({
                ...prev,
                enabled: !prev.enabled,
              }))
            }
          />

          <small>
            {cloudServerForm.enabled
              ? t("self_hosted_mode_enabled_description", {
                  defaultValue:
                    "Hydra will use the configured self-hosted server after you save these settings.",
                })
              : t("self_hosted_mode_disabled_description", {
                  defaultValue:
                    "Hydra will use its bundled cloud configuration until self-hosted mode is enabled.",
                })}
          </small>

          <div className="settings-account__cloud-server-fields">
            <TextField
              label={t("cloud_server_url", {
                defaultValue: "Cloud server URL",
              })}
              value={cloudServerForm.baseUrl}
              onChange={(event) =>
                setCloudServerForm((prev) => ({
                  ...prev,
                  baseUrl: event.target.value,
                }))
              }
              placeholder="http://localhost:4000"
              hint={t("cloud_server_url_hint", {
                defaultValue:
                  "Base URL used to derive the API, auth, checkout, nimbus, and WebSocket endpoints unless you override them below.",
              })}
            />

            <TextField
              label={t("cloud_server_api_url", {
                defaultValue: "API URL",
              })}
              value={cloudServerForm.apiUrl}
              onChange={(event) =>
                setCloudServerForm((prev) => ({
                  ...prev,
                  apiUrl: event.target.value,
                }))
              }
              placeholder="http://localhost:4000"
              hint={t("cloud_server_api_url_hint", {
                defaultValue: "Optional override for the main API endpoint.",
              })}
            />

            <TextField
              label={t("cloud_server_auth_url", {
                defaultValue: "Auth URL",
              })}
              value={cloudServerForm.authUrl}
              onChange={(event) =>
                setCloudServerForm((prev) => ({
                  ...prev,
                  authUrl: event.target.value,
                }))
              }
              placeholder="http://localhost:4000/auth"
              hint={t("cloud_server_auth_url_hint", {
                defaultValue:
                  "Optional override for the authentication server.",
              })}
            />

            <TextField
              label={t("cloud_server_checkout_url", {
                defaultValue: "Checkout URL",
              })}
              value={cloudServerForm.checkoutUrl}
              onChange={(event) =>
                setCloudServerForm((prev) => ({
                  ...prev,
                  checkoutUrl: event.target.value,
                }))
              }
              placeholder="http://localhost:4000/checkout"
              hint={t("cloud_server_checkout_url_hint", {
                defaultValue:
                  "Optional override for the checkout or billing server.",
              })}
            />

            <TextField
              label={t("cloud_server_nimbus_api_url", {
                defaultValue: "Nimbus API URL",
              })}
              value={cloudServerForm.nimbusApiUrl}
              onChange={(event) =>
                setCloudServerForm((prev) => ({
                  ...prev,
                  nimbusApiUrl: event.target.value,
                }))
              }
              placeholder="http://localhost:4000"
              hint={t("cloud_server_nimbus_api_url_hint", {
                defaultValue:
                  "Optional override for nimbus and hoster-related requests.",
              })}
            />

            <TextField
              label={t("cloud_server_ws_url", {
                defaultValue: "WebSocket URL",
              })}
              value={cloudServerForm.wsUrl}
              onChange={(event) =>
                setCloudServerForm((prev) => ({
                  ...prev,
                  wsUrl: event.target.value,
                }))
              }
              placeholder="ws://localhost:4001"
              hint={t("cloud_server_ws_url_hint", {
                defaultValue:
                  "Optional override for the WebSocket server and port.",
              })}
            />
          </div>

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
                : t("check_connection", {
                    defaultValue: "Check connection",
                  })}
            </Button>

            <Button
              theme="outline"
              disabled={
                isCheckingCloudServer ||
                isSavingCloudServer ||
                JSON.stringify(
                  normalizeCloudServerFormValues(cloudServerForm)
                ) === JSON.stringify(savedCloudServerForm)
              }
              onClick={handleApplyCloudServer}
            >
              {isSavingCloudServer
                ? t("saving", { defaultValue: "Saving..." })
                : t("save_changes", { defaultValue: "Save changes" })}
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
