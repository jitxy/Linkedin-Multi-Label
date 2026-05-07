document.getElementById('btn-open-sidepanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    // Must enable the panel for the tab before calling open()
    await chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: 'sidepanel/sidepanel.html',
      enabled: true,
    });
    await chrome.sidePanel.open({ tabId: tab.id });
  } else {
    await chrome.tabs.create({ url: 'https://www.linkedin.com/messaging/' });
  }
  window.close();
});

document.getElementById('btn-open-linkedin').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_LINKEDIN' });
  window.close();
});

document.getElementById('btn-open-salesnav').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'OPEN_SALES_NAV' });
  window.close();
});

// Prevent navigation for the issues link (it's a placeholder)
document.getElementById('link-issues').addEventListener('click', (e) => {
  e.preventDefault();
});
