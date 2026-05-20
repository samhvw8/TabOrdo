export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
      chrome.storage.local.set({ installedAt: Date.now() });
    }
  });

  chrome.commands.onCommand.addListener((command) => {
    if (command === "open-dashboard") {
      chrome.tabs.create({ url: chrome.runtime.getURL("/popup.html") });
    }
  });
});
