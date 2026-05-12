let searchQuery = '';
let searchDebounceTimer = null;
let urlStableRenderTimer = null;
let expandedFolderIds = new Set();
let hasRenderedBookmarkTree = false;
let pendingMovePositions = null;
let activeDropIndicator = null;
let draggingType = null;
let bookmarkFaviconCache = {};
let suppressedBookmarkIds = new Set();
let pendingUrlChanges = new Map();
let currentSelectedIndex = -1;

document.addEventListener('DOMContentLoaded', () => {
  console.log('Sidebar loaded');
  initSearch();
  renderSidebar();
  initTabsReordering();
  initResizer();
  updateDynamicBackground();
});

function getSearchQuery() {
  return searchQuery.trim().toLowerCase();
}

let isRendering = false;
let pendingRender = false;
let renderDebounceTimer = null;

async function executeRender() {
  if (isRendering) {
    pendingRender = true;
    return;
  }
  isRendering = true;
  pendingRender = false;
  
  try {
    const applyBookmarksDOM = await initBookmarks();
    const applyTabsDOM = await initTabs();
    
    // Synchronously update both DOMs to avoid layout paint gaps
    applyBookmarksDOM();
    applyTabsDOM();

    if (pendingMovePositions) {
      const previousPositions = pendingMovePositions;
      pendingMovePositions = null;
      requestAnimationFrame(() => playMoveAnimations(previousPositions));
    }

    applyDefaultSelection();
  } catch (err) {
    console.error('Render error:', err);
  } finally {
    isRendering = false;
    if (pendingRender) {
      setTimeout(executeRender, 10);
    }
  }
}

function renderSidebar() {
  if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
  renderDebounceTimer = setTimeout(executeRender, 10);
}

function scheduleUrlStableRender() {
  if (urlStableRenderTimer) clearTimeout(urlStableRenderTimer);
  urlStableRenderTimer = setTimeout(renderSidebar, 1000);
}

function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  requestAnimationFrame(() => searchInput.focus());

  searchInput.addEventListener('input', (event) => {
    searchQuery = event.target.value;
    currentSelectedIndex = -1;
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      renderSidebar();
    }, 180);
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      navigateSearchResults(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openSelectedSearchResult();
    }
  });
}

function getSelectableItems() {
  const items = Array.from(document.querySelectorAll('.bookmark-node > .item-header, .tab-node'));
  return items.filter(el => {
    let parent = el.parentElement;
    while (parent) {
      if (parent.classList.contains('folder-children') && parent.parentElement.classList.contains('collapsed')) {
        return false;
      }
      parent = parent.parentElement;
    }
    return true;
  });
}

function navigateSearchResults(direction) {
  const items = getSelectableItems();
  if (items.length === 0) return;

  if (currentSelectedIndex >= 0 && currentSelectedIndex < items.length) {
    items[currentSelectedIndex].classList.remove('keyboard-selected');
  }

  currentSelectedIndex += direction;

  if (currentSelectedIndex < 0) {
    currentSelectedIndex = items.length - 1;
  } else if (currentSelectedIndex >= items.length) {
    currentSelectedIndex = 0;
  }

  const selectedItem = items[currentSelectedIndex];
  selectedItem.classList.add('keyboard-selected');
  selectedItem.scrollIntoView({ block: 'nearest' });
}

function openSelectedSearchResult() {
  if (currentSelectedIndex < 0) return;
  const items = getSelectableItems();
  if (currentSelectedIndex < items.length) {
    const selectedItem = items[currentSelectedIndex];
    selectedItem.click();
  }
}

