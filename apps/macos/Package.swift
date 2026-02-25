// swift-tools-version: 6.2
// Package manifest for the Skynet macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Skynet",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "SkynetIPC", targets: ["SkynetIPC"]),
        .library(name: "SkynetDiscovery", targets: ["SkynetDiscovery"]),
        .executable(name: "Skynet", targets: ["Skynet"]),
        .executable(name: "skynet-mac", targets: ["SkynetMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.2.2"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "0.1.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", branch: "main"),
        .package(path: "../shared/SkynetKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "SkynetIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SkynetDiscovery",
            dependencies: [
                .product(name: "SkynetKit", package: "SkynetKit"),
            ],
            path: "Sources/SkynetDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Skynet",
            dependencies: [
                "SkynetIPC",
                "SkynetDiscovery",
                .product(name: "SkynetKit", package: "SkynetKit"),
                .product(name: "SkynetChatUI", package: "SkynetKit"),
                .product(name: "SkynetProtocol", package: "SkynetKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/Skynet.icns"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "SkynetMacCLI",
            dependencies: [
                "SkynetDiscovery",
                .product(name: "SkynetKit", package: "SkynetKit"),
                .product(name: "SkynetProtocol", package: "SkynetKit"),
            ],
            path: "Sources/SkynetMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "SkynetIPCTests",
            dependencies: [
                "SkynetIPC",
                "Skynet",
                "SkynetDiscovery",
                .product(name: "SkynetProtocol", package: "SkynetKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
