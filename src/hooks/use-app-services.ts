import { createContext, useContext } from "react";

import type { AppServices } from "../services/app-services.js";

export const AppServicesContext = createContext<AppServices | null>(null);

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (services === null) {
    throw new Error("useAppServices must be used within AppProviders");
  }
  return services;
}
