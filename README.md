# Arclike Bookmarks

[中文](README_zh.md)

Arclike Bookmarks is a sidebar browser extension based on Chrome Manifest V3. It's designed to provide an Arc-browser-like tab and bookmark management experience. By integrating bookmarks and currently open tabs into a single vertical sidebar, it makes it easier and more intuitive to browse, organize, and manage your webpages.

## 🌟 Features

- **Seamless Sidebar Integration (SidePanel API)**: Blends perfectly into your browser without obstructing web content.
- **Keyboard Shortcut (Toggle)**: Quickly open or close the sidebar using `Alt+B` (customizable at `chrome://extensions/shortcuts`).
- **Intuitive Bookmark Tree**: Displays all bookmarks and folders in a tree view, supporting seamless expand and collapse.
- **Dynamic Tabs List**: A dedicated section to show your currently open (and unsaved) tabs, helping you keep track of your workflow.
- **Drag & Drop Interactions**:
  - Reorder bookmarks and move them in/out of folders freely.
  - Drag unsaved tabs directly into the bookmark tree section for quick saving and categorization.
- **Customizable Layout**: A draggable divider between the bookmarks and tabs sections allows you to customize the height ratio according to your preference.
- **Real-time Sync**: Keeps full two-way synchronization with the browser's native bookmark and tab state.

## 🚀 Installation

As this extension is not yet published to the Chrome Web Store, please install it locally using "Developer mode":

1. Clone or download this repository to your local machine.
2. Open a Chromium-based browser (e.g., Chrome or Edge).
3. Navigate to `chrome://extensions/` (or Edge's equivalent extension management page).
4. Ensure **Developer mode** is enabled in the top right corner.
5. Click the **Load unpacked** button.
6. Select the main folder of this repository.
7. Once installed, click the extension icon in the browser toolbar or pin it to keep the Arclike Bookmarks sidebar handy!

## 🛠️ Tech Stack

- **Pure Frontend**: Built with Vanilla JavaScript, native HTML, and CSS. No Webpack or heavy dependencies—lightweight and fast.
- **Manifest V3**: Follows the latest Chrome Extension standards for better security and performance.
- **Core Extension APIs**:
  - `chrome.sidePanel`: Manages the persistent sidebar view.
  - `chrome.bookmarks`: Reads, writes, and organizes native bookmark data.
  - `chrome.tabs`: Manages browser tab activities.
  - `chrome.storage.session`: Efficiently handles session-level data mapping.

## 📜 License

This project is licensed under the MIT License.
