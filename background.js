// The user's Chrome version throws a fatal error for openPanelOnActionIconClick.
// We remove setPanelBehavior and only rely on the action click listener to open the panel.

let isSidePanelOpen = false;
let sidePanelPort = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'sidepanel') {
    isSidePanelOpen = true;
    sidePanelPort = port;
    port.onDisconnect.addListener(() => {
      isSidePanelOpen = false;
      sidePanelPort = null;
    });
  }
});

function toggleSidebar(tab) {
  if (isSidePanelOpen) {
    if (sidePanelPort) {
      sidePanelPort.postMessage({ action: 'close' });
    }
  } else {
    // Need to call open() synchronously to preserve the user gesture
    if (chrome.sidePanel && chrome.sidePanel.open) {
      if (tab && tab.windowId) {
        chrome.sidePanel.open({ windowId: tab.windowId });
      } else {
        // Fallback: this callback may lose user gesture, but tab should be present in most cases
        chrome.windows.getCurrent((win) => {
          chrome.sidePanel.open({ windowId: win.id });
        });
      }
    }
  }
}

chrome.action.onClicked.addListener((tab) => {
  toggleSidebar(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle_sidebar') {
    toggleSidebar(tab);
  }
});
