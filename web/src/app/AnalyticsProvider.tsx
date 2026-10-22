"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useMe } from "@/entities/user/model/useMe";
import { getSelectedWorkspaceId, isPublicAuthPath, isSessionExpired } from "@/shared/lib/authSessionStorage";
import { capturePageview, identifyAnalytics, initializeAnalytics, resetAnalytics, setAnalyticsWorkspace, type AnalyticsConfig } from "@/shared/lib/analytics/client";

export function AnalyticsProvider({ config, children }: { config: AnalyticsConfig; children: React.ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: me } = useMe({ enabled: Boolean(config.token) && !isPublicAuthPath(pathname) });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void initializeAnalytics(config).then(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [config]);
  useEffect(() => {
    const syncWorkspace = () => setAnalyticsWorkspace(getSelectedWorkspaceId());
    const reset = () => resetAnalytics();
    syncWorkspace();
    window.addEventListener("fruition:workspace-changed", syncWorkspace);
    window.addEventListener("storage", syncWorkspace);
    window.addEventListener("fruition:auth-cleared", reset);
    return () => {
      window.removeEventListener("fruition:workspace-changed", syncWorkspace);
      window.removeEventListener("storage", syncWorkspace);
      window.removeEventListener("fruition:auth-cleared", reset);
    };
  }, []);
  useEffect(() => {
    if (ready && me && !isPublicAuthPath(pathname) && !isSessionExpired()) identifyAnalytics(me.id);
  }, [ready, me, pathname]);
  const query = params.toString();
  useEffect(() => { if (ready) capturePageview(window.location.href); }, [ready, pathname, query]);
  return children;
}
