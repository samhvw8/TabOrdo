export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener(() => {
    console.log("TabOrdo installed");
  });
});
