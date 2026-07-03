# Graph Report - .  (2026-07-03)

## Corpus Check
- Corpus is ~14,127 words - fits in a single context window. You may not need a graph.

## Summary
- 211 nodes · 429 edges · 16 communities
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 23 edges (avg confidence: 0.6)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_UI & Icons|UI & Icons]]
- [[_COMMUNITY_Background Sync & OAuth|Background Sync & OAuth]]
- [[_COMMUNITY_Extension Manifest|Extension Manifest]]
- [[_COMMUNITY_Content Script Voyager API|Content Script Voyager API]]
- [[_COMMUNITY_Side Panel State & Labels|Side Panel State & Labels]]
- [[_COMMUNITY_DOM Fallback Scraper|DOM Fallback Scraper]]
- [[_COMMUNITY_Conversation Detail View|Conversation Detail View]]
- [[_COMMUNITY_Settings & OAuth Flow|Settings & OAuth Flow]]
- [[_COMMUNITY_Label Modal & Storage|Label Modal & Storage]]
- [[_COMMUNITY_Outreach.io Integration|Outreach.io Integration]]
- [[_COMMUNITY_Fetch Interceptor (Plan B)|Fetch Interceptor (Plan B)]]
- [[_COMMUNITY_Outreach Tab Rendering|Outreach Tab Rendering]]
- [[_COMMUNITY_Label CRUD & Modals|Label CRUD & Modals]]
- [[_COMMUNITY_Conversation List & Filtering|Conversation List & Filtering]]

## God Nodes (most connected - your core abstractions)
1. `sendMessage()` - 14 edges
2. `handleMessage()` - 13 edges
3. `setupEventListeners()` - 13 edges
4. `showToast()` - 11 edges
5. `fetchLinkedInMessagesDirect()` - 10 edges
6. `renderConversationList()` - 9 edges
7. `getConversations()` - 9 edges
8. `initSettingsTab()` - 8 edges
9. `renderAll()` - 7 edges
10. `connectOutreach()` - 7 edges

## Surprising Connections (you probably didn't know these)
- `Popup Header (LinkedIn logo + title v1.0.0)` --conceptually_related_to--> `Blue Square with White L Icon (128px, LinkedIn-style #0A66C2)`  [INFERRED]
  popup/popup.html → icons/icon128.png
- `App Header (logo + sync button)` --conceptually_related_to--> `Blue Square with White L Icon (128px, LinkedIn-style #0A66C2)`  [INFERRED]
  sidepanel/sidepanel.html → icons/icon128.png
- `Open Side Panel Button (primary action)` --references--> `sidepanel/sidepanel.html`  [INFERRED]
  popup/popup.html → sidepanel/sidepanel.html
- `mergeConversations()` --calls--> `getConversations()`  [EXTRACTED]
  background/service-worker.js → utils/storage.js
- `mergeConversations()` --calls--> `setConversations()`  [EXTRACTED]
  background/service-worker.js → utils/storage.js

## Import Cycles
- None detected.

## Communities (16 total, 0 thin omitted)

