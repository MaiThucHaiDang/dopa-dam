import XCTest
@testable import DopaDamCore

/// Runs the shared vectors (shared/test-vectors) against the Swift core. Not needed on iPhone, so not run:
/// allow-url.json, domain.json, delay.json.
final class VectorTests: XCTestCase {
    // MARK: level.json

    struct LevelInput: Decodable { var n: Int; var inStudy: Bool; var overBudget: Bool; var inRisk: Bool? }
    struct LevelCase: Decodable { var name: String; var settings: FrictionSettings?; var input: LevelInput; var expected: LevelResult }
    struct LevelFile: Decodable { var defaultSettings: FrictionSettings; var cases: [LevelCase] }

    func testLevel() throws {
        let v: LevelFile = try Vectors.load("level.json")
        XCTAssertFalse(v.cases.isEmpty)
        for c in v.cases {
            let r = computeLevel(n: c.input.n, inStudy: c.input.inStudy, overBudget: c.input.overBudget,
                                 settings: c.settings ?? v.defaultSettings, inRisk: c.input.inRisk ?? false)
            XCTAssertEqual(r, c.expected, c.name)
        }
    }

    // MARK: recent-count.json

    struct RecentCase: Decodable { var name: String; var now: Int64; var timestamps: [Int64]; var expected: Int }
    struct RecentFile: Decodable { var cases: [RecentCase] }

    func testRecentCount() throws {
        let v: RecentFile = try Vectors.load("recent-count.json")
        XCTAssertFalse(v.cases.isEmpty)
        for c in v.cases { XCTAssertEqual(recentCount(c.timestamps, now: c.now), c.expected, c.name) }
    }

    // MARK: day-key.json

    struct DayKeyCase: Decodable { var name: String; var t: Int64; var tzOffsetMinutes: Int; var expected: String }
    struct DayKeyFile: Decodable { var cases: [DayKeyCase] }

    func testDayKey() throws {
        let v: DayKeyFile = try Vectors.load("day-key.json")
        XCTAssertFalse(v.cases.isEmpty)
        for c in v.cases { XCTAssertEqual(dayKey(c.t, tzOffsetMinutes: c.tzOffsetMinutes), c.expected, c.name) }
    }

    // MARK: budget.json

    struct BudgetCase: Decodable { var name: String; var usedMinutes: Double; var budgetMinutes: Double; var expected: BudgetStatus }
    struct BudgetFile: Decodable { var cases: [BudgetCase] }

    func testBudget() throws {
        let v: BudgetFile = try Vectors.load("budget.json")
        XCTAssertFalse(v.cases.isEmpty)
        for c in v.cases {
            XCTAssertEqual(budgetStatus(usedMinutes: c.usedMinutes, budgetMinutes: c.budgetMinutes), c.expected, c.name)
        }
    }

    // MARK: friction.json

    struct TagCase: Decodable { var old: String?; var new: String?; var expected: ChangeKind }
    struct NumberCase: Decodable { var field: NumberField; var old: Int; var new: Int; var expected: ChangeKind }
    struct FrictionFile: Decodable { var tagCases: [TagCase]; var numberCases: [NumberCase] }

    func testFriction() throws {
        let v: FrictionFile = try Vectors.load("friction.json")
        XCTAssertFalse(v.tagCases.isEmpty)
        XCTAssertFalse(v.numberCases.isEmpty)
        for c in v.tagCases {
            let old = c.old.flatMap { Tag(rawValue: $0) }, new = c.new.flatMap { Tag(rawValue: $0) }
            XCTAssertEqual(c.old == nil, old == nil)
            XCTAssertEqual(c.new == nil, new == nil)
            XCTAssertEqual(classifyTagChange(old: old, new: new), c.expected, "tag \(c.old ?? "nil") -> \(c.new ?? "nil")")
        }
        for c in v.numberCases {
            XCTAssertEqual(classifyNumberChange(field: c.field, old: c.old, new: c.new), c.expected, "\(c.field) \(c.old) -> \(c.new)")
        }
    }