function applyDefaultSelection() {
  if (getSearchQuery()) {
    currentSelectedIndex = -1;
    navigateSearchResults(1);
  }
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
    topSection.style.flex = 'none'; // 释放 flex 高度，改由拖拽位置控制
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
    const dropTarget = getTabDropTarget(container, e);
    if (draggingType === 'bookmark') {
      e.preventDefault();
      if (dropTarget) {
        setDropIndicator(dropTarget, e, false);
      } else {
        setEmptyTabDropIndicator(container);
      }
      return;
    }

    e.preventDefault();
    if (dropTarget) {
      setDropIndicator(dropTarget, e, false);
    }
  });
  container.addEventListener('dragleave', e => {
    if (!container.contains(e.relatedTarget)) clearDropIndicators();
  });
  container.addEventListener('drop', async e => {
    e.preventDefault();
    clearDropIndicators();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'bookmark') {
        const dropTarget = getTabDropTarget(container, e);
        const dropLocation = dropTarget ? await getTabDropLocation(dropTarget, e) : null;
        await unbookmarkToOpenTab(data, dropLocation);
      } else if (data.type === 'tab') {
        const dropTarget = getTabDropTarget(container, e);
        if (dropTarget) {
          const dropLocation = await getTabDropLocation(dropTarget, e);
          if (dropLocation) {
            const previousPositions = captureLayoutPositions();
            const nextIndex = dropLocation.index;
            pendingMovePositions = previousPositions;
            chrome.tabs.move(data.id, { index: nextIndex, windowId: dropLocation.windowId });
          }
        }
      }
    } catch (err) {}
  });
}

function getTabDropTarget(container, event) {
  const directTarget = event.target.closest('.tab-node');
  if (directTarget && container.contains(directTarget)) {
    return directTarget;
  }

  const tabNodes = Array.from(container.querySelectorAll('.tab-node'));
  return tabNodes.length ? tabNodes[tabNodes.length - 1] : null;
}

function setEmptyTabDropIndicator(container) {
  if (container.querySelector('.tab-node')) {
    clearDropIndicators();
    return;
  }

  if (activeDropIndicator === container && container.classList.contains('drop-indicator-before')) {
    return;
  }

  clearDropIndicators();
  container.classList.add('drop-indicator-before');
  activeDropIndicator = container;
}

async function getTabDropLocation(dropTarget, event) {
  const targetId = parseInt(dropTarget.dataset.tabId, 10);
  const targetTab = await chrome.tabs.get(targetId);
  const targetRect = dropTarget.getBoundingClientRect();
  const insertAfter = event.clientY > targetRect.top + targetRect.height / 2;

  return {
    windowId: targetTab.windowId,
    index: insertAfter ? targetTab.index + 1 : targetTab.index
  };
}

function createDragGhost(iconSource, titleText) {
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';

  const icon = iconSource instanceof Node ? iconSource.cloneNode(true) : document.createElement('span');
  icon.className = 'icon';
  if (!(iconSource instanceof Node)) {
    icon.textContent = iconSource;
  }
  ghost.appendChild(icon);

  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = titleText || '';
  ghost.appendChild(title);

  document.body.appendChild(ghost);
  return ghost;
}

function removeDragGhost(ghost) {
  if (ghost && ghost.parentNode) {
    ghost.parentNode.removeChild(ghost);
  }
}

function createBookmarkDragIcon(node) {
  if (node.children) return '📁';
  if (bookmarkFaviconCache[node.id]) return createFaviconImg(bookmarkFaviconCache[node.id]);
  return createFaviconIcon(node.url);
}

function createTabDragIcon(tab) {
  if (tab.favIconUrl) return createFaviconImg(tab.favIconUrl);
  return createFaviconIcon(tab.url);
}

function clearDropIndicators() {
  if (activeDropIndicator) {
    activeDropIndicator.classList.remove('drop-indicator-before', 'drop-indicator-after', 'drop-target-folder');
    activeDropIndicator = null;
  }
  document.querySelectorAll('.drop-target-list').forEach(el => el.classList.remove('drop-target-list'));
}

function setDropIndicator(target, event, allowIntoFolder) {
  if (!target) return;

  const placement = getBookmarkDropPlacement(target, event, allowIntoFolder);
  
  let nextClass = 'drop-indicator-before';
  if (placement === 'after' || placement === 'inside-top') {
    nextClass = 'drop-indicator-after';
  } else if (placement === 'inside') {
    nextClass = 'drop-target-folder';
  }

  if (activeDropIndicator === target && target.classList.contains(nextClass)) {
    return;
  }

  clearDropIndicators();
  target.classList.add(nextClass);
  activeDropIndicator = target;
}

