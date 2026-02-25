package ai.skynet.android.node

import android.os.Build
import ai.skynet.android.BuildConfig
import ai.skynet.android.SecurePrefs
import ai.skynet.android.gateway.GatewayClientInfo
import ai.skynet.android.gateway.GatewayConnectOptions
import ai.skynet.android.gateway.GatewayEndpoint
import ai.skynet.android.gateway.GatewayTlsParams
import ai.skynet.android.protocol.SkynetCanvasA2UICommand
import ai.skynet.android.protocol.SkynetCanvasCommand
import ai.skynet.android.protocol.SkynetCameraCommand
import ai.skynet.android.protocol.SkynetLocationCommand
import ai.skynet.android.protocol.SkynetScreenCommand
import ai.skynet.android.protocol.SkynetSmsCommand
import ai.skynet.android.protocol.SkynetCapability
import ai.skynet.android.LocationMode
import ai.skynet.android.VoiceWakeMode

class ConnectionManager(
  private val prefs: SecurePrefs,
  private val cameraEnabled: () -> Boolean,
  private val locationMode: () -> LocationMode,
  private val voiceWakeMode: () -> VoiceWakeMode,
  private val smsAvailable: () -> Boolean,
  private val hasRecordAudioPermission: () -> Boolean,
  private val manualTls: () -> Boolean,
) {
  companion object {
    internal fun resolveTlsParamsForEndpoint(
      endpoint: GatewayEndpoint,
      storedFingerprint: String?,
      manualTlsEnabled: Boolean,
    ): GatewayTlsParams? {
      val stableId = endpoint.stableId
      val stored = storedFingerprint?.trim().takeIf { !it.isNullOrEmpty() }
      val isManual = stableId.startsWith("manual|")

      if (isManual) {
        if (!manualTlsEnabled) return null
        if (!stored.isNullOrBlank()) {
          return GatewayTlsParams(
            required = true,
            expectedFingerprint = stored,
            allowTOFU = false,
            stableId = stableId,
          )
        }
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = null,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      // Prefer stored pins. Never let discovery-provided TXT override a stored fingerprint.
      if (!stored.isNullOrBlank()) {
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = stored,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      val hinted = endpoint.tlsEnabled || !endpoint.tlsFingerprintSha256.isNullOrBlank()
      if (hinted) {
        // TXT is unauthenticated. Do not treat the advertised fingerprint as authoritative.
        return GatewayTlsParams(
          required = true,
          expectedFingerprint = null,
          allowTOFU = false,
          stableId = stableId,
        )
      }

      return null
    }
  }

  fun buildInvokeCommands(): List<String> =
    buildList {
      add(SkynetCanvasCommand.Present.rawValue)
      add(SkynetCanvasCommand.Hide.rawValue)
      add(SkynetCanvasCommand.Navigate.rawValue)
      add(SkynetCanvasCommand.Eval.rawValue)
      add(SkynetCanvasCommand.Snapshot.rawValue)
      add(SkynetCanvasA2UICommand.Push.rawValue)
      add(SkynetCanvasA2UICommand.PushJSONL.rawValue)
      add(SkynetCanvasA2UICommand.Reset.rawValue)
      add(SkynetScreenCommand.Record.rawValue)
      if (cameraEnabled()) {
        add(SkynetCameraCommand.Snap.rawValue)
        add(SkynetCameraCommand.Clip.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(SkynetLocationCommand.Get.rawValue)
      }
      if (smsAvailable()) {
        add(SkynetSmsCommand.Send.rawValue)
      }
      if (BuildConfig.DEBUG) {
        add("debug.logs")
        add("debug.ed25519")
      }
      add("app.update")
    }

  fun buildCapabilities(): List<String> =
    buildList {
      add(SkynetCapability.Canvas.rawValue)
      add(SkynetCapability.Screen.rawValue)
      if (cameraEnabled()) add(SkynetCapability.Camera.rawValue)
      if (smsAvailable()) add(SkynetCapability.Sms.rawValue)
      if (voiceWakeMode() != VoiceWakeMode.Off && hasRecordAudioPermission()) {
        add(SkynetCapability.VoiceWake.rawValue)
      }
      if (locationMode() != LocationMode.Off) {
        add(SkynetCapability.Location.rawValue)
      }
    }

  fun resolvedVersionName(): String {
    val versionName = BuildConfig.VERSION_NAME.trim().ifEmpty { "dev" }
    return if (BuildConfig.DEBUG && !versionName.contains("dev", ignoreCase = true)) {
      "$versionName-dev"
    } else {
      versionName
    }
  }

  fun resolveModelIdentifier(): String? {
    return listOfNotNull(Build.MANUFACTURER, Build.MODEL)
      .joinToString(" ")
      .trim()
      .ifEmpty { null }
  }

  fun buildUserAgent(): String {
    val version = resolvedVersionName()
    val release = Build.VERSION.RELEASE?.trim().orEmpty()
    val releaseLabel = if (release.isEmpty()) "unknown" else release
    return "SkynetAndroid/$version (Android $releaseLabel; SDK ${Build.VERSION.SDK_INT})"
  }

  fun buildClientInfo(clientId: String, clientMode: String): GatewayClientInfo {
    return GatewayClientInfo(
      id = clientId,
      displayName = prefs.displayName.value,
      version = resolvedVersionName(),
      platform = "android",
      mode = clientMode,
      instanceId = prefs.instanceId.value,
      deviceFamily = "Android",
      modelIdentifier = resolveModelIdentifier(),
    )
  }

  fun buildNodeConnectOptions(): GatewayConnectOptions {
    return GatewayConnectOptions(
      role = "node",
      scopes = emptyList(),
      caps = buildCapabilities(),
      commands = buildInvokeCommands(),
      permissions = emptyMap(),
      client = buildClientInfo(clientId = "skynet-android", clientMode = "node"),
      userAgent = buildUserAgent(),
    )
  }

  fun buildOperatorConnectOptions(): GatewayConnectOptions {
    return GatewayConnectOptions(
      role = "operator",
      scopes = listOf("operator.read", "operator.write", "operator.talk.secrets"),
      caps = emptyList(),
      commands = emptyList(),
      permissions = emptyMap(),
      client = buildClientInfo(clientId = "skynet-android", clientMode = "ui"),
      userAgent = buildUserAgent(),
    )
  }

  fun resolveTlsParams(endpoint: GatewayEndpoint): GatewayTlsParams? {
    val stored = prefs.loadGatewayTlsFingerprint(endpoint.stableId)
    return resolveTlsParamsForEndpoint(endpoint, storedFingerprint = stored, manualTlsEnabled = manualTls())
  }
}
