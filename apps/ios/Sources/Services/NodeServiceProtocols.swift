import CoreLocation
import Foundation
import SkynetKit
import UIKit

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: SkynetCameraSnapParams) async throws -> (format: String, base64: String, width: Int, height: Int)
    func clip(params: SkynetCameraClipParams) async throws -> (format: String, base64: String, durationMs: Int, hasAudio: Bool)
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: SkynetLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: SkynetLocationGetParams,
        desiredAccuracy: SkynetLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: SkynetLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

protocol DeviceStatusServicing: Sendable {
    func status() async throws -> SkynetDeviceStatusPayload
    func info() -> SkynetDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: SkynetPhotosLatestParams) async throws -> SkynetPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: SkynetContactsSearchParams) async throws -> SkynetContactsSearchPayload
    func add(params: SkynetContactsAddParams) async throws -> SkynetContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: SkynetCalendarEventsParams) async throws -> SkynetCalendarEventsPayload
    func add(params: SkynetCalendarAddParams) async throws -> SkynetCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: SkynetRemindersListParams) async throws -> SkynetRemindersListPayload
    func add(params: SkynetRemindersAddParams) async throws -> SkynetRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: SkynetMotionActivityParams) async throws -> SkynetMotionActivityPayload
    func pedometer(params: SkynetPedometerParams) async throws -> SkynetPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Sendable, Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: SkynetWatchNotifyParams) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
