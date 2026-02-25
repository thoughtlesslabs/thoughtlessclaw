import Foundation

public enum SkynetCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum SkynetCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum SkynetCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum SkynetCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct SkynetCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: SkynetCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: SkynetCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: SkynetCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: SkynetCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct SkynetCameraClipParams: Codable, Sendable, Equatable {
    public var facing: SkynetCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: SkynetCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: SkynetCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: SkynetCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