### Community 0 - "UI & Icons"
Cohesion: 0.08
Nodes (29): icons/icon128.png, Blue Square with White L Icon (128px, LinkedIn-style #0A66C2), icons/icon16.png, Blue Square with White L Icon (16px, LinkedIn-style #0A66C2), icons/icon48.png, Blue Square with White L Icon (48px, LinkedIn-style #0A66C2), popup/popup.html, Open LinkedIn Button (+21 more)

### Community 1 - "Background Sync & OAuth"
Cohesion: 0.17
Nodes (26): autoSync(), buildGraphQLHeaders(), buildRestHeaders(), exchangeLinkedInCode(), fetchConversationMessagesDirect(), fetchLinkedInMessages(), fetchLinkedInMessagesDirect(), fetchLinkedInProfile() (+18 more)

### Community 2 - "Extension Manifest"
Cohesion: 0.08
Nodes (23): action, default_icon, default_title, background, service_worker, type, content_scripts, 128 (+15 more)

### Community 3 - "Content Script Voyager API"
Cohesion: 0.19
Nodes (20): buildVoyagerHeaders(), extractMessageText(), fetchConversationMessages(), fetchLinkedInProfile(), fetchSalesNavConversations(), fetchVoyagerConversations(), findMessageInput(), findSendButton() (+12 more)

### Community 4 - "Side Panel State & Labels"
Cohesion: 0.17
Nodes (15): buildLabelRow(), confirmDeleteLabel(), conversations, escapeHtml(), executeOutreachStep(), LABEL_COLORS, labels, openSequenceIds (+7 more)

### Community 5 - "DOM Fallback Scraper"
Cohesion: 0.29
Nodes (12): cleanText(), extractAvatar(), extractName(), extractSnippet(), extractTimestamp(), getConversationRows(), getThreadIdFromUrl(), isMessagingPage() (+4 more)

### Community 6 - "Conversation Detail View"
Cohesion: 0.18
Nodes (13): buildConversationCard(), formatDateSep(), formatMsgTime(), formatTime(), getInitials(), init(), loadConversationMessages(), openConversationDetail() (+5 more)

### Community 7 - "Settings & OAuth Flow"
Cohesion: 0.29
Nodes (13): connectLinkedInOAuth(), disconnectLinkedInOAuth(), exchangeLinkedInOAuth(), findLinkedInTab(), initSettingsTab(), pingContentScript(), renderOAuthConnected(), sendMessage() (+5 more)

### Community 8 - "Label Modal & Storage"
Cohesion: 0.33
Nodes (12): renderLabelModalList(), assignLabel(), createLabel(), deleteLabel(), getConversations(), getLabels(), getOutreachConfig(), removeLabel() (+4 more)

### Community 9 - "Outreach.io Integration"
Cohesion: 0.42
Nodes (8): loadOutreachSequences(), apiFetch(), completeTask(), createLinkedInTask(), getPendingLinkedInTasks(), getSequences(), getSequenceSteps(), refreshToken()

### Community 10 - "Fetch Interceptor (Plan B)"
Cohesion: 0.39
Nodes (5): extractConversation(), isMessagingUrl(), parseGraphQL(), parseResponse(), parseVoyagerElements()

### Community 11 - "Outreach Tab Rendering"
Cohesion: 0.29
Nodes (7): buildSequenceGroup(), buildStepCard(), connectOutreach(), disconnectOutreach(), renderOutreachTab(), renderSequencesList(), setOutreachConfig()

### Community 12 - "Label CRUD & Modals"
Cohesion: 0.33
Nodes (7): closeConversationDetail(), hideLabelForm(), hideLabelModal(), saveLabel(), setupEventListeners(), showLabelAssignDropdown(), showLabelModal()

### Community 13 - "Conversation List & Filtering"
Cohesion: 0.43
Nodes (7): getFilteredConversations(), reloadConversations(), renderAll(), renderConversationList(), renderFilterChips(), setLabelFilter(), syncLinkedIn()

## Knowledge Gaps
- **35 isolated node(s):** `manifest_version`, `name`, `version`, `description`, `permissions` (+30 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `setOutreachAuth()` connect `Background Sync & OAuth` to `Label Modal & Storage`, `Outreach.io Integration`, `Side Panel State & Labels`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Why does `getConversations()` connect `Label Modal & Storage` to `Background Sync & OAuth`, `Side Panel State & Labels`, `Conversation List & Filtering`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `setConversations()` connect `Label Modal & Storage` to `Background Sync & OAuth`, `Side Panel State & Labels`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **Are the 11 inferred relationships involving `setupEventListeners()` (e.g. with `closeConversationDetail()` and `connectOutreach()`) actually correct?**
  _`setupEventListeners()` has 11 INFERRED edges - model-reasoned connections that need verification._
- **What connects `manifest_version`, `name`, `version` to the rest of the system?**
  _35 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `UI & Icons` be split into smaller, more focused modules?**
  _Cohesion score 0.0812807881773399 - nodes in this community are weakly interconnected._
- **Should `Extension Manifest` be split into smaller, more focused modules?**
  _Cohesion score 0.08333333333333333 - nodes in this community are weakly interconnected._