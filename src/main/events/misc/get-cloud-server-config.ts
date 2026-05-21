import { registerEvent } from "../register-event";
import { SelfHostConfig } from "@main/self-host-config";

const getCloudServerConfig = async () => {
  return SelfHostConfig.getConfig();
};

registerEvent("getCloudServerConfig", getCloudServerConfig);