    func testConfirmPhrase() {
        XCTAssertEqual(confirmPhrase, "tôi chọn giảm bảo vệ")
        XCTAssertEqual(confirmWaitSeconds, 60)
        for ok in ["tôi chọn giảm bảo vệ", "  Tôi Chọn GIẢM bảo vệ ", "tôi  chọn\tgiảm\nbảo vệ",
                   // the same sentence typed with decomposed (NFD) accents
                   "to\u{0302}i cho\u{0323}n gia\u{0309}m ba\u{0309}o ve\u{0323}\u{0302}"] {
            XCTAssertTrue(isConfirmPhrase(ok), ok)
        }
        for bad in ["", "tôi chọn giảm bảo", "toi chon giam bao ve", "tôi chọn giảm bảo vệ!", "tôi chọn giảmbảo vệ"] {
            XCTAssertFalse(isConfirmPhrase(bad), bad)
        }
    }

    // MARK: study.json

    struct StudyCase: Decodable {
        var name: String; var now: Int64; var tzOffsetMinutes: Int
        var manual: [String]; var external: [String]; var rules: [String]; var expected: StudyStatus
    }
    struct StudyFile: Decodable { var rules: [String: StudyRule]; var sessions: [String: Session]; var cases: [StudyCase] }

    func testStudy() throws {
        let v: StudyFile = try Vectors.load("study.json")
        XCTAssertFalse(v.cases.isEmpty)
        for c in v.cases {
            let r = resolveStudy(now: c.now, tzOffsetMinutes: c.tzOffsetMinutes, manual: c.manual.map { v.sessions[$0]! },
                                 rules: c.rules.map { v.rules[$0]! }, external: c.external.map { v.sessions[$0]! })
            XCTAssertEqual(r, c.expected, c.name)
        }
    }

    // MARK: study-change.json

    struct ChangeCase: Decodable { var name: String; var now: Int64; var tzOffsetMinutes: Int; var old: String?; var new: String?; var expected: ChangeKind }
    struct ActiveCase: Decodable { var name: String; var now: Int64; var tzOffsetMinutes: Int; var rules: [String]; var expected: [RuleOccurrence] }
    struct StudyChangeFile: Decodable { var rules: [String: StudyRule]; var changeCases: [ChangeCase]; var activeCases: [ActiveCase] }

    func testStudyChange() throws {
        let v: StudyChangeFile = try Vectors.load("study-change.json")
        XCTAssertFalse(v.changeCases.isEmpty)
        XCTAssertFalse(v.activeCases.isEmpty)
        for c in v.changeCases {
            let r = classifyStudyRuleChange(old: c.old.map { v.rules[$0]! }, new: c.new.map { v.rules[$0]! }, now: c.now, tzOffsetMinutes: c.tzOffsetMinutes)
            XCTAssertEqual(r, c.expected, c.name)
        }
        for c in v.activeCases {
            XCTAssertEqual(activeRuleOccurrences(c.rules.map { v.rules[$0]! }, now: c.now, tzOffsetMinutes: c.tzOffsetMinutes), c.expected, c.name)
        }
    }

    // MARK: risk.json

    struct Sparse: Codable, Equatable { var row: Int; var hour: Int; var opens: Int; var enters: Int }
    struct RiskConstants: Decodable { var maxWindows: Int; var minOpens: Int; var blockHours: Int }
    struct InRiskInput: Decodable { var windows: [RiskWindow]; var now: Int64; var tzOffsetMinutes: Int }
    struct InRiskCase: Decodable { var name: String; var input: InRiskInput; var expected: Bool }
    struct HeatInput: Decodable { var events: [RiskEvent]; var now: Int64; var tzOffsetMinutes: Int; var days: Int }
    struct HeatCase: Decodable { var name: String; var input: HeatInput; var expected: [Sparse] }
    struct SuggestInput: Decodable { var cells: [Sparse]; var windows: [RiskWindow] }
    struct SuggestCase: Decodable { var name: String; var input: SuggestInput; var expected: RiskSuggestion? }
    struct ClassifyInput: Decodable { var old: [RiskWindow]; var new: [RiskWindow] }
    struct ClassifyCase: Decodable { var name: String; var input: ClassifyInput; var expected: ChangeKind }
    struct NormalizeCase: Decodable { var name: String; var input: RiskWindow; var expected: RiskWindow? }
    struct RiskFile: Decodable {
        var constants: RiskConstants
        var inRiskWindow: [InRiskCase]; var heatmap: [HeatCase]; var suggest: [SuggestCase]
        var classify: [ClassifyCase]; var normalize: [NormalizeCase]
        var describeDays: [DescribeDaysCase]; var describeWindow: [DescribeWindowCase]; var describeSuggestion: [DescribeSuggestionCase]
        var describeHeatCell: [DescribeHeatCellCase]; var describeRemoval: [DescribeWindowCase]
    }
    struct HeatCellInput: Decodable { var row: Int; var hour: Int; var opens: Int; var enters: Int }
    struct DescribeHeatCellCase: Decodable { var name: String; var input: HeatCellInput; var expected: String }
    struct DescribeDaysCase: Decodable { var name: String; var input: [Int]; var expected: String }
    struct DescribeWindowCase: Decodable { var name: String; var input: RiskWindow; var expected: String }
    struct DescribeSuggestionCase: Decodable { var name: String; var input: RiskSuggestion; var expected: String }

