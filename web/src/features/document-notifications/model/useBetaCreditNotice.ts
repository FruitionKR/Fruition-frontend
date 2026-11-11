"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { fetchBetaCredit, useMe } from "@/entities/user";
import { publishNotice } from "./noticeBus";

export function useBetaCreditNotice() {
  const { data: me } = useMe();
  const t = useTranslations("wiki.betaCredit");
  const seen = useRef(new Set<string>());
  const { data } = useQuery({
    queryKey: ["betaCredit", me?.id],
    queryFn: fetchBetaCredit,
    enabled: Boolean(me?.id),
    refetchInterval: (query) => !query.state.data || query.state.data.status === "pending" ? 5000 : false
  });
  useEffect(() => {
    if (!me || !data || data.status === "ineligible") return;
    const key = `beta-credit:${me.id}:${data.status}`;
    if (seen.current.has(key)) return;
    try { if (sessionStorage.getItem(key)) return; } catch { /* 저장소 차단 시 메모리로 중복을 막는다. */ }
    seen.current.add(key);
    publishNotice({
      notificationKey: "other",
      kind: "info",
      title: t(`${data.status}.title`),
      message: data.status === "granted" && data.amount_krw_milli !== null
        ? t("granted.amountMessage", { amount: data.amount_krw_milli / 1000 })
        : t(`${data.status}.message`)
    });
    try { sessionStorage.setItem(key, "1"); } catch { /* 알림은 저장소 없이도 표시한다. */ }
  }, [data, me, t]);
}
