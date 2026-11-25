import Foundation

// MARK: - Wire types

struct RawAgent {
    let paneId: String
    let kind: String
    let status: String
    let cwd: String?
    let title: String?
    let sessionId: String?
    let workspaceId: String?
    /// Monotonic per-machine sequence of the last state change (Herdr ordering hint).
    let stateChangeSeq: Int
    /// Per-pane content revision; changing between polls means the agent was active.
    let revision: Int
}

struct Snapshot {
    let version: String?
    let protocolVersion: Int?
    let agents: [RawAgent]
    let workspaces: [String: String]
    let tabs: [String: String]
}

enum HerdrFailure: Error, CustomStringConvertible {
    case transport(String)
    case server(code: String, message: String)
    case badResponse(String)

    var description: String {
        switch self {
        case .transport(let message): return message
        case .server(let code, let message): return "\(code): \(message)"
        case .badResponse(let message): return message
        }
    }

    var code: String {
        switch self {
        case .transport: return "transport"
        case .server(let code, _): return code
        case .badResponse: return "bad-response"
        }
    }
}

// MARK: - Snapshot parsing

func parseSnapshot(_ data: Data) throws -> Snapshot {
    guard !data.isEmpty else { throw HerdrFailure.badResponse("empty herdr response") }
    guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        throw HerdrFailure.badResponse("herdr response was not JSON")
    }
    let result = root["result"] as? [String: Any] ?? [:]
    guard let snapshot = result["snapshot"] as? [String: Any] else {
        throw HerdrFailure.badResponse("herdr response has no snapshot")
    }
    var workspaces: [String: String] = [:]
    for workspace in snapshot["workspaces"] as? [[String: Any]] ?? [] {
        if let id = workspace["workspace_id"] as? String, let label = workspace["label"] as? String {
            workspaces[id] = label
        }
    }
    var tabs: [String: String] = [:]
    for tab in snapshot["tabs"] as? [[String: Any]] ?? [] {
        if let id = tab["tab_id"] as? String, let label = tab["label"] as? String {
            tabs[id] = label
        }
    }
    var agents: [RawAgent] = []
    for agent in snapshot["agents"] as? [[String: Any]] ?? [] {
        let paneId = agent["pane_id"] as? String ?? ""
        guard !paneId.isEmpty else { continue }
        let sessionId = (agent["agent_session"] as? [String: Any])?["value"] as? String
        let title = (agent["terminal_title_stripped"] as? String)
            ?? (agent["terminal_title"] as? String)
        agents.append(
            RawAgent(
                paneId: paneId,
                kind: agent["agent"] as? String ?? "unknown",
                status: agent["agent_status"] as? String ?? "unknown",
                cwd: agent["cwd"] as? String,
                title: title,
                sessionId: sessionId,
                workspaceId: agent["workspace_id"] as? String,
                stateChangeSeq: agent["state_change_seq"] as? Int ?? 0,
                revision: agent["revision"] as? Int ?? 0
            )
        )
    }
    return Snapshot(
        version: snapshot["version"] as? String,
        protocolVersion: snapshot["protocol"] as? Int,
        agents: agents,
        workspaces: workspaces,
        tabs: tabs
    )
}

// MARK: - Local socket client

final class HerdrSocket {
    private let path: String

    init(path: String = HUDPaths.herdrSocket) {
        self.path = path
    }

    var socketPath: String { path }

    func snapshot() throws -> Snapshot {
        let result = try call("session.snapshot", [:], timeout: 4)
        let data = try JSONSerialization.data(withJSONObject: ["result": result])
        return try parseSnapshot(data)
    }

