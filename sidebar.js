let searchQuery = '';
let searchDebounceTimer = null;
let expandedFolderIds = new Set();
let hasRenderedBookmarkTree = false;

document.addEventListener('DOMContentLoaded', () => {
  console.log('Sidebar loaded');
  initSearch();
  renderSidebar();
  initTabsReordering();
  initResizer();
});

function getSearchQuery() {
  return searchQuery.trim().toLowerCase();
}

async function renderSidebar() {
  await initBookmarks();
  await initTabs();
}

function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', (event) => {
    searchQuery = event.target.value;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      renderSidebar();
    }, 180);
  });
}

function initResizer() {
  const divider = document.getElementById('drag-divider');
  const topSection = document.getElementById('bookmarks-section');
  let isDragging = false;
  
  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    divider.classList.add('active');
    document.body.classList.add('resizing');
  });
  
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newHeight = e.clientY;
    topSection.style.flex = 'none'; // release flex:1
    topSection.style.height = `${newHeight}px`;
  });
  
  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      divider.classList.remove('active');
      document.body.classList.remove('resizing');
    }
  });
}


function initTabsReordering() {
  const container = document.getElementById('tabs-list');
  container.addEventListener('dragover', e => {
    e.preventDefault();
  });
  container.addEventListener('drop', e => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'tab') {
        const dropTarget = e.target.closest('.tab-node');
        if (dropTarget) {
          const targetId = parseInt(dropTarget.dataset.tabId, 10);
          chrome.tabs.get(targetId, (targetTab) => {
            chrome.tabs.move(data.id, { index: targetTab.index, windowId: targetTab.windowId });
          });
        }
      }
    } catch (err) {}
  });
}


function normalizeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const pathname = u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : u.pathname;
    return u.origin + pathname;
  } catch (e) {
    return url.replace(/\/$/, '');
  }
}

function getFaviconUrl(url) {
  const urlObj = new URL(chrome.runtime.getURL('/_favicon/'));
  urlObj.searchParams.set('pageUrl', url);
  urlObj.searchParams.set('size', '32');
  return urlObj.toString();
}

async function initBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const tabs = await chrome.tabs.query({});
  const rootNodes = tree[0].children || [];
  const bookmarkIdsByUrl = collectBookmarkIdsByUrl(rootNodes);
  
  const openUrlsMap = new Map();
  const tabsById = new Map();
  tabs.forEach(tab => {
     if (tab.id !== undefined) {
       tabsById.set(tab.id, tab);
     }
     if (tab.url) {
       const normalizedTabUrl = normalizeUrl(tab.url);
       if (normalizedTabUrl && !openUrlsMap.has(normalizedTabUrl)) {
         openUrlsMap.set(normalizedTabUrl, tab);
       }
     }
  });
  
  const data = await chrome.storage.session.get('bookmarkTabs');
  const bookmarkTabsMap = data.bookmarkTabs || {};
  let shouldPersistBookmarkTabs = false;
  tabs.forEach(tab => {
    if (!tab.url || bookmarkTabsMap[tab.id]) return;

    const bookmarkId = bookmarkIdsByUrl.get(normalizeUrl(tab.url));
    if (bookmarkId) {
      bookmarkTabsMap[tab.id] = bookmarkId;
      shouldPersistBookmarkTabs = true;
    }
  });

  if (shouldPersistBookmarkTabs) {
    await chrome.storage.session.set({ bookmarkTabs: bookmarkTabsMap });
  }

  const explicitlyOpenBookmarks = new Map();
  for (const [tabIdStr, bId] of Object.entries(bookmarkTabsMap)) {
      const tabId = parseInt(tabIdStr, 10);
      if (tabsById.has(tabId)) {
          explicitlyOpenBookmarks.set(bId, tabsById.get(tabId));
      }
  }
  
  const container = document.getElementById('bookmarks-tree');
  const query = getSearchQuery();

  if (query) {
    container.innerHTML = '';
    const results = collectBookmarkSearchResults(rootNodes, [], openUrlsMap, explicitlyOpenBookmarks, query);
    results.forEach(result => {
      container.appendChild(renderBookmarkSearchResult(result, openUrlsMap, explicitlyOpenBookmarks, query));
    });
    return;
  }
  
  const expandedFolders = new Set();
  const isFirstLoad = !hasRenderedBookmarkTree;
  if (isFirstLoad) {
    expandedFolderIds = new Set();
  } else {
    expandedFolderIds.forEach(id => expandedFolders.add(id));
    container.querySelectorAll('.folder:not(.collapsed)').forEach(el => {
      if (el.dataset.id) expandedFolders.add(el.dataset.id);
    });
    expandedFolderIds = new Set(expandedFolders);
  }

  container.innerHTML = '';
  rootNodes.forEach(node => {
     const result = renderBookmarkNode(node, openUrlsMap, explicitlyOpenBookmarks, expandedFolders, isFirstLoad);
     container.appendChild(result.el);
  });
  hasRenderedBookmarkTree = true;
}