function getBookmarkDropPlacement(target, event, allowIntoFolder) {
  const rect = target.getBoundingClientRect();
  const targetNode = target.closest('.bookmark-node');
  const isFolder = allowIntoFolder && targetNode && targetNode.classList.contains('folder');

  if (isFolder) {
    const isExpanded = !targetNode.classList.contains('collapsed');
    const offsetRatio = (event.clientY - rect.top) / rect.height;
    if (offsetRatio < 0.25) return 'before';
    if (offsetRatio > 0.75) {
      return isExpanded ? 'inside-top' : 'after';
    }
    return 'inside';
  }

  return event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
}

function getBookmarkDropLocation(node, target, event) {
  const placement = getBookmarkDropPlacement(target, event, true);

  if ((placement === 'inside' || placement === 'inside-top') && node.children) {
    return { parentId: node.id, index: 0 };
  }

  return {
    parentId: node.parentId,
    index: placement === 'after' ? node.index + 1 : node.index
  };
}

function captureLayoutPositions() {
  const positions = new Map();
  document.querySelectorAll('.bookmark-node[data-id], .tab-node[data-tab-id]').forEach(el => {
    const key = el.dataset.id ? `bookmark-${el.dataset.id}` : `tab-${el.dataset.tabId}`;
    positions.set(key, el.getBoundingClientRect());
  });
  return positions;
}

