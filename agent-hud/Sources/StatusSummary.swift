import Foundation

// MARK: - Status summary
//
// Which status counts the header and the folded tab show, and in what order.
// Kept out of the views so `Tests/main.swift` can cover the rule.

/// One status a count can be shown for, in display order.
enum StatusCount: String, CaseIterable, Identifiable {
    case blocked
    case working
    case done
    case idle

    var id: String { rawValue }

    func value(in counts: Counts) -> Int {
        switch self {
        case .blocked: return counts.blocked
        case .working: return counts.working
        case .done: return counts.done
        case .idle: return counts.idle
        }
    }
}

enum StatusSummary {
    /// Blocked, working, done, idle. Working is always listed, even at zero, so
    /// the header and the folded tab never read as empty; the others appear only
    /// when they have a non-zero count.
    static func visible(in counts: Counts) -> [StatusCount] {
        StatusCount.allCases.filter { $0 == .working || $0.value(in: counts) > 0 }
    }
}
