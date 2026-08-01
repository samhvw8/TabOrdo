// Per-tab audio.

export async function muteTab(tabId: number, muted: boolean): Promise<void> {
  await chrome.tabs.update(tabId, { muted });
}

// Returns false when the script could not be injected — TabOrdo declares no host
// permissions, so only the tab the user just acted on (activeTab) is reachable.
// Callers must report that instead of leaving the user with a silent no-op.
export async function setTabVolume(tabId: number, volume: number): Promise<boolean> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (vol: number) => {
        const elements = document.querySelectorAll("audio, video");
        if (elements.length === 0) {
          console.warn("[TabOrdo] No audio/video elements found on this page");
          return;
        }
        elements.forEach((el) => {
          (el as HTMLMediaElement).volume = vol;
        });
        console.log(`[TabOrdo] Set volume to ${Math.round(vol * 100)}% on ${elements.length} element(s)`);
      },
      args: [Math.max(0, Math.min(1, volume))],
    });
    return true;
  } catch (e) {
    console.error("[TabOrdo] Failed to set volume for tab", tabId, e);
    return false;
  }
}
