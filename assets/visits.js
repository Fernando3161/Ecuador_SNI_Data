const footer = document.getElementById("visit-count");
const site = footer?.dataset.goatcounterSite ?? "";
const dashboardPath = "/Ecuador_SNI_Data/";
const onDashboard = location.origin === "https://fernando3161.github.io" &&
  (location.pathname === dashboardPath || location.pathname === `${dashboardPath}index.html`);
const mayTrack = navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl && !navigator.webdriver;

if (onDashboard && /^[a-z0-9-]+$/.test(site) && mayTrack) {
  const host = `https://${site}.goatcounter.com`;
  const path = encodeURIComponent(dashboardPath);
  const request = { credentials: "omit", referrerPolicy: "no-referrer" };

  // All dashboard tabs share one path for counting a visit.
  fetch(`${host}/count?p=${path}`, {
    ...request, mode: "no-cors", cache: "no-store", keepalive: true,
  }).catch(() => {});

  fetch(`${host}/counter/${path}.json`, request)
    .then(response => response.ok ? response.json() : null)
    .then(data => {
      const digits = String(data?.count ?? "").replace(/[,\s.]/g, "");
      if (!/^\d+$/.test(digits)) return;
      const total = Number(digits);
      if (!Number.isSafeInteger(total)) return;
      footer.textContent = `${total.toLocaleString("en-US")} ${total === 1 ? "visit" : "visits"}`;
      footer.hidden = false;
    })
    .catch(() => {});
}