function playMoveAnimations(previousPositions) {
  if (!previousPositions) return;

  const elementsToAnimate = [];

  document.querySelectorAll('.bookmark-node[data-id], .tab-node[data-tab-id]').forEach(el => {
    const key = el.dataset.id ? `bookmark-${el.dataset.id}` : `tab-${el.dataset.tabId}`;
    const previousRect = previousPositions.get(key);
    if (!previousRect) return;

    const nextRect = el.getBoundingClientRect();
    const deltaX = previousRect.left - nextRect.left;
    const deltaY = previousRect.top - nextRect.top;
    
    if (deltaX !== 0 || deltaY !== 0) {
      elementsToAnimate.push({ el, deltaX, deltaY });
    }
  });

  // Apply initial transforms
  elementsToAnimate.forEach(({ el, deltaX, deltaY }) => {
    el.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
  });

  // Force layout once
  if (elementsToAnimate.length > 0) {
    document.body.getBoundingClientRect();
  }

  requestAnimationFrame(() => {
    elementsToAnimate.forEach(({ el }) => {
      el.classList.add('is-moving');
      el.style.transform = '';
      
      window.setTimeout(() => {
        el.classList.remove('is-moving');
        el.style.transform = '';
      }, 220);
    });
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

function createDefaultFaviconIcon() {
  const icon = document.createElement('span');
  icon.className = 'icon fallback-favicon';
  icon.textContent = '🌐';
  icon.title = 'No favicon';
  return icon;
}

function createFaviconIcon(url) {
  if (!url) return createDefaultFaviconIcon();
  return createFaviconImg(getFaviconUrl(url));
}

function createFaviconImg(src) {
  if (!src) return createDefaultFaviconIcon();
  const icon = document.createElement('img');
  icon.className = 'icon';
  icon.src = src;
  icon.alt = '';
  icon.addEventListener('error', () => {
    icon.replaceWith(createDefaultFaviconIcon());
  }, { once: true });
  return icon;
}

async function initBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const tabs = await chrome.tabs.query({});
  const rootNodes = tree[0].children || [];
  const bookmarkIdsByUrl = collectBookmarkIdsByUrl(rootNodes);

  const tabsById = new Map();
  tabs.forEach(tab => {
     if (tab.id !== undefined) {
       tabsById.set(tab.id, tab);
     }
  });

  const data = await chrome.storage.session.get(['bookmarkTabs', 'bookmarkFavicons']);
  const bookmarkTabsMap = data.bookmarkTabs || {};
  Object.assign(bookmarkFaviconCache, data.bookmarkFavicons || {});
  let shouldPersistBookmarkTabs = false;
  let shouldPersistFavicons = false;

  // 用户手动在地址栏输入/导航到书签网址时，清除抑制状态
  for (const [tabId, url] of pendingUrlChanges) {
    const bookmarkId = bookmarkIdsByUrl.get(normalizeUrl(url));
    if (bookmarkId) {
      suppressedBookmarkIds.delete(bookmarkId);
    }
  }
  pendingUrlChanges.clear();

  const explicitBookmarkIds = new Set(Object.values(bookmarkTabsMap));
  tabs.forEach(tab => {
    if (!tab.url || bookmarkTabsMap[tab.id]) return;

    const bookmarkId = bookmarkIdsByUrl.get(normalizeUrl(tab.url));
    if (bookmarkId && !explicitBookmarkIds.has(bookmarkId) && !suppressedBookmarkIds.has(bookmarkId)) {
      bookmarkTabsMap[tab.id] = bookmarkId;
      explicitBookmarkIds.add(bookmarkId);
      shouldPersistBookmarkTabs = true;
    }
  });

  if (shouldPersistBookmarkTabs) {
    await chrome.storage.session.set({ bookmarkTabs: bookmarkTabsMap });
  }

  const explicitlyOpenBookmarks = new Map();
  tabs.forEach(tab => {
    if (tab.id === undefined) return;
    const bId = bookmarkTabsMap[tab.id];
    if (bId && !explicitlyOpenBookmarks.has(bId)) {
      explicitlyOpenBookmarks.set(bId, tab);
      if (tab.favIconUrl && bookmarkFaviconCache[bId] !== tab.favIconUrl) {
        bookmarkFaviconCache[bId] = tab.favIconUrl;
        shouldPersistFavicons = true;
      }
    }
  });

  // 清理 bookmarkTabsMap 中的过时条目、重复条目以及指向已删除书签的条目
  const allBookmarkIds = collectAllBookmarkIds(rootNodes);
  const keptBookmarkIds = new Set();
  let needsCleanup = false;
  for (const [tabIdStr, bId] of Object.entries(bookmarkTabsMap)) {
    const tabId = parseInt(tabIdStr, 10);
    if (!tabsById.has(tabId) || keptBookmarkIds.has(bId) || !allBookmarkIds.has(bId)) {
      delete bookmarkTabsMap[tabIdStr];
      needsCleanup = true;
    } else {
      keptBookmarkIds.add(bId);
    }
  }
  if (needsCleanup) {
    await chrome.storage.session.set({ bookmarkTabs: bookmarkTabsMap });
  }

  if (shouldPersistFavicons) {
    await chrome.storage.session.set({ bookmarkFavicons: bookmarkFaviconCache });
  }

  const container = document.getElementById('bookmarks-tree');
  const query = getSearchQuery();

  if (query) {
    const fragment = document.createDocumentFragment();
    const results = collectBookmarkSearchResults(rootNodes, [], explicitlyOpenBookmarks, query);
    results.forEach(result => {
      fragment.appendChild(renderBookmarkSearchResult(result, explicitlyOpenBookmarks, query));
    });
    return () => {
      const scrollTop = container.scrollTop;
      container.replaceChildren(fragment);
      container.scrollTop = scrollTop;
    };
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

  const fragment = document.createDocumentFragment();
  rootNodes.forEach((node, index) => {
     const isRootFirstChild = index === 0;
     const result = renderBookmarkNode(node, explicitlyOpenBookmarks, expandedFolders, isFirstLoad, isRootFirstChild);
     fragment.appendChild(result.el);
  });
  return () => {
    const scrollTop = container.scrollTop;
    container.replaceChildren(fragment);
    container.scrollTop = scrollTop;
    hasRenderedBookmarkTree = true;
  };
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

function collectAllBookmarkIds(nodes) {
  const ids = new Set();
  function traverse(items) {
    items.forEach(item => {
      ids.add(item.id);
      if (item.children) traverse(item.children);
    });
  }
  traverse(nodes);
  return ids;
}

function getBookmarkOpenState(node, explicitlyOpenBookmarks) {
  const normalizedNodeUrl = normalizeUrl(node.url);
  let isOpen = false;
  let associatedTabId = null;
  let currentUrl = '';
  let tabFavIconUrl = '';

  if (explicitlyOpenBookmarks && explicitlyOpenBookmarks.has(node.id)) {
    isOpen = true;
    const tab = explicitlyOpenBookmarks.get(node.id);
    associatedTabId = tab.id;
    currentUrl = tab.url || tab.pendingUrl || '';
    tabFavIconUrl = tab.favIconUrl || '';
  }

  return { isOpen, associatedTabId, normalizedNodeUrl, currentUrl, tabFavIconUrl };
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

function collectBookmarkSearchResults(nodes, folderPath, explicitlyOpenBookmarks, query) {
  const results = [];

  nodes.forEach(node => {
    if (node.children) {
      const nextPath = node.title ? [...folderPath, node.title] : folderPath;
      results.push(...collectBookmarkSearchResults(node.children, nextPath, explicitlyOpenBookmarks, query));
      return;
    }

    if (isSearchMatch(node.title, node.url, query)) {
      results.push({
        node,
        folderPath: folderPath.join(' / '),
        openState: getBookmarkOpenState(node, explicitlyOpenBookmarks)
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
  suppressedBookmarkIds.delete(node.id);
  if (isOpen && associatedTabId) {
    chrome.tabs.update(associatedTabId, { active: true }).catch(() => {});
    return;
  }

  // 优先复用已存在的同网址标签页（取浏览器标签栏最左边的那个）
  const allTabs = await chrome.tabs.query({ currentWindow: true });
  const normalizedNodeUrl = normalizeUrl(node.url);
  const existingTab = allTabs.find(tab => {
    if (!tab.url) return false;
    return normalizeUrl(tab.url) === normalizedNodeUrl;
  });

  if (existingTab) {
    const data = await chrome.storage.session.get('bookmarkTabs');
    const map = data.bookmarkTabs || {};
    for (const [key, value] of Object.entries(map)) {
      if (value === node.id) delete map[key];
    }
    map[existingTab.id] = node.id;
    await chrome.storage.session.set({ bookmarkTabs: map });
    chrome.tabs.update(existingTab.id, { active: true }).catch(() => {});
    renderSidebar();
    return;
  }

  // 没有已存在的同网址标签页，创建新的或复用空白页
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
    for (const [key, value] of Object.entries(map)) {
      if (value === node.id) delete map[key];
    }
    map[tabId] = node.id;
    await chrome.storage.session.set({ bookmarkTabs: map });
    chrome.tabs.update(tabId, { url: node.url }).catch(() => {});
  } else {
    const newTab = await chrome.tabs.create({ url: node.url, active: true });
    tabId = newTab.id;
    const data = await chrome.storage.session.get('bookmarkTabs');
    const map = data.bookmarkTabs || {};
    for (const [key, value] of Object.entries(map)) {
      if (value === node.id) delete map[key];
    }
    map[tabId] = node.id;
    await chrome.storage.session.set({ bookmarkTabs: map });
    renderSidebar();
  }
}

async function unbookmarkToOpenTab(data, dropLocation = null) {
  if (!data.url) return;

  suppressedBookmarkIds.add(data.id);

  const storageData = await chrome.storage.session.get('bookmarkTabs');
  const bookmarkTabsMap = storageData.bookmarkTabs || {};
  let associatedTabId = null;

  Object.entries(bookmarkTabsMap).forEach(([tabId, bookmarkId]) => {
    if (bookmarkId === data.id) {
      associatedTabId = parseInt(tabId, 10);
      delete bookmarkTabsMap[tabId];
    }
  });

  await chrome.storage.session.set({ bookmarkTabs: bookmarkTabsMap });

  let targetTab = null;
  if (associatedTabId) {
    try {
      targetTab = await chrome.tabs.get(associatedTabId);
    } catch (error) {}
  }

  if (!targetTab) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const targetUrl = normalizeUrl(data.url);
    targetTab = tabs.find(tab => normalizeUrl(tab.url || tab.pendingUrl) === targetUrl);
  }

  if (targetTab && targetTab.id !== undefined) {
    if (dropLocation) {
      const nextIndex = dropLocation.index;
      await chrome.tabs.move(targetTab.id, { windowId: dropLocation.windowId, index: nextIndex }).catch(() => {});
    }
    await chrome.tabs.update(targetTab.id, { active: true }).catch(() => {});
  } else {
    const createDetails = { url: data.url, active: true };
    if (dropLocation) {
      createDetails.windowId = dropLocation.windowId;
      createDetails.index = dropLocation.index;
    }
    await chrome.tabs.create(createDetails);
  }

  await chrome.bookmarks.remove(data.id);
}

function renderBookmarkHeader(node, openState, query = '', folderPath = '') {
  const { isOpen, associatedTabId, currentUrl, tabFavIconUrl } = openState;
  const btnIcon = isOpen ? '✕' : '−';
  const btnTitle = isOpen ? 'Close tab' : 'Delete bookmark';
  const header = document.createElement('div');
  header.className = 'item-header';
  if (isOpen) {
    header.classList.add('open-bookmark');
  }

  if (isOpen && tabFavIconUrl) {
    header.appendChild(createFaviconImg(tabFavIconUrl));
  } else if (bookmarkFaviconCache[node.id]) {
    header.appendChild(createFaviconImg(bookmarkFaviconCache[node.id]));
  } else {
    header.appendChild(createFaviconIcon(node.url));
  }

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

    const url = document.createElement('span');
    url.className = 'secondary-text bookmark-url-row';
    if (!isOpen || !currentUrl) {
      url.classList.add('is-reserved');
    }
    renderBookmarkUrl(url, node, openState, query, { reserveReset: true });
    content.appendChild(url);

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

function renderBookmarkUrl(parent, node, openState, query, options = {}) {
  const { isOpen, associatedTabId, currentUrl } = openState;
  const displayUrl = isOpen && currentUrl ? currentUrl : node.url;
  const isDifferentUrl = isOpen && currentUrl && currentUrl !== node.url;
  const shouldReserveReset = options.reserveReset || isDifferentUrl;

  if (shouldReserveReset) {
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'url-reset-btn';
    resetBtn.title = 'Go back to bookmark URL';
    resetBtn.textContent = '↩';
    if (isDifferentUrl) {
      resetBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        chrome.tabs.update(associatedTabId, { url: node.url, active: true }).catch(() => {});
      });
    } else {
      resetBtn.classList.add('is-reserved');
      resetBtn.tabIndex = -1;
      resetBtn.setAttribute('aria-hidden', 'true');
    }
    parent.appendChild(resetBtn);
    parent.appendChild(document.createTextNode(' '));
  }

  appendHighlightedText(parent, displayUrl, query);
}

function renderBookmarkSearchResult(result, explicitlyOpenBookmarks, query) {
  const el = document.createElement('div');
  el.className = 'bookmark-node bookmark';
  el.dataset.id = result.node.id;
  if (result.node.parentId) el.dataset.parentId = result.node.parentId;
  if (result.node.index !== undefined) el.dataset.index = result.node.index;
  el.appendChild(renderBookmarkHeader(result.node, result.openState, query, result.folderPath));
  return el;
}

function renderBookmarkNode(node, explicitlyOpenBookmarks, expandedFolders, isFirstLoad, isRootFirstChild = false) {
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
    header.appendChild(icon);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = node.title;
    header.appendChild(title);
    
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    node.children.forEach(child => {
      const result = renderBookmarkNode(child, explicitlyOpenBookmarks, expandedFolders, isFirstLoad);
      if (result.hasOpen) hasOpenNode = true;
      childrenContainer.appendChild(result.el);
    });
    
    const shouldCollapse = isFirstLoad ? !hasOpenNode : !expandedFolders.has(node.id);
    const preventCollapse = node.parentId === '0' && isRootFirstChild;
    if (shouldCollapse && !preventCollapse) {
      el.classList.add('collapsed');
    } else if (node.id) {
      expandedFolderIds.add(node.id);
    }
    icon.textContent = el.classList.contains('collapsed') ? '📁' : '📂';
    
    header.addEventListener('click', (e) => {
      if (!e.target.closest('.action-btn')) {
        el.classList.toggle('collapsed');
        if (el.classList.contains('collapsed')) {
          expandedFolderIds.delete(node.id);
          // Collapse all descendant folders
          const descendantFolders = el.querySelectorAll('.folder');
          descendantFolders.forEach(descEl => {
            descEl.classList.add('collapsed');
            const descId = descEl.dataset.id;
            if (descId) expandedFolderIds.delete(descId);
            const descIcon = descEl.querySelector(':scope > .item-header > .folder-icon');
            if (descIcon) descIcon.textContent = '📁';
          });
        } else {
          expandedFolderIds.add(node.id);
        }
        icon.textContent = el.classList.contains('collapsed') ? '📁' : '📂';
      }
    });
    
    el.appendChild(header);
    el.appendChild(childrenContainer);
  } else {
    el.classList.add('bookmark');
    const openState = getBookmarkOpenState(node, explicitlyOpenBookmarks);
    const { isOpen } = openState;

    hasOpenNode = isOpen;
    header = renderBookmarkHeader(node, openState);
    
    el.appendChild(header);
  }

  // 书签和文件夹共用拖拽逻辑
  // 根节点不参与拖拽，避免移动浏览器保留的顶层目录
  if (node.parentId && node.parentId !== '0') {
    let dragGhost = null;
    header.draggable = true;
    header.addEventListener('dragstart', (e) => {
      draggingType = 'bookmark';
      e.dataTransfer.setData('application/json', JSON.stringify({
        type: 'bookmark',
        id: node.id,
        parentId: node.parentId,
        index: node.index,
        title: node.title,
        url: node.url || '',
        isFolder: Boolean(node.children)
      }));
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      dragGhost = createDragGhost(createBookmarkDragIcon(node), node.title);
      e.dataTransfer.setDragImage(dragGhost, 12, 12);
      header.style.opacity = '0.5';
    });
    header.addEventListener('dragend', (e) => {
      header.style.opacity = '1';
      removeDragGhost(dragGhost);
      dragGhost = null;
      draggingType = null;
      clearDropIndicators();
    });
  }

  header.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDropIndicator(header, e, true);
  });
  header.addEventListener('dragleave', (e) => {
    e.stopPropagation();
    if (!header.contains(e.relatedTarget)) clearDropIndicators();
  });
  header.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'tab') {
        const previousPositions = captureLayoutPositions();
        pendingMovePositions = previousPositions;
        const dropLocation = getBookmarkDropLocation(node, header, e);
        const createDetails = {
          parentId: dropLocation.parentId,
          title: data.title,
          url: data.url
        };
        if (dropLocation.index !== undefined) {
          createDetails.index = dropLocation.index;
        }
        await chrome.bookmarks.create(createDetails);
      } else if (data.type === 'bookmark') {
        if (data.id === node.id) return; // 忽略拖到自身的操作
        const previousPositions = captureLayoutPositions();
        pendingMovePositions = previousPositions;
        const dropLocation = getBookmarkDropLocation(node, header, e);
        const moveDetails = { parentId: dropLocation.parentId };
        if (dropLocation.index !== undefined) {
          moveDetails.index = dropLocation.index;
        }
        await chrome.bookmarks.move(data.id, moveDetails);
      }
    } catch (err) {}
  });

  return { el, hasOpen: hasOpenNode };
}

