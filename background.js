// The user's Chrome version throws a fatal error for openPanelOnActionIconClick.
// We remove setPanelBehavior and only rely on the action click listener to open the panel.
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

