// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "SkynetKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
    ],
    products: [
        .library(name: "SkynetProtocol", targets: ["SkynetProtocol"]),
        .library(name: "SkynetKit", targets: ["SkynetKit"]),
        .library(name: "SkynetChatUI", targets: ["SkynetChatUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.0"),
        .package(url: "https://github.com/gonzalezreal/textual", exact: "0.3.1"),
    ],
    targets: [
        .target(
            name: "SkynetProtocol",
            path: "Sources/SkynetProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SkynetKit",
            dependencies: [
                "SkynetProtocol",
                .product(name: "ElevenLabsKit", package: "ElevenLabsKit"),
            ],
            path: "Sources/SkynetKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "SkynetChatUI",
            dependencies: [
                "SkynetKit",
                .product(
                    name: "Textual",
                    package: "textual",
                    condition: .when(platforms: [.macOS, .iOS])),
            ],
            path: "Sources/SkynetChatUI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "SkynetKitTests",
            dependencies: ["SkynetKit", "SkynetChatUI"],
            path: "Tests/SkynetKitTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