function collectBookmarkIdsByUrl(nodes) {
  const bookmarkIdsByUrl = new Map();

  function traverse(items) {
    items.forEach(item => {
      if (item.url) {
        const normalizedUrl = normalizeUrl(item.url);
        if (normalizedUrl && !bookmarkIdsByUrl.has(normalizedUrl)) {
          bookmarkIdsByUrl.set(normalizedUrl, item.id);
        }
      }

      if (item.children) {
        traverse(item.children);
      }
    });
  }

  traverse(nodes);
  return bookmarkIdsByUrl;
}

function getBookmarkOpenState(node, openUrlsMap, explicitlyOpenBookmarks) {
  const normalizedNodeUrl = normalizeUrl(node.url);
  let isOpen = false;
  let associatedTabId = null;
  let currentUrl = '';

  if (explicitlyOpenBookmarks && explicitlyOpenBookmarks.has(node.id)) {
    isOpen = true;
    const tab = explicitlyOpenBookmarks.get(node.id);
    associatedTabId = tab.id;
    currentUrl = tab.url || tab.pendingUrl || '';
  } else if (openUrlsMap && openUrlsMap.has(normalizedNodeUrl)) {
    isOpen = true;
    const tab = openUrlsMap.get(normalizedNodeUrl);
    associatedTabId = tab.id;
    currentUrl = tab.url || tab.pendingUrl || '';
  }

  return { isOpen, associatedTabId, normalizedNodeUrl, currentUrl };
}

function isSearchMatch(title, url, query) {
  if (!query) return true;
  const titleText = (title || '').toLowerCase();
  const urlText = (url || '').toLowerCase();
  return titleText.includes(query) || urlText.includes(query);
}

function appendHighlightedText(parent, text, query) {
  const sourceText = text || '';
  if (!query) {
    parent.appendChild(document.createTextNode(sourceText));
    return;
  }

  const lowerText = sourceText.toLowerCase();
  let cursor = 0;
  let matchIndex = lowerText.indexOf(query);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parent.appendChild(document.createTextNode(sourceText.slice(cursor, matchIndex)));
    }

    const mark = document.createElement('mark');
    mark.appendChild(document.createTextNode(sourceText.slice(matchIndex, matchIndex + query.length)));
    parent.appendChild(mark);

    cursor = matchIndex + query.length;
    matchIndex = lowerText.indexOf(query, cursor);
  }

  if (cursor < sourceText.length) {
    parent.appendChild(document.createTextNode(sourceText.slice(cursor)));
  }
}

function collectBookmarkSearchResults(nodes, folderPath, openUrlsMap, explicitlyOpenBookmarks, query) {
  const results = [];

  nodes.forEach(node => {
    if (node.children) {
      const nextPath = node.title ? [...folderPath, node.title] : folderPath;
      results.push(...collectBookmarkSearchResults(node.children, nextPath, openUrlsMap, explicitlyOpenBookmarks, query));
      return;
    }

    if (isSearchMatch(node.title, node.url, query)) {
      results.push({
        node,
        folderPath: folderPath.join(' / '),
        openState: getBookmarkOpenState(node, openUrlsMap, explicitlyOpenBookmarks)
      });
    }
  });

  return results;
}