async function initTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const query = getSearchQuery();

  const data = await chrome.storage.session.get('bookmarkTabs');
  const bookmarkTabsMap = data.bookmarkTabs || {};

  const container = document.getElementById('tabs-list');
  const fragment = document.createDocumentFragment();

  tabs.forEach(tab => {
     if (bookmarkTabsMap[tab.id]) {
        return; // 已由书签显式打开的标签页不再显示到 Open Tabs 面板
     }

     if (tab.url) {
        if (isSearchMatch(tab.title, tab.url, query)) {
           fragment.appendChild(renderTabNode(tab, query));
        }
     } else if (isSearchMatch(tab.title, tab.url, query)) {
        fragment.appendChild(renderTabNode(tab, query));
     }
  });

  return () => {
    const scrollTop = container.scrollTop;
    container.replaceChildren(fragment);
    container.scrollTop = scrollTop;
  };
}

function renderTabNode(tab, query = '') {
  const el = document.createElement('div');
  el.className = 'tab-node';
  el.draggable = true;
  el.dataset.tabId = tab.id;
  let dragGhost = null;

  el.appendChild(createFaviconIcon(tab.url));

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
    draggingType = 'tab';
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'tab',
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
      index: tab.index
    }));
    e.dataTransfer.effectAllowed = 'move';
    dragGhost = createDragGhost(createTabDragIcon(tab), tab.title || tab.url || '');
    e.dataTransfer.setDragImage(dragGhost, 12, 12);
    el.style.opacity = '0.5';
  });

  el.addEventListener('dragend', (e) => {
    el.style.opacity = '1';
    removeDragGhost(dragGhost);
    dragGhost = null;
    draggingType = null;
    clearDropIndicators();
  });

  return el;
}

