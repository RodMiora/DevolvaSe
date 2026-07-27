"use client";

import React, { createContext, useContext } from "react";

export type TabId = "chat" | "aulas" | "enviar";

type TabNavigationContextValue = {
  navigateToTab: (tab: TabId) => void;
};

const TabNavigationContext = createContext<TabNavigationContextValue | null>(null);

export const TabNavigationProvider = TabNavigationContext.Provider;

export function useTabNavigation(): TabNavigationContextValue {
  const ctx = useContext(TabNavigationContext);
  if (!ctx) {
    return {
      navigateToTab: () => {
        console.warn("useTabNavigation: navegacao nao disponivel (fora do Provider)");
      },
    };
  }
  return ctx;
}

export default TabNavigationContext;