function createActionButton(title, text) {
  const actionBtn = document.createElement('div');
  actionBtn.className = 'action-btn';
  actionBtn.title = title;
  actionBtn.textContent = text;
  return actionBtn;
}

async function activateBookmark(node, isOpen, associatedTabId) {
  if (isOpen && associatedTabId) {
    chrome.tabs.update(associatedTabId, { active: true }).catch(() => {});
    return;
  }

  const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = activeTabs[0];
  const isNewTab = activeTab && (
    activeTab.url === 'chrome://newtab/' ||
    activeTab.url === 'edge://newtab/' ||
    activeTab.pendingUrl === 'chrome://newtab/' ||
    activeTab.url === ''
  );

  let tabId;
  if (isNewTab) {
    tabId = activeTab.id;
    const data = await chrome.storage.session.get('bookmarkTabs');
    const map = data.bookmarkTabs || {};
    map[tabId] = node.id;
    await chrome.storage.session.set({ bookmarkTabs: map });
    chrome.tabs.update(tabId, { url: node.url }).catch(() => {});
  } else {
    const newTab = await chrome.tabs.create({ url: node.url, active: true });
    tabId = newTab.id;
    const data = await chrome.storage.session.get('bookmarkTabs');
    const map = data.bookmarkTabs || {};
    map[tabId] = node.id;
    await chrome.storage.session.set({ bookmarkTabs: map });
    renderSidebar();
  }
}

function renderBookmarkHeader(node, openState, query = '', folderPath = '') {
  const { isOpen, associatedTabId, currentUrl } = openState;
  const btnIcon = isOpen ? '✕' : '−';
  const btnTitle = isOpen ? 'Close tab' : 'Delete bookmark';
  const header = document.createElement('div');
  header.className = 'item-header';
  if (isOpen) {
    header.classList.add('open-bookmark');
  }

  const icon = document.createElement('img');
  icon.className = 'icon';
  icon.src = getFaviconUrl(node.url);
  icon.alt = '';
  header.appendChild(icon);

  if (query) {
    const content = document.createElement('div');
    content.className = 'item-content';

    const title = document.createElement('span');
    title.className = 'title';
    appendHighlightedText(title, node.title, query);
    content.appendChild(title);

    if (folderPath) {
      const path = document.createElement('span');
      path.className = 'secondary-text';
      path.textContent = folderPath;
      content.appendChild(path);
    }

    const url = document.createElement('span');
    url.className = 'secondary-text';
    renderBookmarkUrl(url, node, openState, query);
    content.appendChild(url);

    header.appendChild(content);
  } else {
    const content = document.createElement('div');
    content.className = 'item-content';

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = node.title;
    content.appendChild(title);

    if (isOpen && currentUrl) {
      const url = document.createElement('span');
      url.className = 'secondary-text';
      renderBookmarkUrl(url, node, openState, query);
      content.appendChild(url);
    }

    header.appendChild(content);
  }

  const actionBtn = createActionButton(btnTitle, btnIcon);
  actionBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (isOpen) {
      if (associatedTabId) chrome.tabs.remove(associatedTabId).catch(() => {});
    } else {
      chrome.bookmarks.remove(node.id).catch(() => {});
    }
  });
  header.appendChild(actionBtn);

  header.addEventListener('click', async (e) => {
    if (e.target.closest('.action-btn')) return;
    await activateBookmark(node, isOpen, associatedTabId);
  });

  return header;
}

