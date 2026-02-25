import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-skynet writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.skynet.mac"
let gatewayLaunchdLabel = "ai.skynet.gateway"
let onboardingVersionKey = "skynet.onboardingVersion"
let onboardingSeenKey = "skynet.onboardingSeen"
let currentOnboardingVersion = 7
let pauseDefaultsKey = "skynet.pauseEnabled"
let iconAnimationsEnabledKey = "skynet.iconAnimationsEnabled"
let swabbleEnabledKey = "skynet.swabbleEnabled"
let swabbleTriggersKey = "skynet.swabbleTriggers"
let voiceWakeTriggerChimeKey = "skynet.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "skynet.voiceWakeSendChime"
let showDockIconKey = "skynet.showDockIcon"
let defaultVoiceWakeTriggers = ["skynet"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "skynet.voiceWakeMicID"
let voiceWakeMicNameKey = "skynet.voiceWakeMicName"
let voiceWakeLocaleKey = "skynet.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "skynet.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "skynet.voicePushToTalkEnabled"
let talkEnabledKey = "skynet.talkEnabled"
let iconOverrideKey = "skynet.iconOverride"
let connectionModeKey = "skynet.connectionMode"
let remoteTargetKey = "skynet.remoteTarget"
let remoteIdentityKey = "skynet.remoteIdentity"
let remoteProjectRootKey = "skynet.remoteProjectRoot"
let remoteCliPathKey = "skynet.remoteCliPath"
let canvasEnabledKey = "skynet.canvasEnabled"
let cameraEnabledKey = "skynet.cameraEnabled"
let systemRunPolicyKey = "skynet.systemRunPolicy"
let systemRunAllowlistKey = "skynet.systemRunAllowlist"
let systemRunEnabledKey = "skynet.systemRunEnabled"
let locationModeKey = "skynet.locationMode"
let locationPreciseKey = "skynet.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "skynet.peekabooBridgeEnabled"
let deepLinkKeyKey = "skynet.deepLinkKey"
let modelCatalogPathKey = "skynet.modelCatalogPath"
let modelCatalogReloadKey = "skynet.modelCatalogReload"
let cliInstallPromptedVersionKey = "skynet.cliInstallPromptedVersion"
let heartbeatsEnabledKey = "skynet.heartbeatsEnabled"
let debugPaneEnabledKey = "skynet.debugPaneEnabled"
let debugFileLogEnabledKey = "skynet.debug.fileLogEnabled"
let appLogLevelKey = "skynet.debug.appLogLevel"
let voiceWakeSupported: Bool = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 26
