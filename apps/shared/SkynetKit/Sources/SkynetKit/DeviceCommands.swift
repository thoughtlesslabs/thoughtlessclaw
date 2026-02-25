import Foundation

public enum SkynetDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
}

public enum SkynetBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum SkynetThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum SkynetNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum SkynetNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct SkynetBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: SkynetBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: SkynetBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct SkynetThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: SkynetThermalState

    public init(state: SkynetThermalState) {
        self.state = state
    }
}

public struct SkynetStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct SkynetNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: SkynetNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [SkynetNetworkInterfaceType]

    public init(
        status: SkynetNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [SkynetNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct SkynetDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: SkynetBatteryStatusPayload
    public var thermal: SkynetThermalStatusPayload
    public var storage: SkynetStorageStatusPayload
    public var network: SkynetNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: SkynetBatteryStatusPayload,
        thermal: SkynetThermalStatusPayload,
        storage: SkynetStorageStatusPayload,
        network: SkynetNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct SkynetDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