    private func call(
        _ method: String,
        _ params: [String: Any],
        timeout: TimeInterval
    ) throws -> [String: Any] {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else {
            throw HerdrFailure.transport("socket(): \(String(cString: strerror(errno)))")
        }
        defer { close(fd) }

        var address = sockaddr_un()
        address.sun_family = sa_family_t(AF_UNIX)
        let maxPath = MemoryLayout.size(ofValue: address.sun_path) - 1
        let pathBytes = Array(path.utf8)
        guard pathBytes.count <= maxPath else {
            throw HerdrFailure.transport("herdr socket path is too long")
        }
        withUnsafeMutablePointer(to: &address.sun_path) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: maxPath + 1) { destination in
                for (index, byte) in pathBytes.enumerated() {
                    destination[index] = CChar(bitPattern: byte)
                }
                destination[pathBytes.count] = 0
            }
        }
        let size = socklen_t(MemoryLayout<sockaddr_un>.size)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { raw in
                connect(fd, raw, size)
            }
        }
        guard connected == 0 else {
            throw HerdrFailure.transport("connect \(path): \(String(cString: strerror(errno)))")
        }

        var timeoutValue = timeval(tv_sec: Int(timeout), tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeoutValue, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeoutValue, socklen_t(MemoryLayout<timeval>.size))

        let requestId = "hud-\(UUID().uuidString)"
        let payload: [String: Any] = ["id": requestId, "method": method, "params": params]
        var request = try JSONSerialization.data(withJSONObject: payload)
        request.append(0x0A)

        var written = 0
        request.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else { return }
            while written < request.count {
                let count = write(fd, base.advanced(by: written), request.count - written)
                if count <= 0 { break }
                written += count
            }
        }
        guard written == request.count else {
            throw HerdrFailure.transport("herdr socket write failed")
        }

        var buffer = [UInt8]()
        var chunk = [UInt8](repeating: 0, count: 65536)
        var sawNewline = false
        while !sawNewline {
            var count = 0
            chunk.withUnsafeMutableBytes { raw in
                count = read(fd, raw.baseAddress, raw.count)
            }
            if count <= 0 { break }
            buffer.append(contentsOf: chunk[0..<count])
            if buffer.contains(0x0A) { sawNewline = true }
        }
        guard let newline = buffer.firstIndex(of: 0x0A) else {
            throw HerdrFailure.transport("herdr did not answer (is the server running?)")
        }
        let body = Data(buffer[0..<newline])
        guard let root = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            throw HerdrFailure.badResponse("herdr sent a non-JSON response")
        }
        if let error = root["error"] as? [String: Any] {
            throw HerdrFailure.server(
                code: error["code"] as? String ?? "herdr-error",
                message: error["message"] as? String ?? "herdr request failed"
            )
        }
        return root["result"] as? [String: Any] ?? [:]
    }
}

// MARK: - Remote machine client (local herdr CLI forwarding)

final class HerdrMachineClient {
    let label: String
    private let binary: String

    init(label: String, binary: String = HUDPaths.resolveHerdrBinary()) {
        self.label = label
        self.binary = binary
    }

    func snapshot() throws -> Snapshot {
        let result = try ProcessRunner.run(
            binary,
            ["--machine", label, "api", "snapshot"],
            timeout: 20
        )
        guard result.status == 0 else {
            throw Self.failure(from: result)
        }
        return try parseSnapshot(result.stdout)
    }

    func focus(_ paneId: String) {
        _ = try? ProcessRunner.run(
            binary,
            ["--machine", label, "agent", "focus", paneId],
            timeout: 8
        )
    }

    func focusLocal(_ paneId: String) {
        _ = try? ProcessRunner.run(
            binary,
            ["agent", "focus", paneId],
            timeout: 8
        )
    }

    private static func failure(from result: ProcessResult) -> HerdrFailure {
        let text = result.stderrText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let data = text.data(using: .utf8),
           let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let error = root["error"] as? [String: Any] {
            return .server(
                code: error["code"] as? String ?? "herdr-cli-error",
                message: error["message"] as? String ?? "herdr command failed"
            )
        }
        let firstLine = text.split(separator: "\n").first.map(String.init) ?? "herdr command failed"
        return .transport(String(firstLine.prefix(240)))
    }
}
