import Foundation

public enum SkynetChatTransportEvent: Sendable {
    case health(ok: Bool)
    case tick
    case chat(SkynetChatEventPayload)
    case agent(SkynetAgentEventPayload)
    case seqGap
}

public protocol SkynetChatTransport: Sendable {
    func requestHistory(sessionKey: String) async throws -> SkynetChatHistoryPayload
    func sendMessage(
        sessionKey: String,
        message: String,
        thinking: String,
        idempotencyKey: String,
        attachments: [SkynetChatAttachmentPayload]) async throws -> SkynetChatSendResponse

    func abortRun(sessionKey: String, runId: String) async throws
    func listSessions(limit: Int?) async throws -> SkynetChatSessionsListResponse

    func requestHealth(timeoutMs: Int) async throws -> Bool
    func events() -> AsyncStream<SkynetChatTransportEvent>

    func setActiveSessionKey(_ sessionKey: String) async throws
}

extension SkynetChatTransport {
    public func setActiveSessionKey(_: String) async throws {}

    public func abortRun(sessionKey _: String, runId _: String) async throws {
        throw NSError(
            domain: "SkynetChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "chat.abort not supported by this transport"])
    }

    public func listSessions(limit _: Int?) async throws -> SkynetChatSessionsListResponse {
        throw NSError(
            domain: "SkynetChatTransport",
            code: 0,
            userInfo: [NSLocalizedDescriptionKey: "sessions.list not supported by this transport"])
    }
}
