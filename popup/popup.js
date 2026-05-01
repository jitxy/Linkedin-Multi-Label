document.getElementById('btn-open-sidepanel').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    await chrome.sidePanel.open({ tabId: tab.id });
  } else {
    // No active tab — open LinkedIn first
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
