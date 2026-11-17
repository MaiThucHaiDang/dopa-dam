import Foundation

// MARK: - Number lists

/// "5, 15 30" -> [5, 15, 30]. Commas, semicolons and spaces separate. Nil when a piece is not a whole number
/// (an empty text gives an empty list).
public func parseIntList(_ text: String) -> [Int]? {
    let pieces = text.components(separatedBy: CharacterSet(charactersIn: ",; \t\n")).filter { !$0.isEmpty }
    var out: [Int] = []
    for p in pieces {
        guard let v = Int(p) else { return nil }
        out.append(v)
    }
    return out
}

/// [5, 15, 30] -> "5, 15, 30".
public func formatIntList(_ values: [Int]) -> String { values.map { String($0) }.joined(separator: ", ") }

// MARK: - Settings form

/// Why the settings form cannot become `Settings`; `message` is shown under the form.
public enum SettingsFormError: Error, Equatable, Sendable {
    case lockSeconds(level: Int)
    case normalOptions
    case restrictedOptions
    case budget

    public var message: String {
        switch self {
        case .lockSeconds(let level): return "Số giây khóa ở mức \(level) phải là số từ 0 đến 300."
        case .normalOptions: return "Các lựa chọn phút phải gồm 1 đến 4 số, mỗi số từ 1 đến 120."
        case .restrictedOptions: return "Các lựa chọn phút ở mức 3 phải gồm 1 đến 4 số, mỗi số từ 1 đến 10."
        case .budget: return "Hạn mức mỗi ngày phải là số từ 0 đến 1440 phút (0 là tắt)."
        }
    }
}

/// The settings screen's text fields. Everything is a string while the user types; `settings()` validates.
public struct SettingsForm: Equatable, Sendable {
    /// Exactly four entries, levels 0 to 3.
    public var lockSeconds: [String]
    public var allowNormal: String
    public var allowRestricted: String
    public var budget: String

    public init(lockSeconds: [String], allowNormal: String, allowRestricted: String, budget: String) {
        self.lockSeconds = lockSeconds
        self.allowNormal = allowNormal
        self.allowRestricted = allowRestricted
        self.budget = budget
    }

    public init(settings: Settings) {
        self.lockSeconds = settings.lockSeconds.map { String($0) }
        self.allowNormal = formatIntList(settings.allowOptionsNormal)
        self.allowRestricted = formatIntList(settings.allowOptionsRestricted)
        self.budget = String(settings.budgetMinutes)
    }

    /// Labels of the four lock fields.
    public static let lockLabels = ["Mức 0 (ít mở)", "Mức 1", "Mức 2", "Mức 3 (học hoặc quá hạn mức)"]

    /// Option lists are sorted and de-duplicated, so "15, 5, 5" is the same as "5, 15".
    public func settings() -> Result<Settings, SettingsFormError> {
        var locks: [Int] = []
        for level in 0..<4 {
            let text = level < lockSeconds.count ? lockSeconds[level].trimmingCharacters(in: .whitespacesAndNewlines) : ""
            guard let v = Int(text), (0...300).contains(v) else { return .failure(.lockSeconds(level: level)) }
            locks.append(v)
        }
        guard let normal = Self.options(allowNormal, max: 120) else { return .failure(.normalOptions) }
        guard let restricted = Self.options(allowRestricted, max: 10) else { return .failure(.restrictedOptions) }
        guard let budgetValue = Int(budget.trimmingCharacters(in: .whitespacesAndNewlines)), (0...1440).contains(budgetValue) else {
            return .failure(.budget)
        }
        return .success(Settings(lockSeconds: locks, allowOptionsNormal: normal, allowOptionsRestricted: restricted, budgetMinutes: budgetValue))
    }

    private static func options(_ text: String, max: Int) -> [Int]? {
        guard let list = parseIntList(text) else { return nil }
        let unique = Array(Set(list)).sorted()
        guard (1...4).contains(unique.count), unique.allSatisfy({ (1...max).contains($0) }) else { return nil }
        return unique
    }
}

// MARK: - Study forms

/// The "add a weekly rule" form: days, two times in 5-minute steps and a label.
public struct StudyRuleForm: Equatable, Sendable {
    /// ISO weekdays 1...7.
    public var days: Set<Int>
    public var startMinutes: Int
    public var endMinutes: Int
    public var label: String

    public init(days: Set<Int> = [1, 2, 3, 4, 5], startMinutes: Int = 20 * 60, endMinutes: Int = 22 * 60, label: String = "") {
        self.days = days
        self.startMinutes = startMinutes
        self.endMinutes = endMinutes
        self.label = label
    }

    public var startHour: Int {
        get { startMinutes / 60 }
        set { startMinutes = min(max(newValue, 0), 23) * 60 + startMinutes % 60 }
    }
    public var startMinute: Int {
        get { startMinutes % 60 }
        set { startMinutes = startMinutes / 60 * 60 + min(max(newValue, 0), 59) }
    }
    public var endHour: Int {
        get { endMinutes / 60 }
        set { endMinutes = min(max(newValue, 0), 23) * 60 + endMinutes % 60 }
    }
    public var endMinute: Int {
        get { endMinutes % 60 }
        set { endMinutes = endMinutes / 60 * 60 + min(max(newValue, 0), 59) }
    }

    public mutating func toggle(day: Int) {
        if days.contains(day) { days.remove(day) } else if (1...7).contains(day) { days.insert(day) }
    }

    /// Shown under the form while the rule cannot be saved; nil when it can.
    public var problem: String? {
        if days.isEmpty { return "Chọn ít nhất một ngày." }
        if startMinutes == endMinutes { return "Giờ bắt đầu và giờ kết thúc phải khác nhau." }
        return nil
    }

    /// The rule to give to `StateChange.studyRule` (empty id: a new rule).
    public func rule() -> StudyRule {
        StudyRule(id: "", days: days.sorted(), start: formatHm(startMinutes), end: formatHm(endMinutes), label: label)
    }
}

/// "T2–T6 · 20:00–22:00 · Ôn thi".
public func studyRuleLine(_ rule: StudyRule) -> String {
    var parts = [formatStudyDays(rule.days), Wording.riskRange(start: rule.start, end: rule.end)]
    if let label = rule.label, !label.isEmpty { parts.append(label) }
    return parts.joined(separator: " · ")
}