    private func toGrid(_ cells: [Sparse]) -> RiskHeatmap {
        var grid = emptyHeatmap()
        for c in cells { grid[c.row][c.hour] = RiskCell(opens: c.opens, enters: c.enters) }
        return grid
    }

    private func toSparse(_ grid: RiskHeatmap) -> [Sparse] {
        var out: [Sparse] = []
        for (row, cells) in grid.enumerated() {
            for (hour, c) in cells.enumerated() where c.opens > 0 || c.enters > 0 {
                out.append(Sparse(row: row, hour: hour, opens: c.opens, enters: c.enters))
            }
        }
        return out
    }

    func testRisk() throws {
        let v: RiskFile = try Vectors.load("risk.json")
        XCTAssertEqual(maxRiskWindows, v.constants.maxWindows)
        XCTAssertEqual(riskMinOpens, v.constants.minOpens)
        XCTAssertEqual(riskBlockHours, v.constants.blockHours)
        XCTAssertFalse(v.inRiskWindow.isEmpty)
        XCTAssertFalse(v.heatmap.isEmpty)
        XCTAssertFalse(v.suggest.isEmpty)
        XCTAssertFalse(v.classify.isEmpty)
        XCTAssertFalse(v.normalize.isEmpty)
        for c in v.inRiskWindow {
            XCTAssertEqual(inRiskWindow(c.input.windows, now: c.input.now, tzOffsetMinutes: c.input.tzOffsetMinutes), c.expected, "inRiskWindow: \(c.name)")
        }
        for c in v.heatmap {
            let grid = riskHeatmap(events: c.input.events, now: c.input.now, tzOffsetMinutes: c.input.tzOffsetMinutes, days: c.input.days)
            XCTAssertEqual(grid.count, 7, c.name)
            XCTAssertTrue(grid.allSatisfy { $0.count == 24 }, c.name)
            XCTAssertEqual(toSparse(grid), c.expected, "heatmap: \(c.name)")
        }
        for c in v.suggest {
            XCTAssertEqual(suggestRiskWindow(cells: toGrid(c.input.cells), existing: c.input.windows), c.expected, "suggest: \(c.name)")
        }
        for c in v.classify {
            XCTAssertEqual(classifyRiskWindowsChange(old: c.input.old, new: c.input.new), c.expected, "classify: \(c.name)")
        }
        for c in v.normalize {
            XCTAssertEqual(normalizeRiskWindow(c.input), c.expected, "normalize: \(c.name)")
        }
        XCTAssertGreaterThan(v.describeDays.count, 10)
        XCTAssertGreaterThan(v.describeWindow.count, 5)
        XCTAssertGreaterThan(v.describeSuggestion.count, 3)
        for c in v.describeDays { XCTAssertEqual(Wording.riskDays(c.input), c.expected, "describeDays: \(c.name)") }
        for c in v.describeWindow { XCTAssertEqual(Wording.riskWindowLine(c.input), c.expected, "describeWindow: \(c.name)") }
        for c in v.describeSuggestion { XCTAssertEqual(Wording.riskSuggestionLine(c.input), c.expected, "describeSuggestion: \(c.name)") }
        XCTAssertGreaterThan(v.describeHeatCell.count, 3)
        XCTAssertGreaterThan(v.describeRemoval.count, 3)
        for c in v.describeHeatCell {
            let cell = RiskCell(opens: c.input.opens, enters: c.input.enters)
            XCTAssertEqual(Wording.riskCellLabel(row: c.input.row, hour: c.input.hour, cell: cell), c.expected, "describeHeatCell: \(c.name)")
        }
        for c in v.describeRemoval { XCTAssertEqual(Wording.riskRemovalConfirm(c.input), c.expected, "describeRemoval: \(c.name)") }
    }
}