function renderBookmarkUrl(parent, node, openState, query) {
  const { isOpen, associatedTabId, currentUrl } = openState;
  const displayUrl = isOpen && currentUrl ? currentUrl : node.url;
  const isDifferentUrl = isOpen && currentUrl && currentUrl !== node.url;

  if (isDifferentUrl) {
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'url-reset-btn';
    resetBtn.title = 'Go back to bookmark URL';
    resetBtn.textContent = '↩';
    resetBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      chrome.tabs.update(associatedTabId, { url: node.url, active: true }).catch(() => {});
    });
    parent.appendChild(resetBtn);
    parent.appendChild(document.createTextNode(' '));
  }

  appendHighlightedText(parent, displayUrl, query);
}

function renderBookmarkSearchResult(result, openUrlsMap, explicitlyOpenBookmarks, query) {
  const el = document.createElement('div');
  el.className = 'bookmark-node bookmark';
  el.dataset.id = result.node.id;
  if (result.node.parentId) el.dataset.parentId = result.node.parentId;
  if (result.node.index !== undefined) el.dataset.index = result.node.index;
  el.appendChild(renderBookmarkHeader(result.node, result.openState, query, result.folderPath));
  return el;
}

function renderBookmarkNode(node, openUrlsMap, explicitlyOpenBookmarks, expandedFolders, isFirstLoad) {
  const el = document.createElement('div');
  el.className = 'bookmark-node';
  el.dataset.id = node.id;
  if (node.parentId) el.dataset.parentId = node.parentId;
  if (node.index !== undefined) el.dataset.index = node.index;
  
  let header;
  let hasOpenNode = false;
  
  if (node.children) {
    el.classList.add('folder');
    
    header = document.createElement('div');
    header.className = 'item-header';

    const icon = document.createElement('span');
    icon.className = 'icon folder-icon';
    icon.textContent = '📁';
    header.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = node.title;
    header.appendChild(title);
    
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    node.children.forEach(child => {
      const result = renderBookmarkNode(child, openUrlsMap, explicitlyOpenBookmarks, expandedFolders, isFirstLoad);
      if (result.hasOpen) hasOpenNode = true;
      childrenContainer.appendChild(result.el);
    });
    
    const shouldCollapse = isFirstLoad ? !hasOpenNode : !expandedFolders.has(node.id);
    if (shouldCollapse && node.parentId !== '0') {
      el.classList.add('collapsed');
    } else if (node.id) {
      expandedFolderIds.add(node.id);
    }
    
    header.addEventListener('click', (e) => {
      if (!e.target.closest('.action-btn')) {
        el.classList.toggle('collapsed');
        if (el.classList.contains('collapsed')) {
          expandedFolderIds.delete(node.id);
        } else {
          expandedFolderIds.add(node.id);
        }
      }
    });
    
    el.appendChild(header);
    el.appendChild(childrenContainer);
  } else {
    el.classList.add('bookmark');
    const openState = getBookmarkOpenState(node, openUrlsMap, explicitlyOpenBookmarks);
    const { isOpen } = openState;

    hasOpenNode = isOpen;
    header = renderBookmarkHeader(node, openState);
    
    el.appendChild(header);
  }

  // Common Drag and Drop Logic
  // Only allow dragging if parentId is neither 0 nor undefined (0 is root, which shouldn't be dragged usually)
  if (node.parentId && node.parentId !== '0') {
    header.draggable = true;
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'bookmark',
        id: node.id
      }));
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      header.style.opacity = '0.5';
    });
    header.addEventListener('dragend', (e) => {
      header.style.opacity = '1';
    });
  }

  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    header.classList.add('drag-over');
  });
  header.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    header.classList.remove('drag-over');
  });
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    header.classList.remove('drag-over');
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'tab') {
        const targetParentId = node.children ? node.id : node.parentId;
        chrome.bookmarks.create({
          parentId: targetParentId,
          title: data.title,
          url: data.url
        });
      } else if (data.type === 'bookmark') {
        if (data.id === node.id) return; // Ignore dropping on itself
        if (node.children) {
          // Folder: move into it
          chrome.bookmarks.move(data.id, { parentId: node.id });
        } else {
          // Bookmark file: insert at the same index
          chrome.bookmarks.move(data.id, { parentId: node.parentId, index: node.index });
        }
      }
    } catch (err) {}
  });

  return { el, hasOpen: hasOpenNode };
}

