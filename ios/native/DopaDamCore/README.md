# DopaDamCore

The pure Swift core of the native iPhone app. Foundation only (no UIKit, SwiftUI, Combine, os, CryptoKit), so it
builds and is tested on Linux and in Xcode (iOS 17 / macOS 13, swift-tools-version 5.9, no dependencies).
Everything that can be decided without a screen is decided here: the shared rules, the state machine, the
Vietnamese wording the clients share, and the read models the views display. Views only draw.

Every function takes the time explicitly: `now` is milliseconds since 1970 (`Int64`) and `tz` is the time-zone
offset in minutes east of UTC (`Int`; `currentTzOffsetMinutes(at:)` gives the device's). Nothing reads the clock.

## Public API by area

- **Shared rules** (`Level`, `Friction`, `Study`, `Risk`, `Progress`, `Time`): `computeLevel`, `recentCount`,
  `dayKey` (04:00 boundary), `budgetStatus`, `classifyNumberChange`, `classifyTagChange`, `isConfirmPhrase`,
  `confirmPhrase`, `resolveStudy` / `resolveSources`, `ruleOccurrences`, `activeRuleOccurrences`,
  `classifyStudyRuleChange`, `normalizeStudyRule`, `truncateStudyLabel` (60 code points), `normalizeRiskWindow`,
  `inRiskWindow`, `riskHeatmap`, `suggestRiskWindow`, `classifyRiskWindowsChange`, `weeklyProgress`.
- **State**: `AppState` (Codable, tolerant decoding), `Settings`, `WarningEvent`, `AllowWindow`, `Session`,
  `StudyRule`, `RiskWindow`; errors are `CoreError` (`needsConfirm`, `studyLocked`, `invalid`, `locked`,
  `notFound`, `alreadyDecided`) with a Vietnamese `message`. Operations return `Result<_, CoreError>`.
- **Warning flow** (methods on `AppState`): `shouldAsk(app:now:)`, `recordWarning(app:now:tz:id:)` →
  `WarningContext`, `warningContext(eventId:now:tz:)`, `decide(eventId:choice:now:tz:)` with
  `Choice.exit / .enter(minutes:) / .alternative(activity:minutes:)`, `autoExit`, `pendingWarnings`,
  `closeAbandoned`, `allowWindowEnd`, `allowNotifications`, `activeAllowWindows`.
- **Study / settings / risk / log**: `startStudy`, `stopStudy`, `setStudyRule`, `deleteStudyRule`, `setSettings`,
  `settingsChange(to:)`, `setRiskWindows`, `riskSuggestion`, `clearLog`, `prune`. A weakening change returns
  `.needsConfirm`; the UI runs the confirmation (`confirmWaitSeconds` wait, typed `confirmPhrase`, checked with
  `isConfirmPhrase`) and calls again with `confirmed: true`. During study they return `.studyLocked`.
- **Read models**: `todaySummary`, `weeklyProgressCard`, `dayStats`, `appsSeen`, `riskCard`.
- **Wording**: every shared Vietnamese sentence is a constant or function of `Wording`.
- **Persistence**: `StateStore` protocol, `FileStateStore(url:)` (atomic write; a missing or corrupt file gives
  a fresh state, a corrupt file is moved to `<name>.bad`), `MemoryStateStore`, and
  `store.update { state in ... }` (load, apply, save).

## Tests

```
cd ios/native/DopaDamCore
swift build && swift test
```

The shared vectors are found from the test file's path (`#filePath`, up to `<repo>/shared/test-vectors`);
set `DOPADAM_VECTORS` to point elsewhere. Covered, every case run and none skipped: `level.json`,
`recent-count.json`, `day-key.json`, `budget.json`, `friction.json` (tag and number cases),
`study.json`, `study-change.json`, `risk.json`. Not needed on iPhone (there are no domains, allowed links or
per-tag delays) and not run: `allow-url.json`, `domain.json`, `delay.json`. The logic tests port
`extension/test/logic.test.ts`, `progress.test.ts` and `risk.test.ts` to the operations above, and add
store and tolerant-decoding tests.
