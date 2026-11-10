const footer = document.getElementById("visit-count");
const site = footer?.dataset.goatcounterSite ?? "";
const dashboardPath = "/Ecuador_SNI_Data/";
const onDashboard = location.origin === "https://fernando3161.github.io" &&
  (location.pathname === dashboardPath || location.pathname === `${dashboardPath}index.html`);
const mayTrack = navigator.doNotTrack !== "1" && !navigator.globalPrivacyControl && !navigator.webdriver;

if (onDashboard && /^[a-z0-9-]+$/.test(site) && mayTrack) {
  const path = encodeURIComponent(dashboardPath);
  // All dashboard tabs share one path for counting a visit.
  fetch(`https://${site}.goatcounter.com/count?p=${path}`, {
    credentials: "omit", referrerPolicy: "no-referrer", mode: "no-cors", cache: "no-store", keepalive: true,
  }).catch(() => {});
}