async function getAllBookmarks() {
  return new Promise(resolve => {
    chrome.bookmarks.getTree(tree => {
      const urls = new Set();
      function traverse(nodes) {
        for (const node of nodes) {
          if (node.url) urls.add(normalizeUrl(node.url));
          if (node.children) traverse(node.children);
        }
      }
      traverse(tree);
      resolve(urls);
    });
  });
}

async function initTabs() {
  const bookmarkUrls = await getAllBookmarks();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const query = getSearchQuery();
  
  const data = await chrome.storage.session.get('bookmarkTabs');
  const bookmarkTabsMap = data.bookmarkTabs || {};

  const container = document.getElementById('tabs-list');
  container.innerHTML = '';
  
  tabs.forEach(tab => {
     if (bookmarkTabsMap[tab.id]) {
        return; // Exclude because it was explicitly launched from a bookmark
     }

     if (tab.url) {
        if (!bookmarkUrls.has(normalizeUrl(tab.url)) && isSearchMatch(tab.title, tab.url, query)) {
           container.appendChild(renderTabNode(tab, query));
        }
     } else if (isSearchMatch(tab.title, tab.url, query)) {
        container.appendChild(renderTabNode(tab, query));
     }
  });
}

function renderTabNode(tab, query = '') {
  const el = document.createElement('div');
  el.className = 'tab-node';
  el.draggable = true;
  el.dataset.tabId = tab.id;

  const icon = document.createElement('img');
  icon.className = 'icon';
  icon.src = tab.favIconUrl || getFaviconUrl(tab.url);
  icon.alt = '';
  el.appendChild(icon);

  if (query) {
    const content = document.createElement('div');
    content.className = 'item-content';

    const title = document.createElement('span');
    title.className = 'title';
    appendHighlightedText(title, tab.title, query);
    content.appendChild(title);

    const url = document.createElement('span');
    url.className = 'secondary-text';
    appendHighlightedText(url, tab.url, query);
    content.appendChild(url);

    el.appendChild(content);
  } else {
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = tab.title;
    el.appendChild(title);
  }

  const actionBtn = createActionButton('Close tab', '✕');
  el.appendChild(actionBtn);
  
  el.addEventListener('click', (e) => {
    if (e.target.closest('.action-btn')) return;
    chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  });

  actionBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    chrome.tabs.remove(tab.id).catch(() => {});
  });

  el.addEventListener('dragstart', (e) => {
    if (e.target.closest('.action-btn')) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'tab',
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId
    }));
    e.dataTransfer.effectAllowed = 'move';
    el.style.opacity = '0.5';
  });

  el.addEventListener('dragend', (e) => {
    el.style.opacity = '1';
  });

  return el;
}

// Listen to changes to keep UI in sync
chrome.tabs.onCreated.addListener(renderSidebar);
chrome.tabs.onUpdated.addListener(renderSidebar);
chrome.tabs.onRemoved.addListener(async (tabId) => {
   const data = await chrome.storage.session.get('bookmarkTabs');
   if (data.bookmarkTabs && data.bookmarkTabs[tabId]) {
      delete data.bookmarkTabs[tabId];
      await chrome.storage.session.set({ bookmarkTabs: data.bookmarkTabs });
   }
   renderSidebar();
});

chrome.bookmarks.onCreated.addListener(renderSidebar);
chrome.bookmarks.onRemoved.addListener(renderSidebar);
chrome.bookmarks.onChanged.addListener(renderSidebar);
chrome.bookmarks.onMoved.addListener(renderSidebar);
chrome.bookmarks.onChildrenReordered.addListener(renderSidebar);

// Connect to background.js so it knows the side panel is open
const port = chrome.runtime.connect({ name: 'sidepanel' });
port.onMessage.addListener((message) => {
  if (message.action === 'close') {
    window.close();
  }
});
