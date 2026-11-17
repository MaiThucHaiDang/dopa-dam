import Foundation

public enum ChangeKind: String, Codable, Equatable, Sendable { case weaken, ok }

/// Tags exist on the other clients; iPhone has none (an app is guarded because the user made an automation
/// for it). Kept so that the shared `friction.json` tag vectors run against the same rule.
public enum Tag: String, Codable, CaseIterable, Sendable {
    case entertainment, game, work, study, communication, utility, ignore

    public var isBlocked: Bool { self == .entertainment || self == .game }
}

public enum NumberField: String, Codable, Sendable { case lockSeconds, budgetMinutes, delaySeconds }

/// Untagging entertainment/game, or moving entertainment to game (which adds a delay), weakens protection.
public func classifyTagChange(old: Tag?, new: Tag?) -> ChangeKind {
    if (old?.isBlocked ?? false) && !(new?.isBlocked ?? false) { return .weaken }
    if old == .entertainment && new == .game { return .weaken }
    return .ok
}

public func classifyNumberChange(field: NumberField, old: Int, new: Int) -> ChangeKind {
    switch field {
    case .lockSeconds:
        return new < old ? .weaken : .ok
    case .budgetMinutes:
        if old <= 0 { return .ok }
        return new <= 0 || new > old ? .weaken : .ok
    case .delaySeconds:
        return new > old ? .weaken : .ok
    }
}

/// The sentence the user types to confirm a weakening change (after waiting `confirmWaitSeconds`).
public let confirmPhrase = "tôi chọn giảm bảo vệ"
public let confirmWaitSeconds = 60

/// True when `input` is the confirmation phrase: Unicode NFC, trimmed, lower case, runs of spaces collapsed.
public func isConfirmPhrase(_ input: String) -> Bool {
    let words = input.precomposedStringWithCanonicalMapping.lowercased()
        .components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }
    return words.joined(separator: " ") == confirmPhrase
}
