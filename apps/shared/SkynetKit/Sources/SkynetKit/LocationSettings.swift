import Foundation

public enum SkynetLocationMode: String, Codable, Sendable, CaseIterable {
    case off
    case whileUsing
    case always
}