// 监听浏览器数据变化，保持侧边栏同步
chrome.tabs.onCreated.addListener((tab) => {
  const newUrl = tab.url || tab.pendingUrl;
  if (newUrl) pendingUrlChanges.set(tab.id, newUrl);
  renderSidebar();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.pendingUrl || changeInfo.favIconUrl)) {
    updateDynamicBackground();
  }
  if (changeInfo.url || changeInfo.pendingUrl) {
    const newUrl = changeInfo.url || changeInfo.pendingUrl;
    if (newUrl) pendingUrlChanges.set(tabId, newUrl);
    scheduleUrlStableRender();
    return;
  }
  renderSidebar();
});
chrome.tabs.onMoved.addListener(renderSidebar);
	chrome.tabs.onRemoved.addListener(async (tabId) => {
   const data = await chrome.storage.session.get('bookmarkTabs');
   if (data.bookmarkTabs && data.bookmarkTabs[tabId]) {
      const bookmarkId = data.bookmarkTabs[tabId];
      delete data.bookmarkTabs[tabId];
      await chrome.storage.session.set({ bookmarkTabs: data.bookmarkTabs });
      suppressedBookmarkIds.add(bookmarkId);
   }
   renderSidebar();
});

chrome.bookmarks.onCreated.addListener(renderSidebar);
chrome.bookmarks.onRemoved.addListener(renderSidebar);
chrome.bookmarks.onChanged.addListener(renderSidebar);
chrome.bookmarks.onMoved.addListener(renderSidebar);
chrome.bookmarks.onChildrenReordered.addListener(renderSidebar);

