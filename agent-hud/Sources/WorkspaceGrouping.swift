import Foundation

// MARK: - Workspace grouping
//
// Pure presentation logic shared by the vertical column and the top strip, and
// covered by `Tests/HUDCoreTests.swift`.

/// One workspace's agents, in board order.
struct WorkspaceGroup: Identifiable {
    let workspace: String
    var rows: [AgentRow]
    var id: String { workspace }
}

enum WorkspaceGrouping {
    /// Label for agents that have no Herdr workspace; a fallback bucket.
    static let noWorkspaceLabel = "其他"

    /// Group rows by workspace label, preserving the within-group order from
    /// the board (most recently active first). Agents without a workspace are a
    /// fallback bucket and always come last, however recent they are.
    static func groups(from rows: [AgentRow]) -> [WorkspaceGroup] {
        var groups: [WorkspaceGroup] = []
        var index: [String: Int] = [:]
        for row in rows {
            let key = row.workspace ?? noWorkspaceLabel
            if let i = index[key] {
                groups[i].rows.append(row)
            } else {
                index[key] = groups.count
                groups.append(WorkspaceGroup(workspace: key, rows: [row]))
            }
        }
        // Groups appear in activity order, so the fallback bucket can land
        // anywhere; move it to the end where it belongs.
        if let fallback = groups.firstIndex(where: { $0.workspace == noWorkspaceLabel }),
           fallback != groups.count - 1 {
            groups.append(groups.remove(at: fallback))
        }
        return groups
    }
}
