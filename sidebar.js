document.addEventListener('DOMContentLoaded', () => {
  console.log('Sidebar loaded');
  initBookmarks();
  initTabs();
  initTabsReordering();
  initResizer();
});

function initResizer() {
  const divider = document.getElementById('drag-divider');
  const topSection = document.getElementById('bookmarks-section');
  let isDragging = false;
  
  divider.addEventListener('mousedown', (e) => {
    isDragging = true;
    divider.classList.add('active');
    document.body.style.cursor = 'row-resize';
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
      document.body.style.cursor = '';
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
    return u.origin + u.pathname.replace(/\/$/, '') + u.search + u.hash;
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
  
  const openUrlsMap = new Map();
  tabs.forEach(tab => {
     if (tab.url) openUrlsMap.set(normalizeUrl(tab.url), tab.id);
  });
  
  const data = await chrome.storage.session.get('bookmarkTabs');
  const bookmarkTabsMap = data.bookmarkTabs || {};
  const explicitlyOpenBookmarks = new Map();
  for (const [tabIdStr, bId] of Object.entries(bookmarkTabsMap)) {
      const tabId = parseInt(tabIdStr, 10);
      if (tabs.some(t => t.id === tabId)) {
          explicitlyOpenBookmarks.set(bId, tabId);
      }
  }
  
  const container = document.getElementById('bookmarks-tree');
  container.innerHTML = '';
  const rootNodes = tree[0].children || [];
  rootNodes.forEach(node => {
     container.appendChild(renderBookmarkNode(node, openUrlsMap, explicitlyOpenBookmarks));
  });
}

function renderBookmarkNode(node, openUrlsMap, explicitlyOpenBookmarks) {
  const el = document.createElement('div');
  el.className = 'bookmark-node';
  el.dataset.id = node.id;
  if (node.parentId) el.dataset.parentId = node.parentId;
  if (node.index !== undefined) el.dataset.index = node.index;
  
  let header;
  
  if (node.children) {
    el.classList.add('folder');
    
    header = document.createElement('div');
    header.className = 'item-header';
    header.innerHTML = `
      <span class="icon folder-icon">📁</span>
      <span class="title">${node.title}</span>
    `;
    
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'folder-children';
    node.children.forEach(child => {
      childrenContainer.appendChild(renderBookmarkNode(child, openUrlsMap, explicitlyOpenBookmarks));
    });
    
    header.addEventListener('click', (e) => {
      if (!e.target.closest('.action-btn')) {
        el.classList.toggle('collapsed');
      }
    });
    
    el.appendChild(header);
    el.appendChild(childrenContainer);
  } else {
    el.classList.add('bookmark');
    const normalizedNodeUrl = normalizeUrl(node.url);
    
    let isOpen = false;
    let associatedTabId = null;

    if (explicitlyOpenBookmarks && explicitlyOpenBookmarks.has(node.id)) {
        isOpen = true;
        associatedTabId = explicitlyOpenBookmarks.get(node.id);
    } else if (openUrlsMap && openUrlsMap.has(normalizedNodeUrl)) {
        isOpen = true;
        associatedTabId = openUrlsMap.get(normalizedNodeUrl);
    }

    const btnIcon = isOpen ? '✕' : '−';
    const btnTitle = isOpen ? '关闭标签页' : '删除书签';
    
    header = document.createElement('div');
    header.className = 'item-header';
    header.innerHTML = `
      <img class="icon" src="${getFaviconUrl(node.url)}" alt="" />
      <span class="title">${node.title}</span>
      <div class="action-btn" title="${btnTitle}">${btnIcon}</div>
    `;
    
    header.addEventListener('click', async (e) => {
       if (e.target.closest('.action-btn')) return;
       
       if (isOpen && associatedTabId) {
          // Bookmark is already open somewhere, just switch to it
          chrome.tabs.update(associatedTabId, { active: true }).catch(() => {});
       } else {
          // Bookmark is not open, open a new tab or reuse empty newtab
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
              initTabs();
              initBookmarks();
          }
       }
    });

    const actionBtn = header.querySelector('.action-btn');
    actionBtn.addEventListener('click', async (e) => {
       e.stopPropagation();
       if (isOpen) {
         if (associatedTabId) chrome.tabs.remove(associatedTabId).catch(() => {});
       } else {
         chrome.bookmarks.remove(node.id).catch(() => {});
       }
    });
    
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

  return el;
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
  
  const data = await chrome.storage.session.get('bookmarkTabs');
  const bookmarkTabsMap = data.bookmarkTabs || {};

  const container = document.getElementById('tabs-list');
  container.innerHTML = '';
  
  tabs.forEach(tab => {
     if (bookmarkTabsMap[tab.id]) {
        return; // Exclude because it was explicitly launched from a bookmark
     }

     if (tab.url) {
        if (!bookmarkUrls.has(normalizeUrl(tab.url))) {
           container.appendChild(renderTabNode(tab));
        }
     } else {
        container.appendChild(renderTabNode(tab));
     }
  });
}

function renderTabNode(tab) {
  const el = document.createElement('div');
  el.className = 'tab-node';
  el.draggable = true;
  el.dataset.tabId = tab.id;
  
  el.innerHTML = `
    <img class="icon" src="${tab.favIconUrl || getFaviconUrl(tab.url)}" alt="" />
    <span class="title">${tab.title}</span>
    <div class="action-btn" title="关闭标签页">✕</div>
  `;
  
  el.addEventListener('click', (e) => {
    if (e.target.closest('.action-btn')) return;
    chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  });

  const actionBtn = el.querySelector('.action-btn');
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
chrome.tabs.onCreated.addListener(initTabs);
chrome.tabs.onUpdated.addListener(initTabs);
chrome.tabs.onRemoved.addListener(async (tabId) => {
   const data = await chrome.storage.session.get('bookmarkTabs');
   if (data.bookmarkTabs && data.bookmarkTabs[tabId]) {
      delete data.bookmarkTabs[tabId];
      await chrome.storage.session.set({ bookmarkTabs: data.bookmarkTabs });
   }
   initTabs();
   initBookmarks();
});

chrome.bookmarks.onCreated.addListener(() => { initBookmarks(); initTabs(); });
chrome.bookmarks.onRemoved.addListener(() => { initBookmarks(); initTabs(); });
chrome.bookmarks.onChanged.addListener(initBookmarks);
chrome.bookmarks.onMoved.addListener(initBookmarks);
chrome.bookmarks.onChildrenReordered.addListener(initBookmarks);
