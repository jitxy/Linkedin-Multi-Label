# Graph Report - .  (2026-07-03)

## Corpus Check
- Corpus is ~14,127 words - fits in a single context window. You may not need a graph.

## Summary
- 221 nodes · 444 edges · 19 communities (18 shown, 1 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 32 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2c776f7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

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
- [[_COMMUNITY_XHR Interceptor|XHR Interceptor]]
- [[_COMMUNITY_Popup Entry Point|Popup Entry Point]]
- [[_COMMUNITY_Community 18|Community 18]]

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
- `Button: Open LinkedIn (Popup)` --semantically_similar_to--> `Footer Button: Open LinkedIn (Side Panel)`  [INFERRED] [semantically similar]
  popup/popup.html → sidepanel/sidepanel.html
- `Button: Open Sales Navigator (Popup)` --semantically_similar_to--> `Footer Button: Open Sales Navigator (Side Panel)`  [INFERRED] [semantically similar]
  popup/popup.html → sidepanel/sidepanel.html
- `mergeConversations()` --calls--> `getConversations()`  [EXTRACTED]
  background/service-worker.js → utils/storage.js
- `mergeConversations()` --calls--> `setConversations()`  [EXTRACTED]
  background/service-worker.js → utils/storage.js
- `reloadConversations()` --calls--> `getConversations()`  [EXTRACTED]
  sidepanel/sidepanel.js → utils/storage.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **LinkedIn Sync Strategy: Three-Tier Fallback Chain (Plan A → B → C)** — sidepanel_sidepanel_sidepanel_plan_a_session_sync, sidepanel_sidepanel_sidepanel_plan_b_passive_sync, sidepanel_sidepanel_sidepanel_plan_c_linkedin_oauth [INFERRED 0.95]
- **Conversation Management Flow: List → Detail → Thread → Compose** — sidepanel_sidepanel_sidepanel_conv_list, sidepanel_sidepanel_sidepanel_conv_detail, sidepanel_sidepanel_sidepanel_message_thread, sidepanel_sidepanel_sidepanel_detail_composer [EXTRACTED 1.00]
- **Label Management System: Filter → Modal → Form** — sidepanel_sidepanel_sidepanel_label_filters, sidepanel_sidepanel_sidepanel_label_modal, sidepanel_sidepanel_sidepanel_label_form [INFERRED 0.85]
- **LinkedIn Multi-Resolution Browser Extension Icon Set** — icons_icon128_linkedin_icon, icons_icon48_linkedin_icon, icons_icon16_linkedin_icon [INFERRED 0.95]

## Communities (19 total, 1 thin omitted)

### Community 0 - "UI & Icons"
Cohesion: 0.17
Nodes (26): autoSync(), buildGraphQLHeaders(), buildRestHeaders(), exchangeLinkedInCode(), fetchConversationMessagesDirect(), fetchLinkedInMessages(), fetchLinkedInMessagesDirect(), fetchLinkedInProfile() (+18 more)

### Community 1 - "Background Sync & OAuth"
Cohesion: 0.08
Nodes (23): action, default_icon, default_title, background, service_worker, type, content_scripts, 128 (+15 more)

### Community 2 - "Extension Manifest"
Cohesion: 0.11
Nodes (23): Conversation Detail View, Conversation List, Message Composer, Label Filter Chips, Label Creation Form, Label Picker Modal, LinkedIn Account / Sync Status Bar, Not-Synced Import Prompt (+15 more)

### Community 3 - "Content Script Voyager API"
Cohesion: 0.19
Nodes (20): buildVoyagerHeaders(), extractMessageText(), fetchConversationMessages(), fetchLinkedInProfile(), fetchSalesNavConversations(), fetchVoyagerConversations(), findMessageInput(), findSendButton() (+12 more)

### Community 4 - "Side Panel State & Labels"
Cohesion: 0.17
Nodes (14): buildLabelRow(), conversations, executeOutreachStep(), LABEL_COLORS, labels, openSequenceIds, outreachSequences, pendingSteps (+6 more)

### Community 5 - "DOM Fallback Scraper"
Cohesion: 0.27
Nodes (14): confirmDeleteLabel(), escapeHtml(), renderLabelModalList(), assignLabel(), createLabel(), deleteLabel(), getConversations(), getLabels() (+6 more)

### Community 6 - "Conversation Detail View"
Cohesion: 0.29
Nodes (12): cleanText(), extractAvatar(), extractName(), extractSnippet(), extractTimestamp(), getConversationRows(), getThreadIdFromUrl(), isMessagingPage() (+4 more)

### Community 7 - "Settings & OAuth Flow"
Cohesion: 0.18
Nodes (13): buildConversationCard(), formatDateSep(), formatMsgTime(), formatTime(), getInitials(), init(), loadConversationMessages(), openConversationDetail() (+5 more)

### Community 8 - "Label Modal & Storage"
Cohesion: 0.33
Nodes (12): connectLinkedInOAuth(), disconnectLinkedInOAuth(), exchangeLinkedInOAuth(), findLinkedInTab(), initSettingsTab(), pingContentScript(), renderOAuthConnected(), sendMessage() (+4 more)

### Community 9 - "Outreach.io Integration"
Cohesion: 0.20
Nodes (10): Button: Open LinkedIn (Popup), Button: Open Sales Navigator (Popup), Button: Open Side Panel, Popup Container, Popup Script (popup.js), App Header with Sync Button, Footer Button: Open LinkedIn (Side Panel), Footer Button: Open Sales Navigator (Side Panel) (+2 more)

### Community 10 - "Fetch Interceptor (Plan B)"
Cohesion: 0.42
Nodes (8): loadOutreachSequences(), apiFetch(), completeTask(), createLinkedInTask(), getPendingLinkedInTasks(), getSequences(), getSequenceSteps(), refreshToken()

### Community 11 - "Outreach Tab Rendering"
Cohesion: 0.39
Nodes (5): extractConversation(), isMessagingUrl(), parseGraphQL(), parseResponse(), parseVoyagerElements()

### Community 12 - "Label CRUD & Modals"
Cohesion: 0.29
Nodes (7): buildSequenceGroup(), buildStepCard(), connectOutreach(), disconnectOutreach(), renderOutreachTab(), renderSequencesList(), setOutreachConfig()

### Community 13 - "Conversation List & Filtering"
Cohesion: 0.33
Nodes (7): closeConversationDetail(), hideLabelForm(), hideLabelModal(), saveLabel(), setupEventListeners(), showLabelAssignDropdown(), showLabelModal()

### Community 14 - "XHR Interceptor"
Cohesion: 0.43
Nodes (7): getFilteredConversations(), reloadConversations(), renderAll(), renderConversationList(), renderFilterChips(), setLabelFilter(), syncLinkedIn()

### Community 15 - "Popup Entry Point"
Cohesion: 0.90
Nodes (5): Browser Extension Icon Set (Multi-Resolution), LinkedIn Extension Icon (128px), LinkedIn Extension Icon (16px), LinkedIn Extension Icon (48px), LinkedIn Brand Identity - Blue Square with White L

## Knowledge Gaps
- **36 isolated node(s):** `manifest_version`, `name`, `version`, `description`, `permissions` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.