// 连接 background.js，让后台知道侧边栏处于打开状态
const port = chrome.runtime.connect({ name: 'sidepanel' });
port.onMessage.addListener((message) => {
  if (message.action === 'close') {
    window.close();
  }
});

chrome.tabs.onActivated.addListener(() => {
  updateDynamicBackground();
});

async function updateDynamicBackground() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;
    const activeTab = tabs[0];
    
    let pageColor = null;

    if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('edge://'))) {
      pageColor = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#181a1f' : '#f6f7f9';
    } else if (activeTab.id) {
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          func: () => {
            const bgColor = window.getComputedStyle(document.body).backgroundColor;
            if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') return bgColor;
            
            const htmlColor = window.getComputedStyle(document.documentElement).backgroundColor;
            if (htmlColor && htmlColor !== 'rgba(0, 0, 0, 0)' && htmlColor !== 'transparent') return htmlColor;

            const metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme && metaTheme.content) return metaTheme.content;
            
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? '#181a1f' : '#f6f7f9';
          }
        });
        if (results && results[0] && results[0].result) {
          pageColor = results[0].result;
        }
      } catch (e) {
        // Content script failed, fallback
      }
    }
    
    if (!pageColor) {
      pageColor = window.matchMedia('(prefers-color-scheme: dark)').matches ? '#181a1f' : '#f6f7f9';
    }

    applyColorToSidebar(pageColor);
  } catch (err) {
    console.error('Failed to update dynamic background', err);
  }
}

function applyColorToSidebar(colorStr) {
  const dummy = document.createElement('div');
  dummy.style.color = colorStr;
  document.body.appendChild(dummy);
  const rgbStr = window.getComputedStyle(dummy).color;
  document.body.removeChild(dummy);
  
  const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return;
  
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  
  const rgbColor = `rgb(${r}, ${g}, ${b})`;
  document.documentElement.style.setProperty('--bg-color', rgbColor);
  
  let metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) {
    metaThemeColor = document.createElement('meta');
    metaThemeColor.name = "theme-color";
    document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.content = rgbColor;
  
  const luminance = getLuminance(r, g, b);
  const isDark = luminance < 0.5;
  
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
}

function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
