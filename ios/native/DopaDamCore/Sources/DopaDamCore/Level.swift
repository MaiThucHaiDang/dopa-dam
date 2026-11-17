import Foundation

/// The part of the settings that decides the friction level.
public struct FrictionSettings: Codable, Equatable, Sendable {
    /// Seconds the "Vào" button stays locked, indexed by level 0...3.
    public var lockSeconds: [Int]
    public var allowOptionsNormal: [Int]
    public var allowOptionsRestricted: [Int]

    public init(lockSeconds: [Int], allowOptionsNormal: [Int], allowOptionsRestricted: [Int]) {
        self.lockSeconds = lockSeconds
        self.allowOptionsNormal = allowOptionsNormal
        self.allowOptionsRestricted = allowOptionsRestricted
    }

    public static let `default` = FrictionSettings(
        lockSeconds: [5, 10, 20, 30], allowOptionsNormal: [5, 15, 30], allowOptionsRestricted: [5, 10])
}

public struct LevelResult: Codable, Equatable, Sendable {
    public var level: Int
    public var lockSeconds: Int
    public var allowOptions: [Int]

    public init(level: Int, lockSeconds: Int, allowOptions: [Int]) {
        self.level = level
        self.lockSeconds = lockSeconds
        self.allowOptions = allowOptions
    }
}

/// Friction level from the number of warnings in the previous hour, study mode and the daily budget;
/// one more (up to 3) inside a risk window.
public func computeLevel(
    n: Int, inStudy: Bool, overBudget: Bool, settings: FrictionSettings, inRisk: Bool = false
) -> LevelResult {
    let base = inStudy || overBudget ? 3 : (n <= 0 ? 0 : (n <= 2 ? 1 : 2))
    let level = inRisk && base < 3 ? base + 1 : base
    let options = level == 3 ? settings.allowOptionsRestricted : settings.allowOptionsNormal
    let lock = level < settings.lockSeconds.count ? settings.lockSeconds[level] : 0
    return LevelResult(level: level, lockSeconds: lock, allowOptions: options)
}

public struct BudgetStatus: Codable, Equatable, Sendable {
    public var over: Bool
    /// nil when the budget is turned off.
    public var remainingMinutes: Double?

    public init(over: Bool, remainingMinutes: Double?) {
        self.over = over
        self.remainingMinutes = remainingMinutes
    }
}

/// A budget <= 0 means the daily budget is turned off.
public func budgetStatus(usedMinutes: Double, budgetMinutes: Double) -> BudgetStatus {
    if budgetMinutes <= 0 { return BudgetStatus(over: false, remainingMinutes: nil) }
    return BudgetStatus(over: usedMinutes >= budgetMinutes, remainingMinutes: max(0, budgetMinutes - usedMinutes))
}
